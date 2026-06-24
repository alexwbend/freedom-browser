const crypto = require('crypto');
const path = require('path');

const { BrowserWindow, ipcMain } = require('electron');
const identityManager = require('./identity-manager');
const quickUnlock = require('./quick-unlock');

const CHANNEL_PREFIX = 'trusted-identity-surface';
const SURFACE_WIDTH = 900;
const SURFACE_HEIGHT = 680;

let activeWindow = null;
let activeSurfaceId = null;
let activeChannels = [];
let closeListeners = new Set();

function createSurfaceId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `identity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function normalizePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('password is required');
  }
  return password;
}

function normalizeNewPassword(password) {
  const value = normalizePassword(password);
  if (value.length < 8) {
    throw new Error('new password must be at least 8 characters');
  }
  return value;
}

function normalizeMnemonic(mnemonic) {
  const text = typeof mnemonic === 'string' ? mnemonic.trim().replace(/\s+/g, ' ') : '';
  if (!text) {
    throw new Error('recovery phrase is required');
  }
  return text;
}

function normalizeStrength(strength) {
  if (strength === 128 || strength === 256) {
    return strength;
  }
  return 256;
}

function normalizeDeleteConfirmation(confirmation) {
  if (typeof confirmation !== 'string' || confirmation.trim() !== 'DELETE') {
    throw new Error('type DELETE to confirm vault deletion');
  }
  return 'DELETE';
}

function buildSurfaceContext(context = {}) {
  const caller = context.caller && typeof context.caller === 'object'
    ? cloneSerializable(context.caller)
    : null;
  return {
    title: 'Identity',
    heading: 'Identity And Vault',
    surfaceOwner: 'shell',
    trusted: true,
    caller,
  };
}

function readQuickUnlockStatus() {
  const status = {
    canUseTouchId: false,
    secureStorageAvailable: false,
    enabled: false,
    error: null,
  };
  try {
    if (typeof quickUnlock.canUseTouchId === 'function') {
      status.canUseTouchId = quickUnlock.canUseTouchId() === true;
    }
    if (typeof quickUnlock.isSecureStorageAvailable === 'function') {
      status.secureStorageAvailable = quickUnlock.isSecureStorageAvailable() === true;
    }
    if (typeof quickUnlock.isQuickUnlockEnabled === 'function') {
      status.enabled = quickUnlock.isQuickUnlockEnabled() === true;
    }
  } catch (err) {
    status.error = err?.message || 'Failed to read quick unlock state';
  }
  return status;
}

async function buildSnapshot() {
  let hasVault = false;
  let isUnlocked = false;
  let status = null;
  let vaultMeta = null;
  let identityError = null;

  try {
    hasVault = await identityManager.hasVault();
  } catch (err) {
    identityError = err?.message || 'Failed to read vault state';
  }

  try {
    isUnlocked = await identityManager.isVaultUnlocked();
  } catch (err) {
    identityError = identityError || err?.message || 'Failed to read vault lock state';
  }

  try {
    if (typeof identityManager.getVaultMeta === 'function') {
      vaultMeta = identityManager.getVaultMeta();
    }
  } catch (err) {
    identityError = identityError || err?.message || 'Failed to read vault metadata';
  }

  try {
    status = await identityManager.getIdentityStatus();
  } catch (err) {
    identityError = identityError || err?.message || 'Failed to read identity status';
  }

  return cloneSerializable({
    generatedAt: Date.now(),
    hasVault: hasVault === true,
    isUnlocked: isUnlocked === true,
    status,
    vaultMeta,
    quickUnlock: readQuickUnlockStatus(),
    identityError,
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

async function openTrustedIdentitySurface(context = {}, deps = {}) {
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
      surface: 'identity',
      reused: true,
      trusted: true,
      owner: 'shell',
    };
  }

  if (typeof ElectronBrowserWindow !== 'function') {
    return errorResult(
      'TRUSTED_IDENTITY_SURFACE_UNAVAILABLE',
      'Trusted identity surface window is unavailable'
    );
  }
  if (!electronIpcMain || typeof electronIpcMain.handle !== 'function') {
    return errorResult(
      'TRUSTED_IDENTITY_SURFACE_IPC_UNAVAILABLE',
      'Trusted identity surface IPC is unavailable'
    );
  }

  const surfaceId = createSurfaceId();
  const contextPayload = buildSurfaceContext(context);
  const channels = {
    context: channelFor('context', surfaceId),
    snapshot: channelFor('snapshot', surfaceId),
    createVault: channelFor('create-vault', surfaceId),
    importMnemonic: channelFor('import-mnemonic', surfaceId),
    unlock: channelFor('unlock', surfaceId),
    lock: channelFor('lock', surfaceId),
    changePassword: channelFor('change-password', surfaceId),
    deleteVault: channelFor('delete-vault', surfaceId),
    enableQuickUnlock: channelFor('enable-quick-unlock', surfaceId),
    disableQuickUnlock: channelFor('disable-quick-unlock', surfaceId),
    close: channelFor('close', surfaceId),
  };
  const preload = path.join(__dirname, 'trusted-identity-preload.js');
  const surfaceHtml = path.join(__dirname, 'trusted-identity.html');
  const ownerWindow = context.ownerWindow || null;

  let surfaceWindow = null;
  try {
    surfaceWindow = new ElectronBrowserWindow({
      width: SURFACE_WIDTH,
      height: SURFACE_HEIGHT,
      minWidth: 720,
      minHeight: 520,
      title: 'Freedom Identity',
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
      'TRUSTED_IDENTITY_SURFACE_WINDOW_FAILED',
      err?.message || 'Failed to create trusted identity surface'
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
        'TRUSTED_IDENTITY_SURFACE_SENDER_MISMATCH',
        'Ignoring identity surface request from an unexpected sender'
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

  registerSurfaceHandler(electronIpcMain, channels.createVault, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const password = normalizeNewPassword(payload.password);
      const strength = normalizeStrength(payload.strength);
      const userKnowsPassword = payload.userKnowsPassword !== false;
      const mnemonic = await identityManager.createNewVault(
        password,
        strength,
        userKnowsPassword
      );
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, mnemonic, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_IDENTITY_SURFACE_CREATE_VAULT_FAILED',
        err?.message || 'Failed to create identity vault'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.importMnemonic, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const password = normalizeNewPassword(payload.password);
      const mnemonic = normalizeMnemonic(payload.mnemonic);
      const userKnowsPassword = payload.userKnowsPassword !== false;
      await identityManager.importExistingMnemonic(password, mnemonic, userKnowsPassword);
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_IDENTITY_SURFACE_IMPORT_FAILED',
        err?.message || 'Failed to import recovery phrase'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.unlock, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const password = normalizePassword(payload.password);
      await identityManager.unlockVault(password);
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_IDENTITY_SURFACE_UNLOCK_FAILED',
        err?.message || 'Failed to unlock vault'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.lock, async (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      await identityManager.lockVault();
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_IDENTITY_SURFACE_LOCK_FAILED',
        err?.message || 'Failed to lock vault'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.changePassword, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const currentPassword = normalizePassword(payload.currentPassword);
      const newPassword = normalizeNewPassword(payload.newPassword);
      await identityManager.changeVaultPassword(currentPassword, newPassword);
      if (typeof quickUnlock.disableQuickUnlock === 'function') {
        quickUnlock.disableQuickUnlock();
      }
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_IDENTITY_SURFACE_CHANGE_PASSWORD_FAILED',
        err?.message || 'Failed to change vault password'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.deleteVault, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const password = normalizePassword(payload.password);
      normalizeDeleteConfirmation(payload.confirmation);
      await identityManager.deleteVaultData(password);
      if (typeof quickUnlock.disableQuickUnlock === 'function') {
        quickUnlock.disableQuickUnlock();
      }
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_IDENTITY_SURFACE_DELETE_VAULT_FAILED',
        err?.message || 'Failed to delete identity vault'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.enableQuickUnlock, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const password = normalizePassword(payload.password);
      const result = typeof quickUnlock.enableQuickUnlock === 'function'
        ? await quickUnlock.enableQuickUnlock(password)
        : { success: false, error: 'Quick unlock is unavailable' };
      if (result?.success !== true) {
        throw new Error(result?.error || 'Failed to enable quick unlock');
      }
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_IDENTITY_SURFACE_ENABLE_QUICK_UNLOCK_FAILED',
        err?.message || 'Failed to enable quick unlock'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.disableQuickUnlock, async (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const result = typeof quickUnlock.disableQuickUnlock === 'function'
        ? quickUnlock.disableQuickUnlock()
        : { success: false, error: 'Quick unlock is unavailable' };
      if (result?.success !== true) {
        throw new Error(result?.error || 'Failed to disable quick unlock');
      }
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_IDENTITY_SURFACE_DISABLE_QUICK_UNLOCK_FAILED',
        err?.message || 'Failed to disable quick unlock'
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
      'TRUSTED_IDENTITY_SURFACE_LOAD_FAILED',
      err?.message || 'Failed to load trusted identity surface'
    );
  }

  return {
    ok: true,
    surface: 'identity',
    reused: false,
    trusted: true,
    owner: 'shell',
  };
}

function closeTrustedIdentitySurface() {
  const surfaceWindow = activeWindow;
  if (
    !surfaceWindow ||
    typeof surfaceWindow.isDestroyed !== 'function' ||
    surfaceWindow.isDestroyed()
  ) {
    return {
      ok: true,
      surface: 'identity',
      closed: false,
      trusted: true,
      owner: 'shell',
    };
  }
  try {
    surfaceWindow.close();
    return {
      ok: true,
      surface: 'identity',
      closed: true,
      trusted: true,
      owner: 'shell',
    };
  } catch (err) {
    return errorResult(
      'TRUSTED_IDENTITY_SURFACE_CLOSE_FAILED',
      err?.message || 'Failed to close trusted identity surface'
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
  openTrustedIdentitySurface,
  closeTrustedIdentitySurface,
  _resetForTest,
};
