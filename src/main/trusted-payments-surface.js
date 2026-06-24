const crypto = require('crypto');
const path = require('path');

const { BrowserWindow, ipcMain } = require('electron');
const paymentHistory = require('./payment-history');
const x402Permissions = require('./x402/permissions');

const CHANNEL_PREFIX = 'trusted-payments-surface';
const SURFACE_WIDTH = 980;
const SURFACE_HEIGHT = 700;
const HISTORY_LIMIT = 100;

let activeWindow = null;
let activeSurfaceId = null;
let activeChannels = [];
let closeListeners = new Set();

function createSurfaceId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `payments-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
    ok: false,
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

function normalizeOrigin(origin) {
  const text = typeof origin === 'string' ? origin.trim() : '';
  if (!text) {
    throw new Error('origin is required');
  }
  return text;
}

function normalizeAsset(asset) {
  const text = typeof asset === 'string' ? asset.trim() : '';
  if (!text) {
    throw new Error('asset is required');
  }
  return text;
}

function normalizeChainId(chainId) {
  const value = Number(chainId);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('chainId must be a positive integer');
  }
  return value;
}

function normalizePermissionTarget(payload = {}) {
  return {
    origin: normalizeOrigin(payload.origin),
    chainId: normalizeChainId(payload.chainId),
    asset: normalizeAsset(payload.asset),
  };
}

function normalizeUpdatePatch(payload = {}) {
  const patch = {};
  if (payload.capAmount !== undefined) {
    const capAmount = typeof payload.capAmount === 'string' ? payload.capAmount.trim() : '';
    if (!/^\d+$/.test(capAmount)) {
      throw new Error('capAmount must be a digit string');
    }
    patch.capAmount = capAmount;
  }
  if (payload.windowSeconds !== undefined) {
    const windowSeconds = Number(payload.windowSeconds);
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
      throw new Error('windowSeconds must be a positive number');
    }
    patch.windowSeconds = windowSeconds;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('capAmount or windowSeconds is required');
  }
  return patch;
}

function buildSurfaceContext(context = {}) {
  const caller = context.caller && typeof context.caller === 'object'
    ? cloneSerializable(context.caller)
    : null;
  return {
    title: 'Payments',
    heading: 'Payment Permissions',
    surfaceOwner: 'shell',
    trusted: true,
    caller,
  };
}

function buildSnapshot() {
  const permissions = x402Permissions.getAllPermissions();
  const payments = paymentHistory.getRecent({ limit: HISTORY_LIMIT });
  const paymentCount = paymentHistory.getCount({});
  return cloneSerializable({
    generatedAt: Date.now(),
    permissions,
    payments,
    paymentCount,
    historyLimit: HISTORY_LIMIT,
  });
}

function notifySnapshotUpdated() {
  if (
    !activeWindow ||
    typeof activeWindow.isDestroyed !== 'function' ||
    activeWindow.isDestroyed() ||
    !activeSurfaceId
  ) {
    return;
  }
  activeWindow.webContents?.send?.(channelFor('snapshot-updated', activeSurfaceId), {
    ok: true,
    snapshot: buildSnapshot(),
  });
}

function cleanupSurface(electronIpcMain) {
  activeChannels.forEach((channel) => removeHandlerSafe(electronIpcMain, channel));
  activeChannels = [];
  activeWindow = null;
  activeSurfaceId = null;
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

async function openTrustedPaymentsSurface(context = {}, deps = {}) {
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
      surface: 'payments',
      reused: true,
      trusted: true,
      owner: 'shell',
    };
  }

  if (typeof ElectronBrowserWindow !== 'function') {
    return errorResult(
      'TRUSTED_PAYMENTS_SURFACE_UNAVAILABLE',
      'Trusted payments surface window is unavailable'
    );
  }
  if (!electronIpcMain || typeof electronIpcMain.handle !== 'function') {
    return errorResult(
      'TRUSTED_PAYMENTS_SURFACE_IPC_UNAVAILABLE',
      'Trusted payments surface IPC is unavailable'
    );
  }

  const surfaceId = createSurfaceId();
  const contextPayload = buildSurfaceContext(context);
  const channels = {
    context: channelFor('context', surfaceId),
    snapshot: channelFor('snapshot', surfaceId),
    updatePermission: channelFor('update-permission', surfaceId),
    revokePermission: channelFor('revoke-permission', surfaceId),
    revokeAllForOrigin: channelFor('revoke-all-for-origin', surfaceId),
    clearHistory: channelFor('clear-history', surfaceId),
    close: channelFor('close', surfaceId),
  };
  const preload = path.join(__dirname, 'trusted-payments-preload.js');
  const surfaceHtml = path.join(__dirname, 'trusted-payments.html');
  const ownerWindow = context.ownerWindow || null;

  let surfaceWindow = null;
  try {
    surfaceWindow = new ElectronBrowserWindow({
      width: SURFACE_WIDTH,
      height: SURFACE_HEIGHT,
      minWidth: 760,
      minHeight: 520,
      title: 'Freedom Payments',
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
    return errorResult(
      'TRUSTED_PAYMENTS_SURFACE_WINDOW_FAILED',
      err?.message || 'Failed to create trusted payments surface'
    );
  }

  activeWindow = surfaceWindow;
  activeSurfaceId = surfaceId;
  activeChannels = [];
  if (onClosed) {
    closeListeners.add(onClosed);
  }

  const requireSurfaceSender = (event) => {
    if (!senderMatchesSurface(event, surfaceWindow)) {
      return errorResult(
        'TRUSTED_PAYMENTS_SURFACE_SENDER_MISMATCH',
        'Ignoring payments surface request from an unexpected sender'
      );
    }
    return null;
  };

  registerSurfaceHandler(electronIpcMain, channels.context, (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    return { ok: true, context: contextPayload };
  });

  registerSurfaceHandler(electronIpcMain, channels.snapshot, (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    return { ok: true, snapshot: buildSnapshot() };
  });

  registerSurfaceHandler(electronIpcMain, channels.revokePermission, (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const { origin, chainId, asset } = normalizePermissionTarget(payload);
      x402Permissions.revoke(origin, chainId, asset);
      const snapshot = buildSnapshot();
      notifySnapshotUpdated();
      return { ok: true, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_PAYMENTS_SURFACE_REVOKE_FAILED',
        err?.message || 'Failed to revoke x402 permission'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.revokeAllForOrigin, (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      x402Permissions.revokeAllForOrigin(normalizeOrigin(payload.origin));
      const snapshot = buildSnapshot();
      notifySnapshotUpdated();
      return { ok: true, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_PAYMENTS_SURFACE_REVOKE_ORIGIN_FAILED',
        err?.message || 'Failed to revoke x402 permissions for origin'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.updatePermission, (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const { origin, chainId, asset } = normalizePermissionTarget(payload);
      const patch = normalizeUpdatePatch(payload);
      const permission = x402Permissions.updatePermission(origin, chainId, asset, patch);
      const snapshot = buildSnapshot();
      notifySnapshotUpdated();
      return { ok: true, permission: cloneSerializable(permission), snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_PAYMENTS_SURFACE_UPDATE_FAILED',
        err?.message || 'Failed to update x402 permission'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.clearHistory, (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const removed = paymentHistory.clear();
      const snapshot = buildSnapshot();
      notifySnapshotUpdated();
      return { ok: true, removed, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_PAYMENTS_SURFACE_CLEAR_HISTORY_FAILED',
        err?.message || 'Failed to clear payment history'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.close, (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    surfaceWindow.close();
    return { ok: true };
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
    return errorResult(
      'TRUSTED_PAYMENTS_SURFACE_LOAD_FAILED',
      err?.message || 'Failed to load trusted payments surface'
    );
  }

  return {
    ok: true,
    surface: 'payments',
    reused: false,
    trusted: true,
    owner: 'shell',
  };
}

function closeTrustedPaymentsSurface() {
  const surfaceWindow = activeWindow;
  if (
    !surfaceWindow ||
    typeof surfaceWindow.isDestroyed !== 'function' ||
    surfaceWindow.isDestroyed()
  ) {
    return {
      ok: true,
      surface: 'payments',
      closed: false,
      trusted: true,
      owner: 'shell',
    };
  }
  try {
    surfaceWindow.close();
    return {
      ok: true,
      surface: 'payments',
      closed: true,
      trusted: true,
      owner: 'shell',
    };
  } catch (err) {
    return errorResult(
      'TRUSTED_PAYMENTS_SURFACE_CLOSE_FAILED',
      err?.message || 'Failed to close trusted payments surface'
    );
  }
}

function isTrustedPaymentsSurfaceOpen() {
  return Boolean(
    activeWindow &&
      typeof activeWindow.isDestroyed === 'function' &&
      !activeWindow.isDestroyed()
  );
}

module.exports = {
  buildSnapshot,
  buildSurfaceContext,
  channelFor,
  closeTrustedPaymentsSurface,
  isTrustedPaymentsSurfaceOpen,
  openTrustedPaymentsSurface,
  _resetForTest() {
    activeWindow = null;
    activeSurfaceId = null;
    activeChannels = [];
    closeListeners = new Set();
  },
};
