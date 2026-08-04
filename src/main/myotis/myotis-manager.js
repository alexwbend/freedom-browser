// EXPERIMENTAL (spike): Myotis — a fully peer-to-peer Ethereum light client
// (devp2p + beacon light client; every read Merkle-proven against a
// sync-committee-anchored state root). Runs invisibly like the ant/IPFS
// nodes, via a napi-rs native addon over the myotis-engine C ABI.
//
// Gated on MYOTIS_NODE_PATH (absolute path to myotis-node.node). Absent the
// env var this module is inert and Freedom behaves exactly as before. The
// addon's blocking verified reads run on the libuv thread pool and surface
// as Promises, so the main process event loop never blocks.
const log = require('../logger');
const path = require('path');

// The engine ABI version this manager was written against. The addon's
// init() must return exactly this or we refuse to start (a stale addon
// would otherwise fail confusingly deep inside a resolve).
// v19 → v21 (myotis v0.1.3 release): additive only — v20 Tor toggle,
// v21 opt-in eth_getLogs watch-list index. No shape we call changed.
const EXPECTED_ABI = 21;

// Poll/log-drain cadence while the node runs.
const LOG_DRAIN_MS = 15000;

let addon = null;
let handle = -1;
let drainTimer = null;
let lastStatus = null;
let startedAt = 0;
let readyWatchTimer = null;
let wasReady = false;
const readyListeners = new Set();

// Fires callbacks on every not-ready → ready transition (initial sync
// completing, or recovery after a peer-loss regression). The ENS resolver
// uses this to sweep fallback-tier cache entries that would otherwise
// outlive readiness by their TTL. Callback-based to avoid a require cycle
// (ens-resolver already requires this module).
function onReadyTransition(cb) {
  readyListeners.add(cb);
}

// Addon discovery, mirroring freedom-ipfs-native-binding: env override
// (spike/testing) → dev fetch dir (scripts/fetch-myotis.js, per-platform
// subdir) → packaged resources. Enabled iff one of them exists.
function addonPath() {
  const osDir = { darwin: 'mac', linux: 'linux', win32: 'win' }[process.platform];
  const candidates = [
    process.env.MYOTIS_NODE_PATH,
    path.join(
      __dirname, '..', '..', '..', 'myotis-bin', `${osDir}-${process.arch}`, 'myotis-node.node'
    ),
    process.resourcesPath && path.join(process.resourcesPath, 'myotis-node', 'myotis-node.node'),
  ].filter(Boolean);
  return candidates.find((p) => {
    try {
      return require('fs').existsSync(p);
    } catch {
      return false;
    }
  });
}

function isEnabled() {
  return Boolean(addonPath());
}

function defaultDataDir() {
  if (process.env.MYOTIS_DATA_DIR) return process.env.MYOTIS_DATA_DIR;
  // Lazy require so plain-Node harnesses (no electron) can use MYOTIS_DATA_DIR.
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'myotis');
}

function startMyotis({ dataDir } = {}) {
  if (handle >= 1) return true;
  const addonFile = addonPath();
  if (!addonFile) return false;
  try {
    addon = require(addonFile);
  } catch (err) {
    log.warn(`[myotis] addon load failed (${addonFile}): ${err.message}`);
    return false;
  }
  const abi = addon.init();
  if (abi !== EXPECTED_ABI) {
    log.warn(`[myotis] ABI mismatch: engine ${abi}, expected ${EXPECTED_ABI} — not starting`);
    addon = null;
    return false;
  }
  const dir = dataDir || defaultDataDir();
  handle = addon.create('mainnet', dir);
  if (handle < 1) {
    log.warn(`[myotis] create failed: ${handle}`);
    return false;
  }
  if (!addon.start(handle)) {
    log.warn('[myotis] start failed');
    handle = -1;
    return false;
  }
  startedAt = Date.now();
  log.info(`[myotis] node started (mainnet, dataDir=${dir})`);
  drainTimer = setInterval(drainEngineLogs, LOG_DRAIN_MS);
  if (drainTimer.unref) drainTimer.unref();
  wasReady = false;
  readyWatchTimer = setInterval(() => {
    const ready = isReady();
    if (ready && !wasReady) {
      log.info('[myotis] node ready — verified reads available');
      for (const cb of readyListeners) {
        try {
          cb();
        } catch (err) {
          log.warn(`[myotis] ready listener failed: ${err.message}`);
        }
      }
    }
    wasReady = ready;
  }, 10000);
  if (readyWatchTimer.unref) readyWatchTimer.unref();
  return true;
}

function drainEngineLogs() {
  if (!addon) return;
  const batch = addon.drainLogs(200);
  if (!batch) return;
  for (const line of batch.split('\n')) {
    if (/ERROR/.test(line)) log.warn(`[myotis-engine] ${line}`);
    else if (/WARN/.test(line)) log.info(`[myotis-engine] ${line}`);
  }
}

function getStatus() {
  if (!addon || handle < 1) return null;
  try {
    lastStatus = JSON.parse(addon.statusJson(handle));
  } catch {
    return lastStatus;
  }
  return lastStatus;
}

// Ready = the verified read path can actually serve: beacon SYNCED, the EL
// reader up (and not hunting for a servable head context — first reads
// during a hunt fail on the cold context), and at least one snap-capable
// peer held. Callers treat not-ready as "skip myotis, use the next tier" —
// never as an error.
function isReady() {
  const s = getStatus();
  return Boolean(
    s && s.beaconState === 'SYNCED' && s.elReaderAvailable && !s.elHunting && s.snapPeers > 0
  );
}

// --- Verified reads (Promise<parsed JSON>) --------------------------------

async function resolveContenthash(name) {
  const raw = await addon.ensRecordJson(handle, JSON.stringify({ method: 'contenthash', name }));
  return JSON.parse(raw);
}

async function resolveAddress(name) {
  return JSON.parse(await addon.resolveEnsJson(handle, name));
}

async function getAccount(address) {
  return JSON.parse(await addon.requestAccountJson(handle, address));
}

function stopMyotis() {
  if (drainTimer) clearInterval(drainTimer);
  drainTimer = null;
  if (readyWatchTimer) clearInterval(readyWatchTimer);
  readyWatchTimer = null;
  wasReady = false;
  if (addon && handle >= 1) {
    try {
      addon.stop(handle);
      log.info(`[myotis] node stopped (uptime ${Math.round((Date.now() - startedAt) / 1000)}s)`);
    } catch (err) {
      log.warn(`[myotis] stop failed: ${err.message}`);
    }
  }
  handle = -1;
}

// Renderer-facing status snapshot (settings page's ENS section). One flat
// object; `state` is the one-word summary the UI keys copy on.
function publicStatus() {
  const available = Boolean(addonPath());
  if (!available) return { available: false, running: false, state: 'unavailable' };
  if (handle < 1) return { available: true, running: false, state: 'off' };
  const s = getStatus() || {};
  const ready = isReady();
  return {
    available: true,
    running: true,
    state: ready ? 'ready' : 'syncing',
    beaconState: s.beaconState,
    currentPeriod: s.currentPeriod,
    targetPeriod: s.targetPeriod,
    peerCount: s.peerCount,
    snapPeers: s.snapPeers,
    finalizedBlockNumber: s.finalizedBlockNumber,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

function registerMyotisIpc() {
  // Self-contained like the other register*Ipc() functions; lazy electron
  // require keeps the module loadable from plain-Node harnesses.
  const { ipcMain } = require('electron');
  const IPC = require('../../shared/ipc-channels');
  ipcMain.handle(IPC.MYOTIS_GET_STATUS, () => publicStatus());
}

module.exports = {
  isEnabled,
  startMyotis,
  stopMyotis,
  isReady,
  getStatus,
  publicStatus,
  registerMyotisIpc,
  onReadyTransition,
  resolveContenthash,
  resolveAddress,
  getAccount,
};
