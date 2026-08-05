const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { ethers } = require('ethers');
const Colibri = require('@corpus-core/colibri-stateless').default;
const { Strategy } = require('@corpus-core/colibri-stateless');
const log = require('../logger');
const registry = require('../networks/network-registry');
const { universalResolverCall, universalResolverReverse, hostOf } = require('../ens-resolver');

// privacy_mode 'basic' is a strict improvement (call params never sent
// to the prover); pinning rather than exposing as a toggle keeps the
// threat model legible.
const PRIVACY_MODE = 'basic';
const MAX_LATEST_AGE_SECONDS = 60;

const clients = new Map();
const providers = new Map();
const inFlightBuilds = new Map();
let storageRegistration = null;
let storageRegistered = false;
const buildGenerations = new Map();

// Disk-backed storage adapter for Colibri's verifier state (sync committee
// pubkeys, current head witness, etc — keys like "states_1" / "sync_1_<slot>").
// The bundled default writes these to process.cwd(), which means launching
// the browser from a different directory loses the warm-cache state and
// scatters files across the filesystem. Redirect to a stable per-app dir.
function createDiskStorage() {
  const dir = path.join(app.getPath('userData'), 'colibri');
  fs.mkdirSync(dir, { recursive: true });
  return {
    get: (key) => {
      try { return fs.readFileSync(path.join(dir, key)); }
      catch { return null; }
    },
    set: (key, value) => { fs.writeFileSync(path.join(dir, key), value); },
    del: (key) => {
      try { fs.unlinkSync(path.join(dir, key)); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
    },
  };
}

async function ensureStorageRegistered() {
  if (storageRegistered) return;
  if (!storageRegistration) {
    storageRegistration = Colibri.register_storage(createDiskStorage())
      .then(() => { storageRegistered = true; })
      .catch((err) => {
        storageRegistration = null;
        throw err;
      });
  }
  await storageRegistration;
}

function destroyClient(client) {
  if (!client || typeof client.destroy !== 'function') return;
  try {
    client.destroy();
  } catch (err) {
    log.warn(`[ens-colibri] failed to destroy old client: ${err.message}`);
  }
}

async function buildClient({ chainId, key, proverUrl, zkProof, generation }) {
  // Storage adapter is registered exactly once per process: on the very
  // first construction. Later settings-change rebuilds reuse it — the
  // adapter is keyless and the Colibri runtime expects a single global.
  await ensureStorageRegistered();

  const client = new Colibri({
    chainId,
    prover: [proverUrl],
    zk_proof: zkProof,
    privacy_mode: PRIVACY_MODE,
    proofStrategy: Strategy.VerifiedOnly,
    max_latest_age_seconds: MAX_LATEST_AGE_SECONDS,
  });

  if (generation !== buildGenerations.get(chainId)) {
    destroyClient(client);
    return getClient(chainId);
  }

  const previousClient = clients.get(chainId)?.client;
  clients.set(chainId, { client, key });
  providers.set(chainId, new ethers.BrowserProvider(client));
  destroyClient(previousClient);
  log.info(`[colibri] chain ${chainId} client ready (prover=${hostOf(proverUrl)}, zk=${zkProof})`);
  return client;
}

// Lazy singleton. Cache key is the tuple of settings that materially
// affect proof state (prover URL + zk_proof flag); a runtime change to
// either tears down the cached instance and rebuilds. WASM init is paid
// on first use, not module load. `inFlightBuild` collapses concurrent
// first-call lookups onto a single construction. The generation counter
// prevents a slower old-settings build from replacing a newer client.
async function getClient(chainId = 1) {
  const id = Number(chainId);
  const [proverUrl] = registry.getEndpoints(id, 'prover');
  if (!proverUrl) {
    throw new Error(`No Colibri prover configured for chain ${id}`);
  }
  const zkProof = registry.getNetwork(id)?.zkProof !== false;
  const key = `${proverUrl}|${zkProof}`;
  const cached = clients.get(id);
  const inFlight = inFlightBuilds.get(id);
  if (cached?.client && cached.key === key) {
    if (inFlight && inFlight.key !== key) {
      buildGenerations.set(id, (buildGenerations.get(id) || 0) + 1);
    }
    return cached.client;
  }
  if (inFlight && inFlight.key === key) return inFlight.promise;

  const generation = (buildGenerations.get(id) || 0) + 1;
  buildGenerations.set(id, generation);
  const promise = buildClient({ chainId: id, key, proverUrl, zkProof, generation });
  inFlightBuilds.set(id, { key, promise, generation });
  try { return await promise; }
  finally {
    if (inFlightBuilds.get(id)?.promise === promise) inFlightBuilds.delete(id);
  }
}

// Drop-in for what a single `consensusResolve` leg does today, but the
// answer is cryptographically verified by Colibri rather than corroborated
// across multiple public RPCs. No blockTag override — Colibri's verifier
// pins to head − 1 by construction (sync committee signatures for block N
// live in block N+1).
async function resolveCallViaColibri(name, callData, callResolver = universalResolverCall) {
  await getClient(1);
  return callResolver(providers.get(1), name, callData);
}

async function resolveViaColibri(name, callData) {
  return resolveCallViaColibri(name, callData, universalResolverCall);
}

// Reverse counterpart: cryptographically-verified `ur.reverse` for an
// address. Returns { name } on a successful (forward-verified) lookup.
// Throws on revert (UR's ResolverNotFound / ReverseAddressMismatch) or
// network/verification failure — the orchestrator classifies.
async function resolveReverseViaColibri(addressBytes) {
  await getClient(1);
  return universalResolverReverse(providers.get(1), addressBytes);
}

async function requestViaColibri(chainId, method, params = []) {
  const client = await getClient(chainId);
  return client.request({ method, params });
}

function clearColibriClientForTest() {
  for (const { client } of clients.values()) destroyClient(client);
  for (const chainId of new Set([
    ...clients.keys(),
    ...inFlightBuilds.keys(),
    ...buildGenerations.keys(),
  ])) {
    buildGenerations.set(chainId, (buildGenerations.get(chainId) || 0) + 1);
  }
  clients.clear();
  providers.clear();
  inFlightBuilds.clear();
  storageRegistration = null;
  storageRegistered = false;
}

module.exports = {
  resolveCallViaColibri,
  resolveViaColibri,
  resolveReverseViaColibri,
  requestViaColibri,
  clearColibriClientForTest,
};
