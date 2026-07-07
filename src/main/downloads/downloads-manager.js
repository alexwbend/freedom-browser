/**
 * Downloads manager. Hooks `will-download` on a session (the app runs all
 * webviews on the default session — see src/main/index.js) and owns the
 * DownloadItem lifecycle: save-path selection, progress, pause / resume /
 * cancel, and the completed / cancelled / interrupted terminal states.
 *
 * `protocol.handle`-served custom schemes (bzz:, ipfs:, ipns:) route their
 * downloads through the Chromium download manager too, so decentralized
 * downloads land here alongside http(s) ones — verified against Electron 43
 * for attachment dispositions, `download`-attribute clicks, data: URIs, and
 * non-renderable main-frame navigations.
 *
 * Persistence lives in downloads-store.js (per-profile downloads.sqlite).
 * Completed files are never opened automatically; open / show-in-folder are
 * explicit user actions arriving over IPC and resolved against the stored
 * row, never against a renderer-supplied path.
 */

const log = require('../logger');
const { app, ipcMain, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const IPC = require('../../shared/ipc-channels');
const store = require('./downloads-store');
const { loadSettings } = require('../settings-store');
const { broadcastToAllWebContents } = require('../lib/broadcast-to-all-webcontents');

// Live DownloadItems by store row id — pause/resume/cancel IPC resolves
// through this map; settled items are removed.
const activeItems = new Map();

// Progress writes/broadcasts are throttled per item so a fast download
// doesn't flood SQLite and IPC. Terminal transitions always flush.
const PROGRESS_THROTTLE_MS = 250;

/**
 * Sanitize a server/URL-suggested filename: strip directory components
 * (path traversal), control characters, and leading dots, and cap the
 * length. Falls back to 'download' when nothing usable remains.
 * @param {string} name - Suggested filename
 * @returns {string} Safe basename
 */
function sanitizeFilename(name) {
  let base = String(name || '');
  // Directory components — take the final segment of either separator.
  base = base.split(/[/\\]/).pop() || '';
  // Control characters and characters that break paths on some platforms.
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[\x00-\x1f\x7f]/g, '').replace(/[<>:"|?*]/g, '_');
  // Leading dots (hidden files / '..' remnants) and surrounding whitespace.
  base = base.replace(/^\.+/, '').trim();
  if (base.length > 255) {
    const ext = path.extname(base).slice(0, 32);
    base = base.slice(0, 255 - ext.length) + ext;
  }
  return base || 'download';
}

/**
 * Pick a collision-free path in `dir` for `filename` by appending " (n)"
 * before the extension, matching Chromium's behavior.
 * @param {string} dir - Target directory
 * @param {string} filename - Sanitized filename
 * @returns {string} Absolute path that does not exist yet
 */
function uniqueSavePath(dir, filename) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${counter})${ext}`);
    counter++;
  }
  return candidate;
}

/**
 * Map a live DownloadItem to the renderer-facing payload. Shape matches the
 * store rows (snake_case columns) so the downloads page renders both the
 * same way, plus live-only flags for pause/resume affordances.
 */
function serializeDownload(id, item) {
  return {
    id,
    url: item.getURL(),
    filename: path.basename(item.getSavePath() || '') || sanitizeFilename(item.getFilename()),
    save_path: item.getSavePath() || null,
    mime_type: item.getMimeType() || null,
    total_bytes: item.getTotalBytes(),
    received_bytes: item.getReceivedBytes(),
    state: store.STATES.IN_PROGRESS,
    is_paused: item.isPaused(),
    can_resume: item.canResume(),
  };
}

function ownerWindowOf(webContents) {
  if (!webContents) return null;
  // Webview-initiated downloads: the shelf lives in the hosting chrome
  // renderer, so resolve through hostWebContents when present.
  const host = webContents.hostWebContents || webContents;
  return BrowserWindow.fromWebContents(host);
}

function sendToOwner(ownerWindow, payload) {
  if (ownerWindow && !ownerWindow.isDestroyed()) {
    ownerWindow.webContents.send(IPC.DOWNLOADS_UPDATED, payload);
  }
  // The freedom://downloads page may be open in any window; it re-queries
  // the store on this signal.
  broadcastToAllWebContents(IPC.DOWNLOADS_CHANGED, payload);
}

function handleWillDownload(_event, item, webContents) {
  const filename = sanitizeFilename(item.getFilename());
  const settings = loadSettings();
  const downloadsDir = app.getPath('downloads');

  if (settings.askWhereToSave === true) {
    // No savePath set → Electron shows its native save dialog; we only seed
    // the suggested location. Cancelling the dialog cancels the item.
    item.setSaveDialogOptions({ defaultPath: path.join(downloadsDir, filename) });
  } else {
    try {
      fs.mkdirSync(downloadsDir, { recursive: true });
    } catch (err) {
      log.warn('[Downloads] Could not ensure downloads dir:', err.message);
    }
    item.setSavePath(uniqueSavePath(downloadsDir, filename));
  }

  const row = store.insertDownload({
    url: item.getURL(),
    filename,
    savePath: item.getSavePath() || null,
    mimeType: item.getMimeType() || null,
    totalBytes: item.getTotalBytes(),
    startTime: Date.now(),
  });
  const id = row.id;
  activeItems.set(id, item);

  const ownerWindow = ownerWindowOf(webContents);
  log.info('[Downloads] Download started:', filename, `(id ${id})`);
  sendToOwner(ownerWindow, serializeDownload(id, item));

  let lastProgressAt = 0;
  item.on('updated', () => {
    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
    lastProgressAt = now;

    store.updateDownload(id, {
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      // The save dialog resolves the path after insert; keep the row current.
      savePath: item.getSavePath() || null,
    });
    sendToOwner(ownerWindow, serializeDownload(id, item));
  });

  item.once('done', (_doneEvent, doneState) => {
    activeItems.delete(id);

    // Electron reports 'completed' | 'cancelled' | 'interrupted'; the store
    // uses the same vocabulary (snake-cased in_progress aside).
    const state =
      doneState === 'completed'
        ? store.STATES.COMPLETED
        : doneState === 'cancelled'
          ? store.STATES.CANCELLED
          : store.STATES.INTERRUPTED;

    store.updateDownload(id, {
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      savePath: item.getSavePath() || null,
      state,
      endTime: Date.now(),
    });

    log.info('[Downloads] Download', doneState + ':', filename, `(id ${id})`);
    sendToOwner(ownerWindow, {
      ...serializeDownload(id, item),
      state,
      is_paused: false,
      can_resume: false,
    });
  });
}

/**
 * Hook `will-download` on the given session. Call once per session that
 * hosts downloadable content (today: the default session only).
 * @param {Electron.Session} targetSession
 */
function attachDownloadsManager(targetSession) {
  if (!targetSession || typeof targetSession.on !== 'function') {
    log.warn('[Downloads] session unavailable — skipping will-download hook');
    return;
  }
  targetSession.on('will-download', handleWillDownload);
  log.info('[Downloads] will-download hook attached');
}

/**
 * Merge live pause/resume flags onto stored rows so the downloads page can
 * offer the right controls without a second live-state channel.
 */
function withLiveFlags(rows) {
  return rows.map((dbRow) => {
    const item = activeItems.get(dbRow.id);
    if (!item) return dbRow;
    return {
      ...dbRow,
      received_bytes: item.getReceivedBytes(),
      total_bytes: item.getTotalBytes(),
      is_paused: item.isPaused(),
      can_resume: item.canResume(),
    };
  });
}

/**
 * Register IPC handlers for download operations
 */
function registerDownloadsIpc() {
  // Crash recovery: rows a previous run left in_progress are dead.
  store.markStaleInProgressAsInterrupted();

  ipcMain.handle(IPC.DOWNLOADS_GET, (_event, options = {}) => {
    const { query, limit } = options;
    const rows = query ? store.searchDownloads(query, limit || 100) : store.getAllDownloads();
    return withLiveFlags(rows);
  });

  ipcMain.handle(IPC.DOWNLOADS_PAUSE, (_event, id) => {
    const item = activeItems.get(id);
    if (!item) return false;
    item.pause();
    return true;
  });

  ipcMain.handle(IPC.DOWNLOADS_RESUME, (_event, id) => {
    const item = activeItems.get(id);
    if (!item || !item.canResume()) return false;
    item.resume();
    return true;
  });

  ipcMain.handle(IPC.DOWNLOADS_CANCEL, (_event, id) => {
    const item = activeItems.get(id);
    if (!item) return false;
    item.cancel();
    return true;
  });

  // Open and show-in-folder resolve the path from the stored row — a
  // renderer can only ever act on files this manager wrote, never on an
  // arbitrary path. Files are never opened without this explicit request.
  ipcMain.handle(IPC.DOWNLOADS_OPEN_FILE, async (_event, id) => {
    const row = store.getDownloadById(id);
    if (!row || row.state !== store.STATES.COMPLETED || !row.save_path) {
      return { success: false, error: 'Download is not completed' };
    }
    if (!fs.existsSync(row.save_path)) {
      return { success: false, error: 'File no longer exists' };
    }
    const openError = await shell.openPath(row.save_path);
    if (openError) {
      return { success: false, error: openError };
    }
    return { success: true };
  });

  ipcMain.handle(IPC.DOWNLOADS_SHOW_IN_FOLDER, (_event, id) => {
    const row = store.getDownloadById(id);
    if (!row || !row.save_path || !fs.existsSync(row.save_path)) {
      return { success: false, error: 'File no longer exists' };
    }
    shell.showItemInFolder(row.save_path);
    return { success: true };
  });

  ipcMain.handle(IPC.DOWNLOADS_REMOVE, (_event, id) => {
    // Removing from the list never deletes the file, and an in-flight
    // download must be cancelled first so its row can't be orphaned.
    if (activeItems.has(id)) return false;
    return store.removeDownload(id);
  });

  ipcMain.handle(IPC.DOWNLOADS_CLEAR, () => {
    return store.clearDownloads();
  });

  log.info('[Downloads] IPC handlers registered');
}

module.exports = {
  attachDownloadsManager,
  registerDownloadsIpc,
  sanitizeFilename,
  uniqueSavePath,
};
