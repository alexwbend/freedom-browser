const crypto = require('crypto');
const path = require('path');

const { BrowserWindow, WebContentsView, ipcMain } = require('electron');
const identityManager = require('./identity-manager');
const trustedVaultUnlockPrompt = require('./trusted-vault-unlock-prompt');
const dappPermissions = require('./wallet/dapp-permissions');
const { isVaultLockedError } = require('./wallet/vault-errors');

const CHANNEL_PREFIX = 'trusted-wallet-surface';
const SURFACE_WIDTH = 920;
const SURFACE_HEIGHT = 680;
const SURFACE_DRAWER_WIDTH = 360;
const SURFACE_DRAWER_MIN_WIDTH = 320;
const SURFACE_DRAWER_LAYOUT_MODE = 'dock';
const SURFACE_MODE_WINDOW = 'shell-owned-trusted-window';
const SURFACE_MODE_COMPOSITOR = 'shell-owned-webcontents-view';
const CREATE_WALLET_VAULT_LOCKED_MESSAGE = 'Vault must be unlocked to create a new wallet';

let activeWindow = null;
let activeSurfaceId = null;
let activeSurfaceMode = null;
let activeChannels = [];
let closeListeners = new Set();
let activeThemeUnsubscribe = null;

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

function normalizeWalletIndex(walletIndex) {
  if (!Number.isInteger(walletIndex) || walletIndex < 0) {
    throw new Error('walletIndex must be a non-negative integer');
  }
  return walletIndex;
}

function normalizePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('password is required');
  }
  return password;
}

function normalizeWalletName(name) {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text) {
    throw new Error('wallet name is required');
  }
  return text.slice(0, 80);
}

function isCreateWalletVaultLockedError(err) {
  return isVaultLockedError(err) || err?.message === CREATE_WALLET_VAULT_LOCKED_MESSAGE;
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

function getDappPermissionReferences(walletIndex) {
  return dappPermissions
    .getAllPermissions()
    .filter((permission) => permission?.walletIndex === walletIndex);
}

function formatDappPermissionReferenceError(walletIndex, permissions) {
  const origins = permissions.map((permission) => permission.origin).filter(Boolean);
  const shownOrigins = origins.slice(0, 3).join(', ');
  const extraCount = origins.length - 3;
  const extra = extraCount > 0 ? ` and ${extraCount} more` : '';
  const suffix = shownOrigins ? ` for ${shownOrigins}${extra}` : '';
  return `Cannot delete wallet with index ${walletIndex}; it is connected to dApps${suffix}. Revoke connected sites before deleting this wallet.`;
}

function buildCreateWalletUnlockRequest(name) {
  return {
    kind: 'wallet.management',
    method: 'wallet.createDerivedWallet',
    title: 'Unlock Wallet',
    heading: 'Unlock vault to create wallet',
    origin: 'Freedom Wallet',
    reason: 'Freedom Wallet needs your vault unlocked to create a new wallet.',
    rows: [
      { label: 'Action', value: 'Create wallet' },
      { label: 'Wallet name', value: name },
    ],
  };
}

async function requestCreateWalletVaultUnlock({
  name,
  surfaceWindow,
  contextPayload,
  presentVaultUnlockPrompt,
}) {
  if (typeof presentVaultUnlockPrompt !== 'function') {
    return errorResult(
      'TRUSTED_WALLET_SURFACE_CREATE_WALLET_UNLOCK_UNAVAILABLE',
      'Trusted vault unlock prompt is unavailable'
    );
  }

  const unlockPrompt = await presentVaultUnlockPrompt(
    buildCreateWalletUnlockRequest(name),
    {
      ownerWindow: getNativePromptOwnerWindow(surfaceWindow),
      origin: 'Freedom Wallet',
      caller: contextPayload.caller || null,
      surface: 'wallet',
    }
  );
  if (unlockPrompt?.ok === true && unlockPrompt.outcome === 'accepted') {
    return { ok: true };
  }
  if (unlockPrompt?.ok === true && unlockPrompt.outcome === 'rejected') {
    return errorResult(
      'TRUSTED_WALLET_SURFACE_CREATE_WALLET_UNLOCK_REJECTED',
      'Vault unlock was cancelled.'
    );
  }
  return errorResult(
    'TRUSTED_WALLET_SURFACE_CREATE_WALLET_UNLOCK_UNAVAILABLE',
    unlockPrompt?.error?.message || 'Trusted vault unlock prompt is unavailable'
  );
}

async function createDerivedWalletWithVaultUnlock({
  name,
  surfaceWindow,
  contextPayload,
  presentVaultUnlockPrompt,
}) {
  try {
    return await identityManager.createDerivedWallet(name);
  } catch (err) {
    if (!isCreateWalletVaultLockedError(err)) {
      throw err;
    }
  }

  const unlock = await requestCreateWalletVaultUnlock({
    name,
    surfaceWindow,
    contextPayload,
    presentVaultUnlockPrompt,
  });
  if (unlock.ok !== true) {
    const err = new Error(unlock.error.message);
    err.code = unlock.error.code;
    throw err;
  }

  return identityManager.createDerivedWallet(name);
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
    theme: getShellThemeForSurface(),
  };
}

function getShellThemeForSurface(settings) {
  const settingsStore = require('./settings-store');
  if (typeof settingsStore.getShellTheme === 'function') {
    return settingsStore.getShellTheme(settings);
  }
  return {
    mode: 'system',
    effective: 'light',
  };
}

function getTrustedWalletWebPreferences(preload) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  };
}

function getNativePromptOwnerWindow(surfaceWindow) {
  return surfaceWindow?.getNativeOwnerWindow?.() || surfaceWindow;
}

function getShellWindowSurfaceHost(ownerWindow) {
  const host = ownerWindow?.__freedomShellWindow || null;
  return typeof host?.createTrustedSurfaceWindow === 'function' &&
    host.canHostTrustedSurfaceWindows?.() === true
    ? host
    : null;
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

function notifyThemeUpdated(theme) {
  if (
    !activeWindow ||
    typeof activeWindow.isDestroyed !== 'function' ||
    activeWindow.isDestroyed() ||
    !activeSurfaceId
  ) {
    return;
  }
  activeWindow.webContents?.send?.(channelFor('theme-updated', activeSurfaceId), {
    ok: true,
    theme: cloneSerializable(theme),
  });
}

function cleanupSurface(electronIpcMain) {
  activeChannels.forEach((channel) => removeHandlerSafe(electronIpcMain, channel));
  activeChannels = [];
  if (activeThemeUnsubscribe) {
    activeThemeUnsubscribe();
    activeThemeUnsubscribe = null;
  }
  activeWindow = null;
  activeSurfaceId = null;
  activeSurfaceMode = null;
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
  const presentVaultUnlockPrompt =
    deps.presentVaultUnlockPrompt || trustedVaultUnlockPrompt.presentTrustedVaultUnlockPrompt;
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
      mode: activeSurfaceMode || SURFACE_MODE_WINDOW,
      layoutMode:
        activeSurfaceMode === SURFACE_MODE_COMPOSITOR ? SURFACE_DRAWER_LAYOUT_MODE : null,
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
    setActiveWallet: channelFor('set-active-wallet', surfaceId),
    createWallet: channelFor('create-wallet', surfaceId),
    renameWallet: channelFor('rename-wallet', surfaceId),
    deleteWallet: channelFor('delete-wallet', surfaceId),
    exportMnemonic: channelFor('export-mnemonic', surfaceId),
    exportPrivateKey: channelFor('export-private-key', surfaceId),
    close: channelFor('close', surfaceId),
  };
  const preload = path.join(__dirname, 'trusted-wallet-preload.js');
  const surfaceHtml = path.join(__dirname, 'trusted-wallet.html');
  const ownerWindow = context.ownerWindow || null;
  const webPreferences = getTrustedWalletWebPreferences(preload);
  const shellWindowSurfaceHost = getShellWindowSurfaceHost(ownerWindow);

  let surfaceWindow = null;
  let surfaceMode = SURFACE_MODE_WINDOW;
  try {
    if (shellWindowSurfaceHost) {
      const ElectronWebContentsView = deps.WebContentsView || WebContentsView;
      if (typeof ElectronWebContentsView !== 'function') {
        return errorResult(
          'TRUSTED_WALLET_SURFACE_VIEW_UNAVAILABLE',
          'Trusted wallet compositor view is unavailable'
        );
      }
      surfaceWindow = shellWindowSurfaceHost.createTrustedSurfaceWindow({
        surface: 'wallet',
        width: SURFACE_DRAWER_WIDTH,
        minWidth: SURFACE_DRAWER_MIN_WIDTH,
        layoutMode: SURFACE_DRAWER_LAYOUT_MODE,
        createView: () => new ElectronWebContentsView({ webPreferences }),
      });
      surfaceMode = SURFACE_MODE_COMPOSITOR;
    } else {
      if (typeof ElectronBrowserWindow !== 'function') {
        return errorResult(
          'TRUSTED_WALLET_SURFACE_UNAVAILABLE',
          'Trusted wallet surface window is unavailable'
        );
      }
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
        webPreferences,
      });
    }
  } catch (err) {
    return errorResult(
      shellWindowSurfaceHost
        ? 'TRUSTED_WALLET_SURFACE_VIEW_FAILED'
        : 'TRUSTED_WALLET_SURFACE_WINDOW_FAILED',
      err?.message || 'Failed to create trusted wallet surface'
    );
  }

  activeWindow = surfaceWindow;
  activeSurfaceId = surfaceId;
  activeSurfaceMode = surfaceMode;
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

  registerSurfaceHandler(electronIpcMain, channels.setActiveWallet, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const walletIndex = normalizeWalletIndex(payload.walletIndex);
      await identityManager.setActiveWalletIndex(walletIndex);
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, walletIndex, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_WALLET_SURFACE_SET_ACTIVE_FAILED',
        err?.message || 'Failed to set active wallet'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.createWallet, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const name = normalizeWalletName(payload.name);
      const wallet = await createDerivedWalletWithVaultUnlock({
        name,
        surfaceWindow,
        contextPayload,
        presentVaultUnlockPrompt,
      });
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, wallet, snapshot };
    } catch (err) {
      return errorResult(
        err?.code || 'TRUSTED_WALLET_SURFACE_CREATE_WALLET_FAILED',
        err?.message || 'Failed to create wallet'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.renameWallet, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const walletIndex = normalizeWalletIndex(payload.walletIndex);
      const name = normalizeWalletName(payload.name);
      await identityManager.renameDerivedWallet(walletIndex, name);
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, walletIndex, name, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_WALLET_SURFACE_RENAME_WALLET_FAILED',
        err?.message || 'Failed to rename wallet'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.deleteWallet, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const walletIndex = normalizeWalletIndex(payload.walletIndex);
      const dappPermissionReferences = getDappPermissionReferences(walletIndex);
      if (dappPermissionReferences.length > 0) {
        throw new Error(formatDappPermissionReferenceError(walletIndex, dappPermissionReferences));
      }
      await identityManager.deleteDerivedWallet(walletIndex);
      const snapshot = await buildSnapshot();
      await notifySnapshotUpdated();
      return { ok: true, walletIndex, snapshot };
    } catch (err) {
      return errorResult(
        'TRUSTED_WALLET_SURFACE_DELETE_WALLET_FAILED',
        err?.message || 'Failed to delete wallet'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.exportPrivateKey, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const walletIndex = normalizeWalletIndex(payload.walletIndex);
      const password = normalizePassword(payload.password);
      const privateKey = await identityManager.exportPrivateKeyWithPassword(walletIndex, password);
      return { ok: true, walletIndex, privateKey };
    } catch (err) {
      return errorResult(
        'TRUSTED_WALLET_SURFACE_EXPORT_PRIVATE_KEY_FAILED',
        err?.message || 'Failed to export wallet private key'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.exportMnemonic, async (event, payload = {}) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    try {
      const password = normalizePassword(payload.password);
      const mnemonic = await identityManager.exportMnemonicWithPassword(password);
      return { ok: true, mnemonic };
    } catch (err) {
      return errorResult(
        'TRUSTED_WALLET_SURFACE_EXPORT_MNEMONIC_FAILED',
        err?.message || 'Failed to export recovery phrase'
      );
    }
  });

  registerSurfaceHandler(electronIpcMain, channels.close, (event) => {
    const mismatch = requireSurfaceSender(event);
    if (mismatch) return mismatch;
    surfaceWindow.close();
    return { ok: true };
  });

  const settingsStore = require('./settings-store');
  if (typeof settingsStore.onSettingsUpdated === 'function') {
    activeThemeUnsubscribe = settingsStore.onSettingsUpdated((settings) => {
      notifyThemeUpdated(getShellThemeForSurface(settings));
    });
  }

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
    mode: surfaceMode,
    layoutMode: surfaceMode === SURFACE_MODE_COMPOSITOR ? SURFACE_DRAWER_LAYOUT_MODE : null,
    reused: false,
    trusted: true,
    owner: 'shell',
  };
}

function closeTrustedWalletSurface() {
  const surfaceWindow = activeWindow;
  const surfaceMode = activeSurfaceMode || SURFACE_MODE_WINDOW;
  if (
    !surfaceWindow ||
    typeof surfaceWindow.isDestroyed !== 'function' ||
    surfaceWindow.isDestroyed()
  ) {
    return {
      ok: true,
      surface: 'wallet',
      mode: surfaceMode,
      layoutMode: surfaceMode === SURFACE_MODE_COMPOSITOR ? SURFACE_DRAWER_LAYOUT_MODE : null,
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
      mode: surfaceMode,
      layoutMode: surfaceMode === SURFACE_MODE_COMPOSITOR ? SURFACE_DRAWER_LAYOUT_MODE : null,
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
  activeSurfaceMode = null;
  activeChannels = [];
  closeListeners = new Set();
  if (activeThemeUnsubscribe) {
    activeThemeUnsubscribe();
    activeThemeUnsubscribe = null;
  }
}

module.exports = {
  channelFor,
  openTrustedWalletSurface,
  closeTrustedWalletSurface,
  _resetForTest,
};
