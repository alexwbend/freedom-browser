const log = require('./logger');
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const IPC = require('../shared/ipc-channels');
const { loadSettings } = require('./settings-store');

// Per-profile session persistence backing "Continue where you left off".
//
// The renderer captures the tab strip (debounced ~1s, see
// src/renderer/lib/session-restore.js) and sends snapshots here; this module
// is the single writer of `<userData>/session.json`. Single-writer is safe
// without a cross-process file lock (the updater-owner-lock pattern) because
// profile-lock.js already enforces one *process* per profile — a second
// launch of the same profile hands off focus and exits. Multiple windows of
// a profile are multiple BrowserWindows inside this one process, so their
// snapshots are serialized through this module's in-memory map.
//
// File shape (version 1):
//   { version: 1, windows: [{ tabs: [{url, title, pinned, faviconUrl}],
//                             activeTabIndex }] }
//
// A corrupt or truncated session.json (crash mid-write, disk trouble)
// degrades to a fresh session — reads never throw past this module.

const SESSION_FILE = 'session.json';
const SESSION_FILE_VERSION = 1;
const MAX_TABS_PER_WINDOW = 500;
const MAX_FAVICON_CHARS = 65536;

// Live snapshots keyed by the owning window's webContents id. Written to
// disk as a whole on every accepted update.
const liveWindowSnapshots = new Map();

// EPHEMERAL-WINDOW GUARD (private-windows follow-up, feature/private-windows):
// windows flagged ephemeral are excluded from session persistence — the
// writer refuses their snapshots outright. When private windows land, call
// markWindowSessionEphemeral(window.webContents.id) at window creation so a
// private window can never leak tabs into session.json.
const ephemeralWindowIds = new Set();

// Windows persisted by the previous run, loaded once at registration and
// served to renderers via SESSION_GET_RESTORE. Kept in memory so later
// writes can't clobber the data before every window has restored.
let persistedWindows = null;

let appIsQuitting = false;

function getSessionPath() {
  return path.join(app.getPath('userData'), SESSION_FILE);
}

function shouldRestoreSession() {
  return loadSettings().onStartup !== 'homepage';
}

function sanitizeTab(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const url = typeof entry.url === 'string' ? entry.url : '';
  if (!url || url === 'about:blank') return null;
  const faviconUrl =
    typeof entry.faviconUrl === 'string' && entry.faviconUrl.length <= MAX_FAVICON_CHARS
      ? entry.faviconUrl
      : null;
  return {
    url,
    title: typeof entry.title === 'string' ? entry.title : '',
    pinned: entry.pinned === true,
    faviconUrl,
  };
}

function sanitizeWindowSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.tabs)) {
    return null;
  }
  const tabs = snapshot.tabs.slice(0, MAX_TABS_PER_WINDOW).map(sanitizeTab).filter(Boolean);
  const rawIndex = snapshot.activeTabIndex;
  const activeTabIndex = Number.isInteger(rawIndex)
    ? Math.min(Math.max(rawIndex, 0), Math.max(tabs.length - 1, 0))
    : 0;
  return { tabs, activeTabIndex };
}

function readPersistedWindows() {
  const filePath = getSessionPath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || !Array.isArray(parsed.windows)) return [];
    return parsed.windows.map(sanitizeWindowSnapshot).filter((win) => win && win.tabs.length > 0);
  } catch (err) {
    log.warn('Corrupt session.json, starting a fresh session:', err.message);
    return [];
  }
}

function ensurePersistedWindowsLoaded() {
  if (persistedWindows === null) {
    persistedWindows = readPersistedWindows();
  }
  return persistedWindows;
}

// Atomic write: temp file + rename, so a crash mid-write leaves either the
// previous session or the new one — never a truncated file.
function writeSessionFile() {
  const filePath = getSessionPath();
  const tmpPath = `${filePath}.tmp`;
  const state = {
    version: SESSION_FILE_VERSION,
    windows: [...liveWindowSnapshots.values()],
  };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(state), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    log.error('Failed to write session.json:', err);
    return false;
  }
}

// Number of windows the previous session persisted (0 when the startup
// setting is "Start with home page"). Bootstrap recreates one window per
// slot; slot 0 is the first window it creates anyway.
function getRestorableWindowCount() {
  if (!shouldRestoreSession()) return 0;
  return ensurePersistedWindowsLoaded().length;
}

// See the EPHEMERAL-WINDOW GUARD note above.
function markWindowSessionEphemeral(webContentsId) {
  if (Number.isInteger(webContentsId)) {
    ephemeralWindowIds.add(webContentsId);
  }
}

// Called from mainWindow.js when a BrowserWindow closes. A window the user
// closes mid-session is forgotten (its tabs shouldn't reappear next launch),
// with two exceptions that both mean "the session is ending, keep the file
// for next launch's restore": app quit, and the last remaining window.
function handleSessionWindowClosed(webContentsId) {
  ephemeralWindowIds.delete(webContentsId);
  if (appIsQuitting) return;
  if (!liveWindowSnapshots.has(webContentsId)) return;
  if (liveWindowSnapshots.size <= 1) return;
  liveWindowSnapshots.delete(webContentsId);
  writeSessionFile();
}

function registerSessionIpc() {
  ensurePersistedWindowsLoaded();

  app.on('before-quit', () => {
    appIsQuitting = true;
  });

  // Renderer → main snapshot updates. The renderer already debounces (~1s),
  // so each accepted update is written straight through, atomically.
  ipcMain.on(IPC.SESSION_UPDATE, (event, snapshot) => {
    const senderId = event?.sender?.id;
    if (!Number.isInteger(senderId)) return;
    // EPHEMERAL-WINDOW GUARD — see markWindowSessionEphemeral().
    if (ephemeralWindowIds.has(senderId)) return;
    const clean = sanitizeWindowSnapshot(snapshot);
    if (!clean) return;
    liveWindowSnapshots.set(senderId, clean);
    writeSessionFile();
  });

  // A window launched with a restoreSlot query param asks for its persisted
  // snapshot. Returns null when there is nothing to restore (fresh profile,
  // corrupt file, or startup setting = home page). The served snapshot also
  // seeds the live map so a window whose tabs never change before the next
  // quit still keeps its entry in session.json.
  ipcMain.handle(IPC.SESSION_GET_RESTORE, (event, slot) => {
    if (!shouldRestoreSession()) return null;
    const windows = ensurePersistedWindowsLoaded();
    const snapshot = Number.isInteger(slot) && windows[slot] ? windows[slot] : null;
    const senderId = event?.sender?.id;
    if (snapshot && Number.isInteger(senderId) && !ephemeralWindowIds.has(senderId)) {
      liveWindowSnapshots.set(senderId, snapshot);
    }
    return snapshot;
  });
}

module.exports = {
  getRestorableWindowCount,
  handleSessionWindowClosed,
  markWindowSessionEphemeral,
  registerSessionIpc,
};
