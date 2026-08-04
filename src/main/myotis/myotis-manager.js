// EXPERIMENTAL (spike): Myotis — a fully peer-to-peer Ethereum light client
// (devp2p + beacon light client; every read Merkle-proven against a
// sync-committee-anchored state root). Runs invisibly like the ant/IPFS
// nodes, via a napi-rs native addon over the myotis-engine C ABI.
//
// Available through an explicit MYOTIS_NODE_PATH, the development download,
// or the packaged resource. Profile configuration can disable it; otherwise
// the profile-local autostart preference or Nodes UI controls its lifecycle.
// The addon's blocking verified reads run on the libuv thread pool and surface
// as Promises, so the main process event loop never blocks.
const log = require('../logger');
const path = require('path');
const { getMyotisDataDir } = require('../profile-paths');

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
let lastError = null;
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
  return Boolean(addonPath()) && !isDisabledMyotisConfig();
}

function getProfileMyotisConfig() {
  return require('../profile-resolver').getActiveProfile()?.metadata?.nodes?.myotis || null;
}

function isDisabledMyotisConfig(config = getProfileMyotisConfig()) {
  return config?.mode === 'disabled';
}

function getMyotisDataPath() {
  return getMyotisDataDir();
}

function broadcastStatus(status = publicStatus()) {
  try {
    const { BrowserWindow } = require('electron');
    const IPC = require('../../shared/ipc-channels');
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.MYOTIS_STATUS_UPDATE, status);
    }
  } catch {
    // Electron may be unavailable in plain-Node tests and tooling.
  }
}

function registryMessage(status) {
  if (status.state === 'disabled') return 'Disabled';
  if (status.state === 'unavailable') return 'Native addon unavailable';
  if (status.state === 'error') return `Error: ${status.error}`;
  if (status.state === 'off') return 'Not running';
  if (status.state === 'ready') return 'Ready: verified Ethereum reads available';
  return `Syncing: ${status.peerCount ?? 0} peers`;
}

function publishStatus(status = publicStatus()) {
  try {
    const { MODE, updateService } = require('../service-registry');
    updateService('myotis', {
      mode:
        status.state === 'disabled'
          ? MODE.DISABLED
          : status.running
            ? MODE.BUNDLED
            : MODE.NONE,
      statusMessage: registryMessage(status),
    });
  } catch {
    // The service registry is unavailable in plain-Node tooling.
  }
  broadcastStatus(status);
  return status;
}

function startMyotis({ dataDir } = {}) {
  if (handle >= 1) return true;
  if (isDisabledMyotisConfig()) {
    publishStatus();
    return false;
  }
  const addonFile = addonPath();
  if (!addonFile) {
    publishStatus();
    return false;
  }
  try {
    addon = require(addonFile);
  } catch (err) {
    lastError = err.message;
    log.warn(`[myotis] addon load failed (${addonFile}): ${err.message}`);
    publishStatus();
    return false;
  }
  let abi;
  try {
    abi = addon.init();
  } catch (err) {
    lastError = err.message;
    log.warn(`[myotis] init failed: ${err.message}`);
    addon = null;
    publishStatus();
    return false;
  }
  if (abi !== EXPECTED_ABI) {
    lastError = `ABI mismatch: engine ${abi}, expected ${EXPECTED_ABI}`;
    log.warn(`[myotis] ABI mismatch: engine ${abi}, expected ${EXPECTED_ABI} — not starting`);
    addon = null;
    publishStatus();
    return false;
  }
  const dir = dataDir || getMyotisDataPath();
  try {
    handle = addon.create('mainnet', dir);
  } catch (err) {
    lastError = err.message;
    log.warn(`[myotis] create failed: ${err.message}`);
    publishStatus();
    return false;
  }
  if (handle < 1) {
    lastError = `Native create returned handle ${handle}`;
    log.warn(`[myotis] create failed: ${handle}`);
    publishStatus();
    return false;
  }
  let started;
  try {
    started = addon.start(handle);
  } catch (err) {
    lastError = err.message;
    log.warn(`[myotis] start failed: ${err.message}`);
    handle = -1;
    publishStatus();
    return false;
  }
  if (!started) {
    lastError = 'Native client refused to start';
    log.warn('[myotis] start failed');
    handle = -1;
    publishStatus();
    return false;
  }
  startedAt = Date.now();
  lastStatus = null;
  lastError = null;
  log.info(`[myotis] node started (mainnet, dataDir=${dir})`);
  publishStatus();
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
    publishStatus();
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
  lastStatus = null;
  startedAt = 0;
  lastError = null;
  publishStatus();
}

// Targets the upstream release publishes addons for (win-arm64 notably
// absent). Keys are process.platform-process.arch. Mirrors the matrix in
// scripts/fetch-myotis.js / check-binaries.js.
const SUPPORTED_TARGETS = new Set([
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
]);

function isSupportedTarget() {
  return SUPPORTED_TARGETS.has(`${process.platform}-${process.arch}`);
}

// Renderer-facing status snapshot (Nodes UI and settings ENS section). One flat
// object; `state` is the one-word summary the UI keys copy on. `supported`
// lets the UI distinguish "this platform can never run Myotis" (hide the
// controls) from "addon merely not installed" (disable with a hint).
function publicStatus() {
  const supported = isSupportedTarget();
  const available = Boolean(addonPath());
  if (isDisabledMyotisConfig()) {
    return { supported, available, running: false, state: 'disabled' };
  }
  if (!available) return { supported, available: false, running: false, state: 'unavailable' };
  if (lastError) {
    return { supported, available: true, running: false, state: 'error', error: lastError };
  }
  if (handle < 1) return { supported, available: true, running: false, state: 'off' };
  const s = getStatus() || {};
  const ready = isReady();
  return {
    supported,
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
  ipcMain.handle(IPC.MYOTIS_START, () => {
    startMyotis();
    return publicStatus();
  });
  ipcMain.handle(IPC.MYOTIS_STOP, () => {
    stopMyotis();
    return publicStatus();
  });
  ipcMain.handle(IPC.MYOTIS_GET_STATUS, () => publicStatus());
  publishStatus();
}

function refreshMyotisStatus() {
  return publishStatus();
}

module.exports = {
  isEnabled,
  isDisabledMyotisConfig,
  getMyotisDataPath,
  startMyotis,
  stopMyotis,
  isReady,
  getStatus,
  publicStatus,
  registerMyotisIpc,
  refreshMyotisStatus,
  onReadyTransition,
  resolveContenthash,
  resolveAddress,
  getAccount,
};
