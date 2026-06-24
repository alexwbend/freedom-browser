const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { BrowserWindow, clipboard, dialog, ipcMain } = require('electron');
const { SHELL_API_METHODS } = require('../shared/shell-api-policy');
const publishHistory = require('./swarm/publish-history');
const publishService = require('./swarm/publish-service');
const stampService = require('./swarm/stamp-service');

const CHANNEL_PREFIX = 'trusted-swarm-publish-surface';
const SURFACE_WIDTH = 980;
const SURFACE_HEIGHT = 720;

let activeWindow = null;
let activeChannels = [];
let closeListeners = new Set();

function createSurfaceId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `swarm-publish-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function channelFor(kind, surfaceId) {
  return `${CHANNEL_PREFIX}:${kind}:${surfaceId}`;
}

function cloneSerializable(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function errorResult(code, message) {
  return {
    success: false,
    error: { code, message },
  };
}

function removeHandlerSafe(electronIpcMain, channel) {
  if (!electronIpcMain || typeof electronIpcMain.removeHandler !== 'function') {
    return;
  }
  try {
    electronIpcMain.removeHandler(channel);
  } catch {
    // Best-effort cleanup during close/load races.
  }
}

function senderMatchesSurface(event, surfaceWindow) {
  return Boolean(
    event &&
      surfaceWindow &&
      event.sender &&
      surfaceWindow.webContents &&
      event.sender === surfaceWindow.webContents
  );
}

function cleanupSurface(electronIpcMain) {
  activeChannels.forEach((channel) => removeHandlerSafe(electronIpcMain, channel));
  activeChannels = [];
  activeWindow = null;
  const listeners = closeListeners;
  closeListeners = new Set();
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Listener failures must not leak across windows or into package chrome.
    }
  });
}

function registerSurfaceHandler(electronIpcMain, channel, handler) {
  activeChannels.push(channel);
  electronIpcMain.handle(channel, handler);
}

function publishSuccess(result) {
  return {
    success: true,
    reference: result.reference,
    bzzUrl: result.bzzUrl,
    tagUid: result.tagUid,
  };
}

async function publishTrustedData(data) {
  if (!data && data !== '') {
    return errorResult('TRUSTED_SWARM_PUBLISH_DATA_REQUIRED', 'Data is required');
  }
  const historyEntry = publishHistory.addEntry({
    type: 'data',
    name: 'Text',
    status: 'uploading',
    origin: publishService.USER_ORIGIN,
  });
  try {
    const result = await publishService.publishData(data);
    publishHistory.updateEntry(historyEntry.id, { status: 'completed', ...result });
    return publishSuccess(result);
  } catch (err) {
    publishHistory.updateEntry(historyEntry.id, {
      status: 'failed',
      errorMessage: err?.message || 'Publish failed',
    });
    return errorResult(
      'TRUSTED_SWARM_PUBLISH_DATA_FAILED',
      err?.message || 'Publish failed'
    );
  }
}

async function publishTrustedFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return errorResult('TRUSTED_SWARM_PUBLISH_FILE_REQUIRED', 'File path is required');
  }
  if (!fs.existsSync(filePath)) {
    return errorResult('TRUSTED_SWARM_PUBLISH_FILE_MISSING', `File not found: ${filePath}`);
  }
  const historyEntry = publishHistory.addEntry({
    type: 'file',
    name: path.basename(filePath),
    status: 'uploading',
    origin: publishService.USER_ORIGIN,
  });
  try {
    const result = await publishService.publishFile(filePath);
    publishHistory.updateEntry(historyEntry.id, { status: 'completed', ...result });
    return publishSuccess(result);
  } catch (err) {
    publishHistory.updateEntry(historyEntry.id, {
      status: 'failed',
      errorMessage: err?.message || 'Upload failed',
    });
    return errorResult(
      'TRUSTED_SWARM_PUBLISH_FILE_FAILED',
      err?.message || 'Upload failed'
    );
  }
}

async function publishTrustedDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') {
    return errorResult(
      'TRUSTED_SWARM_PUBLISH_DIRECTORY_REQUIRED',
      'Directory path is required'
    );
  }
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return errorResult(
      'TRUSTED_SWARM_PUBLISH_DIRECTORY_MISSING',
      `Directory not found: ${dirPath}`
    );
  }
  const historyEntry = publishHistory.addEntry({
    type: 'directory',
    name: path.basename(dirPath),
    status: 'uploading',
    origin: publishService.USER_ORIGIN,
  });
  try {
    const result = await publishService.publishDirectory(dirPath);
    publishHistory.updateEntry(historyEntry.id, { status: 'completed', ...result });
    return publishSuccess(result);
  } catch (err) {
    publishHistory.updateEntry(historyEntry.id, {
      status: 'failed',
      errorMessage: err?.message || 'Upload failed',
    });
    return errorResult(
      'TRUSTED_SWARM_PUBLISH_DIRECTORY_FAILED',
      err?.message || 'Upload failed'
    );
  }
}

async function openFilePicker(surfaceWindow) {
  const result = await dialog.showOpenDialog(surfaceWindow, {
    properties: ['openFile'],
    title: 'Select a file to publish',
  });
  if (result.canceled || !result.filePaths?.length) {
    return { success: true, path: null };
  }
  return { success: true, path: result.filePaths[0] };
}

async function openDirectoryPicker(surfaceWindow) {
  const result = await dialog.showOpenDialog(surfaceWindow, {
    properties: ['openDirectory'],
    title: 'Select a folder to publish',
  });
  if (result.canceled || !result.filePaths?.length) {
    return { success: true, path: null };
  }
  return { success: true, path: result.filePaths[0] };
}

async function openTrustedSwarmPublishSurface(context = {}, deps = {}) {
  const ElectronBrowserWindow = deps.BrowserWindow || BrowserWindow;
  const electronIpcMain = deps.ipcMain || ipcMain;
  const onClosed = typeof context.onClosed === 'function' ? context.onClosed : null;

  if (
    activeWindow &&
    typeof activeWindow.isDestroyed === 'function' &&
    !activeWindow.isDestroyed()
  ) {
    if (onClosed) {
      closeListeners.add(onClosed);
    }
    activeWindow.show?.();
    activeWindow.focus?.();
    return {
      ok: true,
      surface: 'swarmPublish',
      reused: true,
      trusted: true,
      owner: 'shell',
    };
  }

  if (typeof ElectronBrowserWindow !== 'function') {
    return {
      ok: false,
      error: {
        code: 'TRUSTED_SWARM_PUBLISH_SURFACE_UNAVAILABLE',
        message: 'Trusted Swarm publish surface window is unavailable',
      },
    };
  }
  if (!electronIpcMain || typeof electronIpcMain.handle !== 'function') {
    return {
      ok: false,
      error: {
        code: 'TRUSTED_SWARM_PUBLISH_SURFACE_IPC_UNAVAILABLE',
        message: 'Trusted Swarm publish surface IPC is unavailable',
      },
    };
  }

  const surfaceId = createSurfaceId();
  const channels = {
    publishData: channelFor('publish-data', surfaceId),
    publishFile: channelFor('publish-file', surfaceId),
    publishDirectory: channelFor('publish-directory', surfaceId),
    getUploadStatus: channelFor('get-upload-status', surfaceId),
    getStamps: channelFor('get-stamps', surfaceId),
    pickFile: channelFor('pick-file', surfaceId),
    pickDirectory: channelFor('pick-directory', surfaceId),
    getPublishHistory: channelFor('get-publish-history', surfaceId),
    clearPublishHistory: channelFor('clear-publish-history', surfaceId),
    copyText: channelFor('copy-text', surfaceId),
    openInNewTab: channelFor('open-in-new-tab', surfaceId),
  };
  const preload = path.join(__dirname, 'trusted-swarm-publish-preload.js');
  const surfaceHtml = path.join(__dirname, '../renderer/pages/publish.html');
  const ownerWindow = context.ownerWindow || null;

  let surfaceWindow = null;
  try {
    surfaceWindow = new ElectronBrowserWindow({
      width: SURFACE_WIDTH,
      height: SURFACE_HEIGHT,
      minWidth: 760,
      minHeight: 520,
      title: 'Freedom Swarm Publish',
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f8f7f3',
      ...(ownerWindow ? { parent: ownerWindow } : {}),
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'TRUSTED_SWARM_PUBLISH_SURFACE_WINDOW_FAILED',
        message: err?.message || 'Failed to create trusted Swarm publish surface',
      },
    };
  }

  activeWindow = surfaceWindow;
  activeChannels = [];
  if (onClosed) {
    closeListeners.add(onClosed);
  }

  const requireSurfaceSender = (event) => {
    if (!senderMatchesSurface(event, surfaceWindow)) {
      return errorResult(
        'TRUSTED_SWARM_PUBLISH_SURFACE_SENDER_MISMATCH',
        'Ignoring Swarm publish surface request from an unexpected sender'
      );
    }
    return null;
  };

  registerSurfaceHandler(electronIpcMain, channels.publishData, (event, data) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    return publishTrustedData(data);
  });

  registerSurfaceHandler(electronIpcMain, channels.publishFile, (event, filePath) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    return publishTrustedFile(filePath);
  });

  registerSurfaceHandler(electronIpcMain, channels.publishDirectory, (event, dirPath) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    return publishTrustedDirectory(dirPath);
  });

  registerSurfaceHandler(electronIpcMain, channels.getUploadStatus, async (event, tagUid) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      if (!tagUid || typeof tagUid !== 'number') {
        return errorResult('TRUSTED_SWARM_PUBLISH_TAG_REQUIRED', 'Tag UID is required');
      }
      const status = await publishService.getUploadStatus(tagUid);
      return { success: true, ...status };
    } catch (err) {
      return errorResult(
        'TRUSTED_SWARM_PUBLISH_STATUS_FAILED',
        err?.message || 'Failed to get upload status'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.getStamps, async (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      return { success: true, stamps: cloneSerializable(await stampService.getStamps()) };
    } catch (err) {
      return errorResult(
        'TRUSTED_SWARM_PUBLISH_STAMPS_FAILED',
        err?.message || 'Failed to load postage stamps'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.pickFile, async (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      return await openFilePicker(surfaceWindow);
    } catch (err) {
      return errorResult(
        'TRUSTED_SWARM_PUBLISH_FILE_PICKER_FAILED',
        err?.message || 'File picker failed'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.pickDirectory, async (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      return await openDirectoryPicker(surfaceWindow);
    } catch (err) {
      return errorResult(
        'TRUSTED_SWARM_PUBLISH_DIRECTORY_PICKER_FAILED',
        err?.message || 'Directory picker failed'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.getPublishHistory, (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      return { success: true, entries: cloneSerializable(publishHistory.getEntries()) };
    } catch (err) {
      return errorResult(
        'TRUSTED_SWARM_PUBLISH_HISTORY_FAILED',
        err?.message || 'Failed to load publish history'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.clearPublishHistory, (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      publishHistory.clearEntries();
      return { success: true };
    } catch (err) {
      return errorResult(
        'TRUSTED_SWARM_PUBLISH_HISTORY_CLEAR_FAILED',
        err?.message || 'Failed to clear publish history'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.copyText, (event, text) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      clipboard.writeText(String(text || ''));
      return { success: true };
    } catch (err) {
      return errorResult(
        'TRUSTED_SWARM_PUBLISH_COPY_FAILED',
        err?.message || 'Failed to copy text'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.openInNewTab, async (event, url) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    if (!context.hostWebContents) {
      return errorResult(
        'TRUSTED_SWARM_PUBLISH_OPEN_TAB_HOST_MISSING',
        'Opening published content requires a package host window'
      );
    }
    try {
      const { handleShellRequest } = require('./shell-api');
      const tab = await handleShellRequest(
        { sender: context.hostWebContents },
        {
          method: SHELL_API_METHODS.TABS_CREATE,
          args: [{ url }],
        }
      );
      return { success: true, tab };
    } catch (err) {
      return errorResult(
        err?.code || 'TRUSTED_SWARM_PUBLISH_OPEN_TAB_FAILED',
        err?.message || 'Failed to open published content'
      );
    }
  });

  surfaceWindow.once('closed', () => cleanupSurface(electronIpcMain));
  surfaceWindow.once('ready-to-show', () => {
    if (
      surfaceWindow &&
      typeof surfaceWindow.isDestroyed === 'function' &&
      !surfaceWindow.isDestroyed()
    ) {
      surfaceWindow.show?.();
    }
  });

  try {
    await surfaceWindow.loadFile(surfaceHtml, { query: { surfaceId } });
  } catch (err) {
    cleanupSurface(electronIpcMain);
    return {
      ok: false,
      error: {
        code: 'TRUSTED_SWARM_PUBLISH_SURFACE_LOAD_FAILED',
        message: err?.message || 'Failed to load trusted Swarm publish surface',
      },
    };
  }

  return {
    ok: true,
    surface: 'swarmPublish',
    reused: false,
    trusted: true,
    owner: 'shell',
  };
}

function closeTrustedSwarmPublishSurface() {
  const surfaceWindow = activeWindow;
  if (
    !surfaceWindow ||
    typeof surfaceWindow.isDestroyed !== 'function' ||
    surfaceWindow.isDestroyed()
  ) {
    return {
      ok: true,
      surface: 'swarmPublish',
      closed: false,
      trusted: true,
      owner: 'shell',
    };
  }
  try {
    surfaceWindow.close();
    return {
      ok: true,
      surface: 'swarmPublish',
      closed: true,
      trusted: true,
      owner: 'shell',
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'TRUSTED_SWARM_PUBLISH_SURFACE_CLOSE_FAILED',
        message: err?.message || 'Failed to close trusted Swarm publish surface',
      },
    };
  }
}

function isTrustedSwarmPublishSurfaceOpen() {
  return Boolean(
    activeWindow &&
      typeof activeWindow.isDestroyed === 'function' &&
      !activeWindow.isDestroyed()
  );
}

module.exports = {
  CHANNEL_PREFIX,
  channelFor,
  closeTrustedSwarmPublishSurface,
  isTrustedSwarmPublishSurfaceOpen,
  openTrustedSwarmPublishSurface,
  _resetForTest() {
    activeWindow = null;
    activeChannels = [];
    closeListeners = new Set();
  },
};
