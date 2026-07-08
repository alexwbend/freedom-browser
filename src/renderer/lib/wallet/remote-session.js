/**
 * Remote-signer session broker.
 *
 * Main's remote signer backend publishes signing jobs over IPC (see
 * src/main/wallet/remote/bridge.js); this module runs them: it hosts an
 * openlv session (P2P, end-to-end encrypted — the signaling relay only
 * sees ciphertext), exposes the session URI for the QR dialog, tunnels
 * the wallet JSON-RPC request to the phone, and responds to main with
 * the phone's answer. Main verifies every signature before using it —
 * nothing here is trusted with more than transporting bytes.
 *
 * One session per job (per-request QR): no session secrets outlive the
 * request. UI (WP-R3) subscribes via onJobEvent to render QR / waiting /
 * error states and calls cancelJob when the user closes the dialog.
 */

// Default signaling relay (spec default). Carries only encrypted
// handshake/negotiation frames — never wallet data in the clear.
const DEFAULT_SIGNALING = { p: 'mqtt', s: 'wss://test.mosquitto.org:8081/mqtt' };

// Where the dual-purpose QR sends phones without an openlv-native wallet.
// The session secret rides in the URL *fragment*, which browsers never
// send to the server. PLACEHOLDER until the bridge page ships (WP-R3.5).
const BRIDGE_ORIGIN = 'https://connect.freedom.baby';

// The openlv SDK (168 KiB vendor bundle) is only needed once a signing
// job actually arrives — keep it off the renderer boot path.
let vendorPromise = null;
const loadVendorOpenlv = () => (vendorPromise ??= import('../../vendor/openlv.esm.js'));

/** Wallet SDKs answer `{result}` / `{error:{code,message}}` envelopes; tolerate bare values. */
function unwrapResponse(payload) {
  if (payload && typeof payload === 'object') {
    if (payload.error) return { error: payload.error };
    if ('result' in payload) return { result: payload.result };
  }
  return { result: payload };
}

/**
 * @param {Object} deps
 * @param {Object} [deps.openlv] - openlv SDK surface (injectable for tests; lazy vendor load otherwise)
 * @param {typeof window.remoteSigner} [deps.remoteSigner] - preload IPC bridge
 * @param {{p: string, s: string}} [deps.signaling]
 * @param {string} [deps.bridgeOrigin]
 */
export function createRemoteSessionBroker({
  openlv = null,
  remoteSigner = window.remoteSigner,
  signaling = DEFAULT_SIGNALING,
  bridgeOrigin = BRIDGE_ORIGIN,
} = {}) {
  /** jobId → { session, settled, respond } */
  const jobs = new Map();
  const listeners = new Set();
  const disposers = [];

  function emit(event) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[RemoteSession] job listener failed:', err);
      }
    }
  }

  /** Settle a job exactly once: deliver the outcome (unless silent) and tear down. */
  function settle(jobId, payload) {
    const job = jobs.get(jobId);
    if (!job || job.settled) return false;
    job.settled = true;
    if (payload) {
      job.respond(payload);
    }
    teardown(jobId);
    return true;
  }

  function teardown(jobId) {
    const job = jobs.get(jobId);
    jobs.delete(jobId);
    if (job?.session) {
      Promise.resolve(job.session.close()).catch((err) => {
        console.warn('[RemoteSession] session close failed:', err.message);
      });
    }
  }

  // The phone should never initiate requests toward the browser in this
  // flow; answer like the reference provider does so openlv-SDK wallets
  // get a proper JSON-RPC error instead of a hang.
  const onIncomingMessage = async () => ({ error: { code: -32601, message: 'Method not found' } });

  /**
   * Host a session for one request and deliver the outcome via `respond`
   * — main's IPC reply for signing jobs, a local promise for the
   * connect-phone flow.
   */
  async function runJob({ jobId, method, params }, respond) {
    if (jobs.has(jobId)) return;
    const entry = { session: null, settled: false, respond };
    jobs.set(jobId, entry);

    try {
      const sdk = openlv || (await loadVendorOpenlv());
      const session = await sdk.createSession(
        signaling,
        sdk.mqtt,
        [sdk.webrtc()],
        onIncomingMessage,
      );
      if (entry.settled) {
        // Cancelled/aborted while the session was being created.
        Promise.resolve(session.close()).catch(() => {});
        return;
      }
      entry.session = session;

      const uri = sdk.encodeConnectionURL(session.getHandshakeParameters());
      emit({
        jobId,
        phase: 'qr',
        method,
        uri,
        bridgeUrl: `${bridgeOrigin}/#${uri}`,
      });

      session.emitter.on('state_change', (state) => {
        if (!entry.settled && state?.status) {
          emit({ jobId, phase: state.status, method });
        }
      });

      await session.connect();
      await session.waitForLink();
      if (entry.settled) return;

      emit({ jobId, phase: 'awaiting-approval', method });
      const { result, error } = unwrapResponse(await session.send({ method, params }));

      if (error) {
        emit({ jobId, phase: 'error', method, error });
        // rpcCode: main maps EIP-1193 codes (4001 …) to REMOTE_* there,
        // where the error registry lives.
        settle(jobId, { error: { rpcCode: error.code, message: error.message } });
      } else {
        emit({ jobId, phase: 'done', method });
        settle(jobId, { result });
      }
    } catch (err) {
      console.error('[RemoteSession] job failed:', err);
      emit({ jobId, phase: 'error', method, error: { message: err.message } });
      settle(jobId, { error: { code: 'REMOTE_UNKNOWN', message: err.message } });
    }
  }

  return {
    /** Start listening for signing jobs from main. */
    start() {
      disposers.push(
        remoteSigner.onRequest((job) =>
          runJob(job, (payload) => remoteSigner.respond({ jobId: job.jobId, ...payload })),
        ),
      );
      disposers.push(
        remoteSigner.onAbort(({ jobId }) => {
          // Main already failed the job (timeout) — settle silently.
          if (settle(jobId)) {
            emit({ jobId, phase: 'aborted' });
          }
        }),
      );
    },

    stop() {
      while (disposers.length) disposers.pop()();
      for (const jobId of [...jobs.keys()]) teardown(jobId);
    },

    /** User closed the QR dialog — tell main and drop the session. */
    cancelJob(jobId) {
      if (settle(jobId, { error: { code: 'REMOTE_USER_CANCELLED' } })) {
        emit({ jobId, phase: 'cancelled' });
      }
    },

    /**
     * Connect-phone flow (no main involvement): host a session whose only
     * request is eth_requestAccounts, so the user can pick an account to
     * add. Follow progress via onJobEvent with the returned jobId; abort
     * with cancelJob.
     *
     * @returns {{jobId: string, accounts: Promise<string[]>}}
     */
    connectPhone() {
      const jobId = `connect-${crypto.randomUUID()}`;
      const accounts = new Promise((resolve, reject) => {
        runJob({ jobId, method: 'eth_requestAccounts', params: [] }, ({ result, error }) => {
          if (error || !Array.isArray(result) || result.length === 0) {
            const err = new Error(error?.message || 'Your phone reported no accounts');
            err.code = error?.code || 'REMOTE_BAD_RESPONSE';
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
      // The screen owns the rejection UX; avoid unhandled-rejection noise
      // when it cancels before subscribing.
      accounts.catch(() => {});
      return { jobId, accounts };
    },

    /** Subscribe to job lifecycle events; returns a disposer. */
    onJobEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let defaultBroker = null;

/** Wire the singleton broker to the preload bridge (called from wallet-ui). */
export function initRemoteSession() {
  if (!defaultBroker) {
    defaultBroker = createRemoteSessionBroker();
    defaultBroker.start();
  }
  return defaultBroker;
}

/** The running broker, for UI modules (QR dialog) to subscribe/cancel. */
export function getRemoteSessionBroker() {
  return defaultBroker;
}
