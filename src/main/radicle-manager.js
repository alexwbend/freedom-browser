const fs = require('fs');
const path = require('path');
const { ipcMain, BrowserWindow } = require('electron');
const log = require('./logger');
const IPC = require('../shared/ipc-channels');
const { success, failure, validateNonEmptyString } = require('./ipc-contract');
const { loadSettings } = require('./settings-store');
const { getRadicleDataDir } = require('./profile-paths');
const { getActiveProfile } = require('./profile-resolver');
const embedded = require('./radicle-embedded');
const seedStatus = require('./radicle/seed-status');
const {
  MODE,
  updateService,
  setStatusMessage,
  clearService,
} = require('./service-registry');

const FREEDOM_BROWSER_RID = 'rad:z3QXuMvMmSeEX3ZgoUidZC1v5MkKE';
const LEGACY_SEED_REPLACEMENTS = new Map([
  ['iris.radicle.xyz', 'iris.radicle.network'],
  ['rosa.radicle.xyz', 'rosa.radicle.network'],
]);

const STATUS = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  ERROR: 'error',
};

let currentState = STATUS.STOPPED;
let lastError = null;
let useInjectedIdentity = false;
let lifecycleTail = Promise.resolve();

function enqueueLifecycle(operation) {
  const result = lifecycleTail.then(operation, operation);
  lifecycleTail = result.catch(() => {});
  return result;
}

function migrateLegacySeeds(radHome) {
  const configPath = path.join(radHome, 'config.json');
  if (!fs.existsSync(configPath)) return;

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    log.warn('[Radicle] Could not migrate legacy seed hosts:', err.message);
    return;
  }
  if (!Array.isArray(config.preferredSeeds)) return;

  let changed = false;
  config.preferredSeeds = config.preferredSeeds.map((seed) => {
    if (typeof seed !== 'string') return seed;
    let normalized = seed;
    for (const [legacyHost, currentHost] of LEGACY_SEED_REPLACEMENTS) {
      normalized = normalized.replace(`@${legacyHost}:`, `@${currentHost}:`);
    }
    changed ||= normalized !== seed;
    return normalized;
  });
  if (changed) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    log.info('[Radicle] Migrated legacy preferred seed hosts');
  }
}

function validateAndNormalizeRid(rid) {
  if (!rid || typeof rid !== 'string') return null;
  let bare = rid;
  if (bare.startsWith('rad://')) bare = bare.slice(6);
  else if (bare.startsWith('rad:')) bare = bare.slice(4);
  if (!/^z[1-9A-HJ-NP-Za-km-z]{20,60}$/.test(bare)) return null;
  return `rad:${bare}`;
}

function updateState(status, error = null) {
  log.info('[Radicle] State change:', currentState, '->', status, error || '');
  currentState = status;
  lastError = error;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.RADICLE_STATUS_UPDATE, { status, error });
  }
}

function isDisabledForProfile() {
  return getActiveProfile()?.metadata?.nodes?.radicle?.mode === 'disabled';
}

async function connectAndSeedDefault() {
  try {
    const { connected } = await embedded.connectSeeds(15000);
    log.info(`[Radicle] Connected to ${connected} preferred seed(s)`);
    await embedded.cloneRepo(FREEDOM_BROWSER_RID, 120000);
    log.info(`[Radicle] Default repository available: ${FREEDOM_BROWSER_RID}`);
  } catch (err) {
    log.warn('[Radicle] Background network initialization failed:', err.message);
  }
}

async function startRadicleInternal() {
  if (currentState === STATUS.RUNNING) return getCurrentStatus();
  if (isDisabledForProfile()) {
    updateService('radicle', { api: null, gateway: null, mode: MODE.DISABLED });
    setStatusMessage('radicle', 'Node disabled for this profile');
    updateState(STATUS.STOPPED);
    return getCurrentStatus();
  }
  if (!embedded.isAvailable()) {
    const message = 'libradicle addon is not installed';
    clearService('radicle');
    updateState(STATUS.ERROR, message);
    return getCurrentStatus();
  }

  updateState(STATUS.STARTING);
  try {
    const radHome = getRadicleDataDir();
    migrateLegacySeeds(radHome);
    const result = await embedded.start(radHome, 'FreedomBrowser');
    updateService('radicle', {
      api: 'radapi://local',
      gateway: 'radapi://local',
      mode: MODE.EMBEDDED,
    });
    setStatusMessage('radicle', 'Embedded node running');
    updateState(STATUS.RUNNING);
    log.info('[Radicle] Embedded node started:', result.did);
    void connectAndSeedDefault();
    return getCurrentStatus();
  } catch (err) {
    clearService('radicle');
    updateState(STATUS.ERROR, err.message);
    return getCurrentStatus();
  }
}

function startRadicle() {
  return enqueueLifecycle(startRadicleInternal);
}

async function stopRadicleInternal() {
  if (currentState === STATUS.STOPPED) return getCurrentStatus();
  updateState(STATUS.STOPPING);
  try {
    await embedded.shutdown();
    clearService('radicle');
    updateState(STATUS.STOPPED);
  } catch (err) {
    clearService('radicle');
    updateState(STATUS.ERROR, err.message);
  }
  return getCurrentStatus();
}

function stopRadicle() {
  return enqueueLifecycle(stopRadicleInternal);
}

function requireRunning() {
  return currentState === STATUS.RUNNING
    ? null
    : failure('RADICLE_NOT_RUNNING', 'Radicle node is not running');
}

async function repoExists(rid) {
  try {
    await embedded.repoInfo(rid);
    return true;
  } catch {
    return false;
  }
}

async function getSeederCount(rid) {
  return (await embedded.seeders(rid)).seeding;
}

function startTrackedFetch(rid) {
  const status = seedStatus.startFetch(rid, {
    fetchRepo: (value, onProgress) =>
      embedded.cloneRepoWithProgress(value, 120000, onProgress),
    getSeeders: getSeederCount,
  });
  return success({ status });
}

async function seedRepository(rid) {
  const unavailable = requireRunning();
  if (unavailable) return unavailable;
  const fullRid = validateAndNormalizeRid(rid);
  if (!fullRid) return failure('INVALID_RID', 'Invalid Radicle Repository ID', { rid });
  return startTrackedFetch(fullRid);
}

async function refetchRepository(rid) {
  return seedRepository(rid);
}

async function getSeedFetchStatus(rid) {
  const fullRid = validateAndNormalizeRid(rid);
  if (!fullRid) return failure('INVALID_RID', 'Invalid Radicle Repository ID', { rid });
  const status = await seedStatus.getStatus(fullRid, {
    repoExists,
    getSeeders: getSeederCount,
  });
  return success({ status });
}

async function cancelCloneWithRetry(rid) {
  const delays = [0, 10, 25, 50, 100];
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const result = await embedded.cancelClone(rid);
      if (result?.cancelled) return true;
    } catch (err) {
      log.warn(`[Radicle] Could not request clone cancellation for ${rid}:`, err.message);
      return false;
    }
  }
  return false;
}

async function unseedRepository(rid) {
  const unavailable = requireRunning();
  if (unavailable) return unavailable;
  const fullRid = validateAndNormalizeRid(rid);
  if (!fullRid) return failure('INVALID_RID', 'Invalid Radicle Repository ID', { rid });
  const fetchDone = seedStatus.cancelFetch(fullRid);
  const cancellation = fetchDone ? cancelCloneWithRetry(fullRid) : Promise.resolve(false);
  // Heartwood's pack transfer is a blocking operation, so native
  // cancellation can only be observed when that call returns. Re-apply
  // the policy afterward to prevent a late clone from leaving the repo
  // seeded after the user explicitly unseeded it, even if the immediate
  // unseed attempt fails.
  if (fetchDone) {
    void Promise.all([fetchDone, cancellation])
      .then(() => embedded.unseedRepo(fullRid))
      .catch((err) => log.warn(`[Radicle] Final unseed failed for ${fullRid}:`, err.message));
  }
  try {
    await embedded.unseedRepo(fullRid);
    return success();
  } catch (err) {
    return failure('UNSEED_FAILED', err.message, { rid: fullRid });
  }
}

async function getConnections() {
  const unavailable = requireRunning();
  if (unavailable) {
    return {
      ...unavailable,
      count: 0,
      reposCount: null,
      version: embedded.getVersion(),
    };
  }
  try {
    const { connectedPeers } = await embedded.status();
    let reposCount = null;
    try {
      const repos = await embedded.listRepos();
      reposCount = Array.isArray(repos) ? repos.length : null;
    } catch (err) {
      log.warn('[Radicle] Could not read seeded repository count:', err.message);
    }
    return success({
      count: connectedPeers,
      reposCount,
      version: embedded.getVersion(),
    });
  } catch (err) {
    return failure('GET_CONNECTIONS_FAILED', err.message, undefined, {
      count: 0,
      reposCount: null,
      version: embedded.getVersion(),
    });
  }
}

function getCurrentStatus() {
  return { status: currentState, error: lastError };
}

function getRadicleDataPath() {
  return getRadicleDataDir();
}

function setUseInjectedIdentity(enabled) {
  useInjectedIdentity = Boolean(enabled);
}

function hasInjectedIdentity() {
  return useInjectedIdentity;
}

function checkBinary() {
  return embedded.isAvailable();
}

function getNodeAlias() {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(getRadicleDataDir(), 'config.json'), 'utf8')
    );
    return config?.node?.alias || null;
  } catch {
    return null;
  }
}

function isValidAlias(alias) {
  return (
    typeof alias === 'string' &&
    alias.length > 0 &&
    Buffer.byteLength(alias, 'utf8') <= 32 &&
    // eslint-disable-next-line no-control-regex
    !/[\s\u0000-\u001f\u007f]/.test(alias)
  );
}

function setNodeAlias(alias) {
  if (!isValidAlias(alias)) {
    return Promise.resolve(failure(
      'INVALID_ALIAS',
      'Alias must be 1–32 bytes with no whitespace or control characters'
    ));
  }
  return enqueueLifecycle(async () => {
    const restart = currentState === STATUS.RUNNING;
    if (restart) await stopRadicleInternal();
    const configPath = path.join(getRadicleDataDir(), 'config.json');
    try {
      let config = {};
      if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.node = config.node || {};
      config.node.alias = alias;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      return failure('ALIAS_WRITE_FAILED', err.message);
    }
    if (restart) await startRadicleInternal();
    return success({ alias, restarted: restart });
  });
}

function integrationEnabled() {
  return loadSettings().enableRadicleIntegration === true;
}

function registerRadicleIpc() {
  const disabled = () => ({
    status: STATUS.STOPPED,
    error: 'Radicle integration is disabled. Enable it in Settings > Experimental',
  });

  ipcMain.handle(IPC.RADICLE_START, async () => {
    if (!integrationEnabled()) return disabled();
    return startRadicle();
  });
  ipcMain.handle(IPC.RADICLE_STOP, () => stopRadicle());
  ipcMain.handle(IPC.RADICLE_GET_STATUS, () =>
    integrationEnabled() ? getCurrentStatus() : disabled()
  );
  ipcMain.handle(IPC.RADICLE_CHECK_BINARY, () => ({ available: checkBinary() }));
  ipcMain.handle(IPC.RADICLE_SEED, async (_event, rid) => {
    if (!integrationEnabled()) return failure('RADICLE_DISABLED', disabled().error);
    if (!validateNonEmptyString(rid)) return failure('INVALID_RID', 'Missing repository ID');
    return seedRepository(rid);
  });
  ipcMain.handle(IPC.RADICLE_GET_CONNECTIONS, () => getConnections());
  ipcMain.handle(IPC.RADICLE_SYNC_REPO, (_event, rid) => refetchRepository(rid));
  ipcMain.handle(IPC.RADICLE_GET_SEED_STATUS, (_event, rid) => getSeedFetchStatus(rid));
}

module.exports = {
  registerRadicleIpc,
  startRadicle,
  stopRadicle,
  getRadicleDataPath,
  setUseInjectedIdentity,
  hasInjectedIdentity,
  getCurrentStatus,
  getConnections,
  seedRepository,
  unseedRepository,
  getSeedFetchStatus,
  refetchRepository,
  validateAndNormalizeRid,
  getNodeAlias,
  setNodeAlias,
  STATUS,
};
