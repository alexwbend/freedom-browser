/**
 * Private (ephemeral) browsing windows.
 *
 * Each private window gets a unique NON-persisted Electron session via a
 * `private-<uuid>` partition (no `persist:` prefix, so Chromium keeps all
 * site data — cookies, localStorage, IndexedDB, caches — in memory only).
 * The partition name is plumbed to the window's renderer as a query
 * parameter; tabs.js stamps it on every webview it creates BEFORE first
 * load, so no private page ever touches the default session.
 *
 * On window close the partition's session is cleared with
 * `clearStorageData()` + `clearCache()` as belt-and-braces (the data is
 * in-memory anyway), registered cleanup hooks run (private downloads
 * purge, session-only permission decisions drop — see src/main/index.js),
 * and all references are dropped. Partition UUIDs are never reused.
 *
 * Write guards elsewhere key off this module's registry:
 *   - history:   src/main/history.js         (PRIVATE MODE GUARD)
 *   - favicons:  src/main/favicons.js        (PRIVATE MODE GUARD)
 *   - publish:   src/main/swarm/publish-service.js (PRIVATE MODE GUARD)
 *   - providers: src/main/webview-preload.js (PRIVATE MODE GUARD, via the
 *                `private:is-private` sync IPC in ipc-handlers.js)
 */

const crypto = require('crypto');
const log = require('../logger');
const { BrowserWindow, session } = require('electron');

// Lazy: this module is required by the write guards (history, favicons,
// publish-service) purely for isPrivateWebContents(); pulling the window
// factory (and its settings-store dependency tree) into their module
// graphs at require time would be wasted weight — and makes their Jest
// suites needlessly heavy.
function requireCreateMainWindow() {
  return require('../windows/mainWindow').createMainWindow;
}

const PRIVATE_PARTITION_PREFIX = 'private-';

// Live private windows: BrowserWindow id -> { partition, session }.
const privateWindows = new Map();
// All partitions ever created by this process (a closed window's partition
// stays "known" so late IPC from a tearing-down window is still recognised
// as private — deny-by-default for anything that ever was private).
const privatePartitions = new Set();
// Live private session objects, for fast sender.session identity checks.
const privateSessions = new Set();

// Configures a freshly created private session (protocol handlers, download
// hook, permission handlers, webRequest dispatcher). Set once at bootstrap
// by src/main/index.js — kept as an injection point so this module doesn't
// import half the app (and so tests can observe the call).
let sessionConfigurator = null;

// Cleanup hooks run (best-effort) when a private window closes, with the
// window's partition name. Registered at bootstrap: private downloads
// purge, session-only permission decisions drop.
const cleanupHooks = [];

function setPrivateSessionConfigurator(fn) {
  sessionConfigurator = typeof fn === 'function' ? fn : null;
}

function registerPrivateCleanup(fn) {
  if (typeof fn === 'function') cleanupHooks.push(fn);
}

function isPrivatePartition(partition) {
  return typeof partition === 'string' && privatePartitions.has(partition);
}

/**
 * True when the given webContents belongs to a private window — either a
 * webview running on a private partition (session identity) or the private
 * window's own chrome renderer (owning BrowserWindow identity). Used by the
 * main-process write guards; `undefined`/destroyed senders report false.
 */
function isPrivateWebContents(webContents) {
  if (!webContents) return false;
  try {
    if (webContents.session && privateSessions.has(webContents.session)) {
      return true;
    }
  } catch {
    // webContents may be destroyed mid-check
  }
  try {
    const host = webContents.hostWebContents || webContents;
    const win = BrowserWindow.fromWebContents(host);
    return !!win && privateWindows.has(win.id);
  } catch {
    return false;
  }
}

/** Partition name for a private window's webContents, or null. */
function getPartitionForWebContents(webContents) {
  if (!webContents) return null;
  try {
    const host = webContents.hostWebContents || webContents;
    const win = BrowserWindow.fromWebContents(host);
    if (win && privateWindows.has(win.id)) {
      return privateWindows.get(win.id).partition;
    }
  } catch {
    // fall through
  }
  return null;
}

function runCleanupHooks(partition) {
  for (const hook of cleanupHooks) {
    try {
      hook(partition);
    } catch (err) {
      log.error('[private] cleanup hook failed:', err?.message || err);
    }
  }
}

/**
 * Evaporate the private session's in-memory state. The non-persisted
 * partition holds nothing on disk, but clearing explicitly is the
 * belt-and-braces the feature promises (and covers Chromium caches that
 * outlive the last webContents on the session).
 */
async function destroyPrivateSession(privateSession, partition) {
  try {
    await privateSession.clearStorageData();
  } catch (err) {
    log.warn(`[private] clearStorageData failed for ${partition}:`, err?.message || err);
  }
  try {
    await privateSession.clearCache();
  } catch (err) {
    log.warn(`[private] clearCache failed for ${partition}:`, err?.message || err);
  }
}

/**
 * Open a new private browsing window.
 *
 * @param {string|null} initialUrl - optional URL for the first tab
 * @returns {Electron.BrowserWindow}
 */
function createPrivateWindow(initialUrl = null) {
  const partition = `${PRIVATE_PARTITION_PREFIX}${crypto.randomUUID()}`;
  // No `persist:` prefix — this is the whole point: Electron keeps the
  // session in memory and never writes site data under userData.
  const privateSession = session.fromPartition(partition);

  privatePartitions.add(partition);
  privateSessions.add(privateSession);

  if (sessionConfigurator) {
    try {
      sessionConfigurator(privateSession, { partition });
    } catch (err) {
      log.error('[private] session configurator failed:', err?.message || err);
    }
  } else {
    log.warn('[private] no session configurator installed — private session is bare');
  }

  const window = requireCreateMainWindow()(initialUrl, { privatePartition: partition });
  privateWindows.set(window.id, { partition, session: privateSession });
  log.info(`[private] Opened private window ${window.id} on partition ${partition}`);

  window.on('closed', () => {
    privateWindows.delete(window.id);
    runCleanupHooks(partition);
    destroyPrivateSession(privateSession, partition).finally(() => {
      privateSessions.delete(privateSession);
      log.info(`[private] Private window closed, partition ${partition} cleared`);
    });
  });

  return window;
}

function getPrivateWindowCount() {
  return privateWindows.size;
}

// Test-only: drop all registry state (Jest suites share the module).
function _resetState() {
  privateWindows.clear();
  privatePartitions.clear();
  privateSessions.clear();
  cleanupHooks.length = 0;
  sessionConfigurator = null;
}

module.exports = {
  PRIVATE_PARTITION_PREFIX,
  createPrivateWindow,
  setPrivateSessionConfigurator,
  registerPrivateCleanup,
  isPrivatePartition,
  isPrivateWebContents,
  getPartitionForWebContents,
  getPrivateWindowCount,
  _resetState,
};
