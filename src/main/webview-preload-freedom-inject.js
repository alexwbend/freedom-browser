/**
 * navigator.freedom injection source (Phase 1).
 *
 * IMPORTANT: this file is source-as-data, exactly like
 * webview-preload-ethereum-inject.js. It never executes in a Node context —
 * the main process reads it as text and serves it to the sandboxed webview
 * preload, which injects it as a <script> body into the target page's realm.
 * Running inside the page means: no `require`, no Electron APIs, no Node
 * built-ins. It may only use standard browser globals (window, navigator,
 * Blob, DOMException, ...) and the already-injected window.ethereum /
 * window.swarm providers.
 *
 * Phase 1 scope (see docs/FREEDOM_SPEC.md §13–§20): navigator.freedom is a
 * thin, capability-shaped facade over the existing EIP-1193 wallet
 * (window.ethereum) and the Swarm provider (window.swarm). It introduces no
 * new IPC bridge of its own — it delegates to providers that are already
 * wired through the renderer and main process, including their approval UI
 * and permission stores.
 *
 * Kept in its own file so it can be compiled in isolation for unit tests
 * (via `new Function('window', 'navigator', SOURCE)`).
 */
(function () {
  'use strict';

  if (navigator.freedom) return;

  var VERSION = '0.3';

  // EIP-1193 / provider error codes used by the underlying providers.
  var EIP1193 = {
    USER_REJECTED: 4001,
    UNAUTHORIZED: 4100,
    UNSUPPORTED_METHOD: 4200,
    DISCONNECTED: 4900,
    INVALID_PARAMS: -32602,
  };

  var GATE_MESSAGE =
    'Freedom Identity & Wallet is disabled. Enable it in Settings \u2192 Experimental.';

  function domError(name, reason, message) {
    var err = new DOMException(message || name, name);
    try {
      err.reason = reason;
    } catch {
      /* DOMException props are read-only in some engines; reason is a hint only */
    }
    return err;
  }

  function notSupported(reason, message) {
    return domError('NotSupportedError', reason, message || 'Capability not supported');
  }

  // Pre-flight node/stamp problems are a local-state issue, not a permission
  // denial — map them to InvalidStateError with an actionable message (§8).
  var READINESS_MESSAGES = {
    'no-usable-stamps': 'No usable postage stamp is available. Buy or top up a stamp to publish.',
    'node-not-ready': 'The Swarm node is not ready yet. Try again shortly.',
    'node-stopped': 'The Swarm node is not running.',
    'ultra-light-mode': 'The Swarm node is in ultra-light mode and cannot publish.',
  };

  // Map an underlying provider error (EIP-1193 numeric codes) to the DOM-style
  // error model defined in the spec (§8). The gate-off case (DISCONNECTED) is
  // surfaced as a clear, actionable NotAllowedError rather than a bare
  // "Disconnected" string — this is the resolved gate decision (§18).
  function mapError(err) {
    var code = err && err.code;
    var reason = err && err.data && err.data.reason;
    var message = (err && err.message) || 'Freedom request failed';

    // Branch on reason before code: node/stamp failures share code 4900 with
    // the disabled gate, but they are a different story (§8). The gate-off
    // case carries no reason, so it still falls through to NotAllowedError.
    if (READINESS_MESSAGES[reason]) {
      return domError('InvalidStateError', reason, READINESS_MESSAGES[reason]);
    }
    if (reason === 'stamp-exhausted') {
      return domError(
        'NetworkError',
        reason,
        'The postage stamp was exhausted before the upload completed.'
      );
    }

    if (code === EIP1193.DISCONNECTED) {
      return new DOMException(GATE_MESSAGE, 'NotAllowedError');
    }
    if (code === EIP1193.USER_REJECTED) {
      return new DOMException(message, 'AbortError');
    }
    if (code === EIP1193.UNAUTHORIZED) {
      return new DOMException(message, 'NotAllowedError');
    }
    if (code === EIP1193.UNSUPPORTED_METHOD) {
      return notSupported('method-not-supported', message);
    }
    if (code === EIP1193.INVALID_PARAMS) {
      return new TypeError(message);
    }
    if (err instanceof Error) return err;

    var fallback = new Error(message);
    if (code !== undefined) fallback.code = code;
    return fallback;
  }

  // ---- wallet: thin EIP-1193 facade over window.ethereum -------------------

  var wallet = {
    request: function (args) {
      if (!window.ethereum) {
        return Promise.reject(notSupported('wallet-unavailable', 'Wallet is not available'));
      }
      return window.ethereum.request(args).catch(function (err) {
        throw mapError(err);
      });
    },
    on: function (event, handler) {
      if (window.ethereum) window.ethereum.on(event, handler);
      return this;
    },
    removeListener: function (event, handler) {
      if (window.ethereum) window.ethereum.removeListener(event, handler);
      return this;
    },
    addListener: function (event, handler) {
      return this.on(event, handler);
    },
    removeAllListeners: function (event) {
      if (window.ethereum && window.ethereum.removeAllListeners) {
        window.ethereum.removeAllListeners(event);
      }
      return this;
    },
  };

  // ---- storage: unified upload over window.swarm ---------------------------

  // Normalize the accepted UploadInput types into the { data, contentType,
  // name } shape that window.swarm.publishData expects.
  function normalizeData(input, contentType, filename) {
    if (typeof input === 'string') {
      return Promise.resolve({
        data: input,
        contentType: contentType || 'text/plain',
        name: filename,
      });
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      return input.arrayBuffer().then(function (buf) {
        return {
          data: new Uint8Array(buf),
          contentType: contentType || input.type || 'application/octet-stream',
          name: filename || input.name,
        };
      });
    }
    if (input instanceof ArrayBuffer) {
      return Promise.resolve({
        data: new Uint8Array(input),
        contentType: contentType || 'application/octet-stream',
        name: filename,
      });
    }
    if (ArrayBuffer.isView(input)) {
      return Promise.resolve({
        data: new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
        contentType: contentType || 'application/octet-stream',
        name: filename,
      });
    }
    return Promise.reject(
      new TypeError(
        'storage.upload: data must be a Blob, File, ArrayBuffer, TypedArray, or string'
      )
    );
  }

  // Reject `promise` with AbortError if `signal` fires before it settles.
  // Phase 1 caveat: this only settles the caller's promise — the in-flight
  // network upload is not actually canceled and may still complete on the node
  // (see FREEDOM_SPEC §16: abort is best-effort, no mid-upload cancellation).
  function withAbort(signal, promise) {
    if (!signal || typeof signal.addEventListener !== 'function') return promise;
    return new Promise(function (resolve, reject) {
      var settled = false;
      function cleanup() {
        if (signal.removeEventListener) signal.removeEventListener('abort', onAbort);
      }
      function onAbort() {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException('Upload aborted', 'AbortError'));
      }
      signal.addEventListener('abort', onAbort);
      promise.then(
        function (value) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        function (err) {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        }
      );
    });
  }

  function upload(options) {
    if (!options || typeof options !== 'object') {
      return Promise.reject(new TypeError('storage.upload: an options object is required'));
    }
    var data = options.data;
    var network = options.network;
    var signal = options.signal;

    if (data === undefined || data === null) {
      return Promise.reject(new TypeError('storage.upload: data is required'));
    }
    if (network !== 'swarm' && network !== 'ipfs') {
      return Promise.reject(
        new TypeError('storage.upload: network must be "swarm" or "ipfs"')
      );
    }
    if (signal && signal.aborted) {
      return Promise.reject(new DOMException('Upload aborted', 'AbortError'));
    }

    // Phase 1: IPFS write is not implemented — the embedded node is
    // retrieval-only. Tracked as a native dependency (spec §18).
    if (network === 'ipfs') {
      return Promise.reject(
        notSupported(
          'write-not-supported',
          'IPFS write is not available yet. Use network:"swarm" (see FREEDOM_SPEC Phase 2).'
        )
      );
    }

    if (!window.swarm) {
      return Promise.reject(notSupported('storage-unavailable', 'Swarm storage is not available'));
    }

    var work = normalizeData(data, options.contentType, options.filename).then(function (norm) {
      // requestAccess is idempotent — shows the connect prompt only on first
      // use for this origin, otherwise resolves immediately.
      return window.swarm
        .requestAccess()
        .catch(function (err) {
          throw mapError(err);
        })
        .then(function () {
          return window.swarm
            .publishData({ data: norm.data, contentType: norm.contentType, name: norm.name })
            .catch(function (err) {
              throw mapError(err);
            });
        })
        .then(function (result) {
          return {
            network: 'swarm',
            hash: result.reference,
            url: result.bzzUrl || 'bzz://' + result.reference,
            _providerRaw: result,
          };
        });
    });

    return withAbort(signal, work);
  }

  var storage = {
    upload: upload,
    swarm: {
      upload: function (options) {
        return upload(Object.assign({}, options, { network: 'swarm' }));
      },
    },
    ipfs: {
      add: function (options) {
        return upload(Object.assign({}, options, { network: 'ipfs' }));
      },
    },
  };

  // ---- dweb: name resolution via the preload's ENS bridge ------------------
  // The page realm can't reach the main process directly, so dweb.resolve
  // posts a FREEDOM_DWEB_REQUEST that the sandboxed webview preload fulfils
  // against the in-process ENS resolver (the same resolver the address bar
  // uses). Resolution is public and read-only, so — unlike wallet/storage —
  // it is ungated and needs no approval UI. The raw resolver result is mapped
  // here to the spec's { protocol, hash, url } shape (§17).
  var pendingDweb = new Map();
  var dwebRequestId = 0;

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.type !== 'FREEDOM_DWEB_RESPONSE') return;
    var pending = pendingDweb.get(data.id);
    if (!pending) return;
    pendingDweb.delete(data.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (data.error) {
      pending.reject(new DOMException(data.error.message || 'dweb request failed', 'NetworkError'));
    } else {
      pending.resolve(data.result);
    }
  });

  function dwebRequest(method, payload) {
    var id = ++dwebRequestId;
    return new Promise(function (resolve, reject) {
      var entry = { resolve: resolve, reject: reject, timer: null };
      pendingDweb.set(id, entry);
      window.postMessage(
        Object.assign({ type: 'FREEDOM_DWEB_REQUEST', id: id, method: method }, payload || {}),
        '*'
      );
      entry.timer = setTimeout(function () {
        if (pendingDweb.has(id)) {
          pendingDweb.delete(id);
          reject(new DOMException('dweb.' + method + ' timed out', 'NetworkError'));
        }
      }, 30000);
    });
  }

  var dweb = {
    resolve: function (name) {
      if (typeof name !== 'string' || !name.trim()) {
        return Promise.reject(new TypeError('dweb.resolve: a non-empty name string is required'));
      }
      return dwebRequest('resolve', { name: name }).then(function (result) {
        if (result && result.type === 'ok') {
          return { protocol: result.protocol, hash: result.decoded, url: result.uri };
        }
        if (result && result.type === 'unsupported') {
          throw notSupported(
            'unsupported-contenthash',
            'ENS name "' + name + '" uses an unsupported contenthash codec'
          );
        }
        var reason = (result && (result.reason || result.type)) || 'not_found';
        throw new DOMException('Could not resolve "' + name + '" (' + reason + ')', 'NetworkError');
      });
    },
  };

  // ---- permissions ---------------------------------------------------------
  // Canonical permission names, mirroring the registry in FREEDOM_SPEC §18.
  // Unknown names reject with TypeError, matching the platform Permissions API
  // contract for unsupported descriptors.
  var WALLET_PERMISSIONS = ['wallet.accounts', 'wallet.sign', 'wallet.send'];
  // `storage.ipfs.write` is intentionally absent until the native write path
  // lands (§18): query/request reject with TypeError like any unknown name, and
  // IPFS unavailability is reported solely via capabilities() + the
  // NotSupportedError on upload({network:"ipfs"}). This keeps "does it exist"
  // (capabilities) separate from "is it granted" (permissions).
  var KNOWN_PERMISSIONS = WALLET_PERMISSIONS.concat([
    'storage.swarm.write',
    'dweb.name-resolution',
    'runtime.status',
  ]);

  // All three wallet permissions are "granted via connect" in Phase 1: once an
  // origin has connected accounts, accounts/sign/send are usable (send and
  // sign may still surface a per-call approval, which is a runtime gate, not a
  // permission state). So query maps connection state → granted | prompt, and
  // surfaces the disabled Identity & Wallet gate (DISCONNECTED) as denied.
  function queryWalletState() {
    if (!window.ethereum) return Promise.resolve({ state: 'denied' });
    return window.ethereum
      .request({ method: 'eth_accounts' })
      .then(function (accounts) {
        return { state: accounts && accounts.length ? 'granted' : 'prompt' };
      })
      .catch(function (err) {
        return { state: err && err.code === EIP1193.DISCONNECTED ? 'denied' : 'prompt' };
      });
  }

  var permissions = {
    query: function (descriptor) {
      var name = descriptor && descriptor.name;
      if (!name) {
        return Promise.reject(new TypeError('permissions.query: a { name } descriptor is required'));
      }
      if (KNOWN_PERMISSIONS.indexOf(name) === -1) {
        return Promise.reject(new TypeError('permissions.query: unknown permission "' + name + '"'));
      }
      if (WALLET_PERMISSIONS.indexOf(name) !== -1) {
        return queryWalletState();
      }
      // Resolution is public, read-only, and ungated → implicit grant.
      if (name === 'dweb.name-resolution') return Promise.resolve({ state: 'granted' });
      // runtime is a privileged Tier 3 surface, never granted to the open web.
      if (name === 'runtime.status') {
        return Promise.resolve({ state: 'denied' });
      }
      // storage.swarm.write: no page-level permission read yet, so approximate
      // as prompt (request drives the real connect/approval flow).
      return Promise.resolve({ state: 'prompt' });
    },
    request: function (descriptor) {
      var name = descriptor && descriptor.name;
      if (!name) {
        return Promise.reject(new TypeError('permissions.request: a { name } descriptor is required'));
      }
      if (KNOWN_PERMISSIONS.indexOf(name) === -1) {
        return Promise.reject(
          new TypeError('permissions.request: unknown permission "' + name + '"')
        );
      }
      if (WALLET_PERMISSIONS.indexOf(name) !== -1) {
        // A single connect grants the whole wallet permission group.
        return wallet
          .request({ method: 'eth_requestAccounts' })
          .then(function () {
            return { state: 'granted' };
          })
          .catch(function (err) {
            if (err && err.name === 'AbortError') return { state: 'denied' };
            throw err;
          });
      }
      if (name === 'dweb.name-resolution') return Promise.resolve({ state: 'granted' });
      if (name === 'storage.swarm.write') {
        if (!window.swarm) {
          return Promise.reject(notSupported('storage-unavailable', 'Swarm storage is not available'));
        }
        return window.swarm
          .requestAccess()
          .then(function () {
            return { state: 'granted' };
          })
          .catch(function (err) {
            var mapped = mapError(err);
            if (mapped && mapped.name === 'AbortError') return { state: 'denied' };
            throw mapped;
          });
      }
      // runtime.status (Tier 3) is not requestable from the open web.
      return Promise.resolve({ state: 'denied' });
    },
  };

  // ---- capabilities() ------------------------------------------------------
  // Resolves (never throws) and reports availability honestly, including the
  // Identity & Wallet gate state (resolved decision, spec §18). The gate is
  // shared by the wallet and swarm providers; swarm_getCapabilities rejects
  // with DISCONNECTED (4900) when the gate is off, which we use to detect it.
  function capabilities() {
    var detectSwarm = window.swarm
      ? window.swarm.getCapabilities().then(
          function (caps) {
            return { gate: true, caps: caps };
          },
          function (err) {
            if (err && err.code === EIP1193.DISCONNECTED) return { gate: false, caps: null };
            return { gate: true, caps: null, reason: (err && err.message) || 'unavailable' };
          }
        )
      : Promise.resolve({ gate: true, caps: null, reason: 'storage-unavailable' });

    return detectSwarm.then(function (info) {
      var gateOn = info.gate;
      var swarmAvailable = false;
      var swarmReason;

      if (!gateOn) {
        swarmReason = 'identity-wallet-disabled';
      } else if (info.caps) {
        // canPublish folds in connection state; treat "not-connected" as
        // available-on-grant since upload() triggers requestAccess.
        if (info.caps.canPublish || info.caps.reason === 'not-connected') {
          swarmAvailable = true;
        } else {
          swarmReason = info.caps.reason || 'unavailable';
        }
      } else {
        swarmReason = info.reason || 'unavailable';
      }

      var walletAvailable = typeof window.ethereum !== 'undefined' && gateOn;

      return {
        wallet: {
          available: walletAvailable,
          version: '1',
          reason: walletAvailable
            ? undefined
            : gateOn
              ? 'wallet-unavailable'
              : 'identity-wallet-disabled',
        },
        dweb: { available: true, protocols: ['bzz', 'ipfs', 'ipns', 'ens'] },
        storage: {
          swarm: { available: swarmAvailable, reason: swarmReason },
          ipfs: { available: false, reason: 'write-not-supported' },
        },
        runtime: { available: false, reason: 'privileged' },
      };
    });
  }

  // ---- install -------------------------------------------------------------

  Object.freeze(wallet);
  Object.freeze(storage.swarm);
  Object.freeze(storage.ipfs);
  Object.freeze(storage);
  Object.freeze(dweb);
  Object.freeze(permissions);

  var freedom = Object.freeze({
    version: VERSION,
    capabilities: capabilities,
    wallet: wallet,
    storage: storage,
    dweb: dweb,
    permissions: permissions,
  });

  try {
    Object.defineProperty(navigator, 'freedom', {
      value: freedom,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  } catch {
    try {
      navigator.freedom = freedom;
    } catch (e2) {
      console.error('[navigator.freedom] failed to install:', e2);
    }
  }
})();
