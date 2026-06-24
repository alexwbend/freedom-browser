const crypto = require('crypto');
const path = require('path');

const { BrowserWindow, ipcMain } = require('electron');
const identityManager = require('./identity-manager');
const dappPermissions = require('./wallet/dapp-permissions');

const CHANNEL_PREFIX = 'trusted-wallet-surface';
const SURFACE_WIDTH = 920;
const SURFACE_HEIGHT = 680;

let activeWindow = null;
let activeSurfaceId = null;
let activeChannels = [];
let closeListeners = new Set();

function createSurfaceId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `wallet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function sanitizePermission(permission = {}) {
  return {
    origin: typeof permission.origin === 'string' ? permission.origin : '',
    walletIndex: Number.isInteger(permission.walletIndex) ? permission.walletIndex : null,
    chainId: Number.isInteger(permission.chainId) ? permission.chainId : null,
    connectedAt: Number.isFinite(permission.connectedAt) ? permission.connectedAt : null,
    lastUsed: Number.isFinite(permission.lastUsed) ? permission.lastUsed : null,
    autoApprove: permission.autoApprove && typeof permission.autoApprove === 'object'
      ? cloneSerializable(permission.autoApprove)
      : null,
  };
}

function buildSurfaceContext(context = {}) {
  const caller = context.caller && typeof context.caller === 'object'
    ? cloneSerializable(context.caller)
    : null;
  return {
    title: 'Wallet',
    heading: 'Wallet Accounts',
    surfaceOwner: 'shell',
    trusted: true,
    caller,
  };
}

async function buildSnapshot() {
  let wallets;
  let activeWalletIndex = null;
  let activeWalletAddress = null;
  let walletError = null;

  try {
    wallets = await identityManager.getDerivedWallets();
    if (!Array.isArray(wallets)) {
      wallets = [];
    }
  } catch (err) {
    walletError = err?.message || 'Failed to load wallet accounts';
    wallets = [];
  }

  try {
    activeWalletIndex = identityManager.getActiveWalletIndex();
  } catch (err) {
    walletError = walletError || err?.message || 'Failed to load active wallet';
  }

  try {
    activeWalletAddress = await identityManager.getActiveWalletAddress();
  } catch (err) {
    walletError = walletError || err?.message || 'Failed to load active wallet address';
  }

  const permissions = dappPermissions.getAllPermissions().map(sanitizePermission);
  return cloneSerializable({
    generatedAt: Date.now(),
    wallets,
    activeWalletIndex,
    activeWalletAddress,
    permissions,
    walletError,
  });
}

async function notifySnapshotUpdated() {
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
    snapshot: await buildSnapshot(),
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

async function openTrustedWalletSurface(context = {}, deps = {}) {
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
      surface: 'wallet',
      reused: true,
      trusted: true,
      owner: 'shell',
    };
  }

  if (typeof ElectronBrowserWindow !== 'function') {
    return errorResult(
      'TRUSTED_WALLET_SURFACE_UNAVAILABLE',
      'Trusted wallet surface window is unavailable'
    );
  }
  if (!electronIpcMain || typeof electronIpcMain.handle !== 'function') {
    return errorResult(
      'TRUSTED_WALLET_SURFACE_IPC_UNAVAILABLE',
      'Trusted wallet surface IPC is unavailable'
    );
  }

  const surfaceId = createSurfaceId();
  const contextPayload = buildSurfaceContext(context);
  const channels = {
    context: channelFor('context', surfaceId),
    snapshot: channelFor('snapshot', surfaceId),
    revokePermission: channelFor('revoke-permission', surfaceId),
    close: channelFor('close', surfaceId),
  };
  const preload = path.join(__dirname, 'trusted-wallet-preload.js');
  const surfaceHtml = path.join(__dirname, 'trusted-wallet.html');
  const ownerWindow = context.ownerWindow || null;

  let surfaceWindow = null;
  try {
    surfaceWindow = new ElectronBrowserWindow({
      width: SURFACE_WIDTH,
      height: SURFACE_HEIGHT,
      minWidth: 720,
      minHeight: 500,
      title: 'Freedom Wallet',
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
      'TRUSTED_WALLET_SURFACE_WINDOW_FAILED',
      err?.message || 'Failed to create trusted wallet surface'
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
        'TRUSTED_WALLET_SURFACE_SENDER_MISMATCH',
        'Ignoring wallet surface request from an unexpected sender'
      );
    }
    return null;
  };

  registerSurfaceHandler(electronIpcMain, channels.context, (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    return { ok: true, context: contextPayload };
  });

  registerSurfaceHandler(electronIpcMain, channels.snapshot, async (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    return { ok: true, snapshot: await buildSnapshot() };
  });

  registerSurfaceHandler(electronIpcMain, channels.revokePermission, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const revoked = dappPermissions.revokePermission(normalizeOrigin(payload.origin));
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, revoked, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_WALLET_SURFACE_REVOKE_FAILED',
        err?.message || 'Failed to revoke wallet permission'
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
    const loadPromise = surfaceWindow.loadFile(surfaceHtml, { query: { surfaceId } });
    Promise.resolve(loadPromise).catch(() => {
      if (activeWindow !== surfaceWindow) {
        return;
      }
      cleanupSurface(electronIpcMain);
      try {
        if (
          surfaceWindow &&
          typeof surfaceWindow.isDestroyed === 'function' &&
          !surfaceWindow.isDestroyed()
        ) {
          surfaceWindow.close?.();
        }
      } catch {
        // Best-effort cleanup for asynchronous presentation failures.
      }
    });
  } catch (err) {
    cleanupSurface(electronIpcMain);
    try {
      if (
        surfaceWindow &&
        typeof surfaceWindow.isDestroyed === 'function' &&
        !surfaceWindow.isDestroyed()
      ) {
        surfaceWindow.close?.();
      }
    } catch {
      // Best-effort cleanup for synchronous presentation failures.
    }
    return errorResult(
      'TRUSTED_WALLET_SURFACE_LOAD_FAILED',
      err?.message || 'Failed to load trusted wallet surface'
    );
  }

  return {
    ok: true,
    surface: 'wallet',
    reused: false,
    trusted: true,
    owner: 'shell',
  };
}

function closeTrustedWalletSurface() {
  const surfaceWindow = activeWindow;
  if (
    !surfaceWindow ||
    typeof surfaceWindow.isDestroyed !== 'function' ||
    surfaceWindow.isDestroyed()
  ) {
    return {
      ok: true,
      surface: 'wallet',
      closed: false,
      trusted: true,
      owner: 'shell',
    };
  }
  try {
    surfaceWindow.close();
    return {
      ok: true,
      surface: 'wallet',
      closed: true,
      trusted: true,
      owner: 'shell',
    };
  } catch (err) {
    return errorResult(
      'TRUSTED_WALLET_SURFACE_CLOSE_FAILED',
      err?.message || 'Failed to close trusted wallet surface'
    );
  }
}

function _resetForTest() {
  activeWindow = null;
  activeSurfaceId = null;
  activeChannels = [];
  closeListeners = new Set();
}

module.exports = {
  channelFor,
  openTrustedWalletSurface,
  closeTrustedWalletSurface,
  _resetForTest,
};
