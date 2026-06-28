const { EventEmitter } = require('events');
const { app, clipboard, dialog, ipcMain, nativeImage } = require('electron');
const IPC = require('../shared/ipc-channels');
const { version: packageVersion } = require('../../package.json');
const { getActiveChromePackage } = require('./chrome-package');
const log = require('./logger');
const { resolveNavigationInput } = require('../shared/navigation-input');
const { createShellTabRegistry } = require('./shell-tabs');
const { defaultTrustedPromptBroker } = require('./trusted-prompt-broker');
const trustedIdentitySurface = require('./trusted-identity-surface');
const trustedPaymentsSurface = require('./trusted-payments-surface');
const trustedSwarmPublishSurface = require('./trusted-swarm-publish-surface');
const trustedWalletSurface = require('./trusted-wallet-surface');
const experimentalShellCompositorSurface = require('./experimental-shell-compositor-surface');
const {
  SHELL_API_CAPABILITIES,
  SHELL_API_EVENTS,
  SHELL_API_METHODS,
  SHELL_API_VERSION,
  getRequiredCapabilityForEvent,
  getRequiredCapabilityForMethod,
} = require('../shared/shell-api-policy');

const shellEvents = new EventEmitter();
const packageCallers = new WeakMap();
const packageSenders = new Set();
let unsubscribeSettingsUpdated = null;
const TAB_COMMAND_METHODS = new Set([
  SHELL_API_METHODS.TABS_CREATE,
  SHELL_API_METHODS.TABS_CLOSE,
  SHELL_API_METHODS.TABS_ACTIVATE,
  SHELL_API_METHODS.TABS_NAVIGATE,
  SHELL_API_METHODS.TABS_RELOAD,
  SHELL_API_METHODS.TABS_GO_HOME,
]);
const SUPPORTED_SURFACES = new Set(['wallet', 'identity', 'payments', 'swarmPublish']);
const SURFACE_CONTROL_CAPABILITIES = Object.freeze({
  wallet: SHELL_API_CAPABILITIES.SURFACES_WALLET_CONTROL,
  identity: SHELL_API_CAPABILITIES.SURFACES_IDENTITY_CONTROL,
  payments: SHELL_API_CAPABILITIES.SURFACES_PAYMENTS_CONTROL,
  swarmPublish: SHELL_API_CAPABILITIES.SURFACES_SWARM_PUBLISH_CONTROL,
});
const SUPPORTED_SERVICES = new Set(['ant', 'ipfs', 'radicle']);
const SURFACE_CAPABILITIES = Object.freeze(['open', 'close', 'toggle']);
const SURFACE_MODES = Object.freeze({
  wallet: 'shell-owned-trusted-window',
  identity: 'shell-owned-trusted-window',
  payments: 'shell-owned-trusted-window',
  swarmPublish: 'shell-owned-trusted-window',
});
const SURFACE_LAYOUT_MODES = Object.freeze({
  wallet: 'dock',
});
const DEFAULT_SURFACE_LAYOUT_MODE = 'overlay';
const TRUSTED_SURFACE_MODES = new Set([
  'shell-owned-trusted-window',
  'shell-owned-webcontents-view',
  experimentalShellCompositorSurface.TEST_SURFACE_MODE,
]);
const MAX_CLIPBOARD_TEXT_LENGTH = 1024 * 1024;
const MAX_WINDOW_TARGET_URL_LENGTH = 4096;
const MAX_CONTEXT_URL_LENGTH = 4096;
const MAX_FAVICON_URL_LENGTH = 4096;
const shellCommandHandlers = {
  onNewWindow: null,
  onCheckForUpdates: null,
  onRestartAndInstallUpdate: null,
  onUpdateTabMenuState: null,
  onSetBookmarkBarToggleEnabled: null,
  onSetBookmarkBarChecked: null,
};
const SENSITIVE_DIAGNOSTIC_KEYS = new Set([
  'entrypath',
  'filepath',
  'installpath',
  'manifestpath',
  'packageroot',
  'preloadpath',
  'realpath',
  'requesteddir',
  'requestedfeed',
  'requestedstore',
  'root',
  'sourcepath',
  'stagingpath',
  'storepath',
  'storeroot',
]);

function createShellApiError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'ShellApiError';
  error.code = code;
  error.details = details;
  return error;
}

function cloneShellApiValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function getAppVersion() {
  if (app && typeof app.getVersion === 'function') {
    return app.getVersion();
  }
  return packageVersion;
}

function isSensitiveDiagnosticKey(key) {
  if (typeof key !== 'string') {
    return false;
  }
  return SENSITIVE_DIAGNOSTIC_KEYS.has(key.toLowerCase());
}

function redactDiagnosticString(value) {
  return value
    .replace(/file:\/\/\/[^\s'"]+/g, 'file://[redacted-path]')
    .replace(/[A-Za-z]:\\(?:[^\\\s'"]+\\?)+/g, '[redacted-path]')
    .replace(/(^|[\s'"])(\/(?:[^/\s'"]+\/)*[^/\s'"]+)/g, '$1[redacted-path]');
}

function sanitizeDiagnosticValue(value, key = '') {
  if (isSensitiveDiagnosticKey(key)) {
    return undefined;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeDiagnosticValue(item))
      .filter((item) => item !== undefined);
  }
  if (value instanceof Error) {
    return sanitizeDiagnosticValue({
      name: value.name,
      message: value.message,
      code: value.code,
      details: value.details,
    });
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const sanitized = sanitizeDiagnosticValue(childValue, childKey);
      if (sanitized !== undefined) {
        result[childKey] = sanitized;
      }
    }
    return result;
  }
  if (typeof value === 'string') {
    return redactDiagnosticString(value);
  }
  return value;
}

function describeGuestContentPolicy(guestContent) {
  if (!guestContent || typeof guestContent !== 'object') {
    return null;
  }
  return {
    webviews: guestContent.webviews === true,
  };
}

function describeChromePackage(chromePackage = getActiveChromePackage()) {
  return {
    runtimeMode: chromePackage.runtimeMode,
    source: chromePackage.source,
    packageId: chromePackage.packageId,
    packageType: chromePackage.packageType,
    name: chromePackage.name,
    version: chromePackage.version,
    capabilities: [...(chromePackage.capabilities || [])],
    guestContent: describeGuestContentPolicy(chromePackage.guestContent),
    fallback: chromePackage.fallback
      ? {
          error: sanitizeDiagnosticValue(chromePackage.fallback.error),
        }
      : null,
  };
}

function createPackageCallerIdentity(sender, chromePackage = getActiveChromePackage()) {
  return Object.freeze({
    webContentsId: Number.isInteger(sender?.id) ? sender.id : null,
    runtimeMode: chromePackage.runtimeMode,
    source: chromePackage.source,
    packageId: chromePackage.packageId,
    packageType: chromePackage.packageType,
    name: chromePackage.name,
    version: chromePackage.version,
    capabilities: Object.freeze([...(chromePackage.capabilities || [])]),
    guestContent: Object.freeze(
      describeGuestContentPolicy(chromePackage.guestContent) || { webviews: false }
    ),
  });
}

function describePackageCaller(identity) {
  if (!identity) {
    return null;
  }

  return {
    runtimeMode: identity.runtimeMode,
    source: identity.source,
    packageId: identity.packageId,
    packageType: identity.packageType,
    name: identity.name,
    version: identity.version,
    capabilities: [...(identity.capabilities || [])],
    guestContent: describeGuestContentPolicy(identity.guestContent),
  };
}

function describeCallerChromePackage(identity) {
  const caller = describePackageCaller(identity);
  if (!caller) {
    return null;
  }
  return {
    ...caller,
    fallback: null,
  };
}

function getInfo(callerIdentity = null) {
  const chromePackage = callerIdentity
    ? describeCallerChromePackage(callerIdentity)
    : describeChromePackage(getActiveChromePackage());
  return {
    shellApiVersion: SHELL_API_VERSION,
    runtimeMode: chromePackage.runtimeMode,
    appVersion: getAppVersion(),
    platform: process.platform,
    theme: getThemeForShell(),
    chromePackage,
    caller: describePackageCaller(callerIdentity),
  };
}

function markReady(event) {
  shellEvents.emit('package-ready', {
    sender: event?.sender || null,
  });
  return { ok: true };
}

function onPackageReady(listener) {
  shellEvents.on('package-ready', listener);
  return () => shellEvents.removeListener('package-ready', listener);
}

function getTestHarnessShellResolvers() {
  if (process.env.FREEDOM_TEST_MODE !== '1') {
    return null;
  }
  return globalThis.__FREEDOM_TEST_HARNESS__ || null;
}

function resolveEnsContentForShell(name) {
  const harness = getTestHarnessShellResolvers();
  if (harness?.resolveEnsContent) {
    return harness.resolveEnsContent(name);
  }
  return require('./ens-resolver').resolveEnsContent(name);
}

function invalidateEnsContentForShell(name) {
  const harness = getTestHarnessShellResolvers();
  if (harness?.invalidateEnsContent) {
    return harness.invalidateEnsContent(name);
  }
  return require('./ens-resolver').invalidateEnsContent(name);
}

function getSettingsForShell() {
  const settingsStore = require('./settings-store');
  if (typeof settingsStore.getSettingsWithShellTheme === 'function') {
    return settingsStore.getSettingsWithShellTheme();
  }
  return settingsStore.loadSettings();
}

function saveSettingsForShell(settings) {
  return require('./settings-store').savePackageSettings(settings);
}

function getThemeForShell() {
  const settingsStore = require('./settings-store');
  if (typeof settingsStore.getShellTheme === 'function') {
    return settingsStore.getShellTheme();
  }
  const settings = settingsStore.loadSettings();
  const mode = settings?.theme === 'light' || settings?.theme === 'dark' ? settings.theme : 'system';
  return {
    mode,
    effective: mode === 'system' ? 'light' : mode,
  };
}

function getThemeFromSettingsPayload(settings) {
  if (settings?.shellTheme) {
    return settings.shellTheme;
  }
  const settingsStore = require('./settings-store');
  if (typeof settingsStore.getShellTheme === 'function') {
    return settingsStore.getShellTheme(settings);
  }
  return getThemeForShell();
}

function emitShellEventToPackageWebContentsSet(eventName, data = {}) {
  for (const sender of [...packageSenders]) {
    emitShellEventToPackageWebContents(sender, eventName, data);
  }
}

function ensureSettingsThemeEventBridge() {
  if (unsubscribeSettingsUpdated) {
    return;
  }
  const settingsStore = require('./settings-store');
  if (typeof settingsStore.onSettingsUpdated !== 'function') {
    unsubscribeSettingsUpdated = () => {};
    return;
  }
  unsubscribeSettingsUpdated = settingsStore.onSettingsUpdated((settings) => {
    emitShellEventToPackageWebContentsSet(
      SHELL_API_EVENTS.THEME_CHANGED,
      getThemeFromSettingsPayload(settings)
    );
  });
}

function normalizeBookmarkForShell(bookmark) {
  if (!bookmark || typeof bookmark !== 'object') {
    return null;
  }
  const label = typeof bookmark.label === 'string' ? bookmark.label.trim() : '';
  const target = typeof bookmark.target === 'string' ? bookmark.target.trim() : '';
  if (!target) {
    return null;
  }
  return label ? { label, target } : { target };
}

function getBookmarksForShell() {
  return require('./bookmarks-store').loadBookmarks();
}

function addBookmarkForShell(bookmark) {
  const normalized = normalizeBookmarkForShell(bookmark);
  if (!normalized) {
    return false;
  }
  return require('./bookmarks-store').addBookmark(normalized);
}

function updateBookmarkForShell({ originalTarget, bookmark } = {}) {
  if (typeof originalTarget !== 'string' || !originalTarget.trim()) {
    return false;
  }
  const normalized = normalizeBookmarkForShell(bookmark);
  if (!normalized) {
    return false;
  }
  return require('./bookmarks-store').updateBookmark(originalTarget.trim(), normalized);
}

function removeBookmarkForShell({ target } = {}) {
  if (typeof target !== 'string' || !target.trim()) {
    return false;
  }
  return require('./bookmarks-store').removeBookmark(target.trim());
}

function normalizePositiveLimit(limit, fallback = null) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), 500);
}

function getHistoryForShell(options = {}) {
  const history = require('./history');
  const limit = normalizePositiveLimit(options?.limit);
  const query = typeof options?.query === 'string' ? options.query.trim() : '';

  if (query) {
    return history.searchHistory(query, limit || 50);
  }
  if (limit) {
    return history.getRecentHistory(limit);
  }
  return history.getAllHistory();
}

function addHistoryForShell(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if (!url) {
    return null;
  }
  const title = typeof entry.title === 'string' ? entry.title : '';
  const protocol = typeof entry.protocol === 'string' ? entry.protocol : 'unknown';
  return require('./history').addHistoryEntry({ url, title, protocol });
}

function removeHistoryForShell(payload = {}) {
  const id = Number(payload?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return false;
  }
  return require('./history').removeHistoryEntry(id);
}

function clearHistoryForShell() {
  return require('./history').clearHistory();
}

function getCachedFaviconForShell(url) {
  if (typeof url !== 'string' || !url.trim()) {
    return null;
  }
  return require('./favicons').getCachedFavicon(url.trim());
}

function normalizeFaviconUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const url = value.trim();
  if (!url || url.length > MAX_FAVICON_URL_LENGTH) {
    return null;
  }
  return url;
}

function getFaviconForShell(url) {
  const normalized = normalizeFaviconUrl(url);
  if (!normalized) {
    return null;
  }
  return require('./favicons').getFavicon(normalized);
}

function fetchFaviconForShell(url) {
  const normalized = normalizeFaviconUrl(url);
  if (!normalized || !/^https?:\/\//i.test(normalized)) {
    return null;
  }
  return require('./favicons').fetchFavicon(normalized);
}

function fetchFaviconWithKeyForShell(payload = {}) {
  const fetchUrl = normalizeFaviconUrl(payload?.fetchUrl);
  const cacheKey = normalizeFaviconUrl(payload?.cacheKey);
  if (!fetchUrl || !cacheKey || !/^https?:\/\//i.test(fetchUrl)) {
    return null;
  }
  return require('./favicons').fetchFavicon(fetchUrl, cacheKey);
}

function serializeProfileForShell(profile, options = {}) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const id = typeof profile.id === 'string' ? profile.id : '';
  const displayName = typeof profile.displayName === 'string' ? profile.displayName : '';
  if (!id && !displayName) {
    return null;
  }

  const serialized = {};
  if (id) serialized.id = id;
  if (displayName) serialized.displayName = displayName;
  if (typeof profile.source === 'string') serialized.source = profile.source;
  serialized.isDev = profile.isDev === true;
  if (profile.isActive === true || options.isActive === true) {
    serialized.isActive = true;
  }
  if (profile.isUnregistered === true) {
    serialized.isUnregistered = true;
  }
  return serialized;
}

function getActiveProfileForShell() {
  const { getActiveProfile } = require('./profile-resolver');
  return serializeProfileForShell(getActiveProfile(), { isActive: true });
}

function listProfilesForShell() {
  const { listProfilesForActiveApp } = require('./profile-resolver');
  const activeProfile = getActiveProfileForShell();
  const profiles = listProfilesForActiveApp();
  if (!profiles) {
    return {
      success: true,
      profiles: activeProfile ? [activeProfile] : [],
    };
  }

  return {
    success: true,
    profiles: profiles
      .map((profile) =>
        serializeProfileForShell(profile, {
          isActive: profile?.isActive === true || profile?.id === activeProfile?.id,
        })
      )
      .filter(Boolean),
  };
}

function getServiceName(payload) {
  if (typeof payload === 'string') {
    return payload.trim();
  }
  if (payload && typeof payload === 'object' && typeof payload.service === 'string') {
    return payload.service.trim();
  }
  return '';
}

function serviceResultError(service, code, message) {
  return {
    success: false,
    service,
    controllable: false,
    error: { code, message },
  };
}

function getServiceManager(service) {
  if (service === 'ant') return require('./ant-manager');
  if (service === 'ipfs') return require('./ipfs-manager');
  if (service === 'radicle') return require('./radicle-manager');
  return null;
}

function getServiceRegistryForShell() {
  return require('./service-registry').getPackageVisibleRegistry();
}

function getServiceStatusForShell([payload]) {
  const service = getServiceName(payload);
  if (!SUPPORTED_SERVICES.has(service)) {
    return serviceResultError(service, 'SERVICE_UNSUPPORTED', 'Unsupported service');
  }

  const manager = getServiceManager(service);
  const status =
    typeof manager?.getStatus === 'function'
      ? manager.getStatus()
      : { status: 'stopped', error: null };
  return require('./service-registry').createPackageVisibleServiceStatus(service, status);
}

function checkServiceBinaryForShell([payload]) {
  const service = getServiceName(payload);
  if (!SUPPORTED_SERVICES.has(service)) {
    return serviceResultError(service, 'SERVICE_UNSUPPORTED', 'Unsupported service');
  }

  const manager = getServiceManager(service);
  return {
    success: true,
    service,
    available: typeof manager?.checkBinary === 'function' ? manager.checkBinary() === true : false,
    controllable: false,
  };
}

function getSurfaceName(payload) {
  if (typeof payload === 'string') {
    return payload.trim();
  }
  if (payload && typeof payload === 'object' && typeof payload.surface === 'string') {
    return payload.surface.trim();
  }
  return '';
}

function getSurfaceControlCapability(surface) {
  if (experimentalShellCompositorSurface.isExperimentalSurfaceSupported(surface)) {
    return SHELL_API_CAPABILITIES.SURFACES_WALLET_CONTROL;
  }
  return SURFACE_CONTROL_CAPABILITIES[surface] || null;
}

function getSurfaceMode(surface) {
  if (experimentalShellCompositorSurface.isExperimentalSurfaceSupported(surface)) {
    return experimentalShellCompositorSurface.TEST_SURFACE_MODE;
  }
  return SURFACE_MODES[surface] || 'shell-owned-placeholder';
}

function getSurfaceModeForCaller(caller, surface) {
  return caller?.surfaceModes?.get(surface) || getSurfaceMode(surface);
}

function getSurfaceLayoutMode(surface) {
  return SURFACE_LAYOUT_MODES[surface] || DEFAULT_SURFACE_LAYOUT_MODE;
}

function getSurfaceLayoutModeForCaller(caller, surface, mode = getSurfaceModeForCaller(caller, surface)) {
  if (mode !== 'shell-owned-webcontents-view') {
    return null;
  }
  return caller?.surfaceLayoutModes?.get(surface) || getSurfaceLayoutMode(surface);
}

function isTrustedSurfaceMode(mode) {
  return TRUSTED_SURFACE_MODES.has(mode);
}

function isSurfaceSupported(surface) {
  return (
    SUPPORTED_SURFACES.has(surface) ||
    experimentalShellCompositorSurface.isExperimentalSurfaceSupported(surface)
  );
}

function describeSurfaceState(caller, surface) {
  const mode = getSurfaceModeForCaller(caller, surface);
  const layoutMode = getSurfaceLayoutModeForCaller(caller, surface, mode);
  if (!isSurfaceSupported(surface)) {
    const unsupportedState = {
      ok: false,
      surface,
      owner: 'shell',
      mode,
      trusted: true,
      error: {
        code: 'SURFACE_UNSUPPORTED',
        message: 'Unsupported shell surface',
      },
    };
    if (layoutMode) {
      unsupportedState.layoutMode = layoutMode;
    }
    return unsupportedState;
  }

  const state = {
    ok: true,
    surface,
    open: caller.surfaces.get(surface) === true,
    owner: 'shell',
    mode,
    trusted: true,
    capabilities: [...SURFACE_CAPABILITIES],
  };
  if (layoutMode) {
    state.layoutMode = layoutMode;
  }
  return state;
}

function emitSurfaceStateChanged(event, caller, state, previousOpen) {
  if (state?.ok !== true || previousOpen === state.open) {
    return;
  }
  emitShellEvent(event, caller, SHELL_API_EVENTS.SURFACES_STATE_CHANGED, state);
}

function getEventOwnerWindow(event) {
  return event?.ownerWindow || event?.sender?.getOwnerBrowserWindow?.() || null;
}

function updateOwnerSurfaceRail(event, state) {
  if (state?.ok !== true || typeof state.surface !== 'string') {
    return null;
  }
  const shellWindow = getEventOwnerWindow(event)?.__freedomShellWindow || null;
  return shellWindow?.updateSurfaceRailState?.({
    surface: state.surface,
    open: state.open === true,
  }) || null;
}

async function openTrustedPaymentsSurfaceForCaller(caller, event) {
  const ownerWindow = getEventOwnerWindow(event);
  return trustedPaymentsSurface.openTrustedPaymentsSurface({
    ownerWindow,
    caller: caller.identity,
    onClosed: () => {
      const previousOpen = caller.surfaces.get('payments') === true;
      caller.surfaces.set('payments', false);
      const state = describeSurfaceState(caller, 'payments');
      updateOwnerSurfaceRail(event, state);
      emitSurfaceStateChanged(event, caller, state, previousOpen);
    },
  });
}

async function openTrustedWalletSurfaceForCaller(caller, event) {
  const ownerWindow = getEventOwnerWindow(event);
  return trustedWalletSurface.openTrustedWalletSurface({
    ownerWindow,
    caller: caller.identity,
    onClosed: () => {
      const previousOpen = caller.surfaces.get('wallet') === true;
      caller.surfaces.set('wallet', false);
      const state = describeSurfaceState(caller, 'wallet');
      updateOwnerSurfaceRail(event, state);
      emitSurfaceStateChanged(event, caller, state, previousOpen);
    },
  });
}

async function openTrustedIdentitySurfaceForCaller(caller, event) {
  const ownerWindow = getEventOwnerWindow(event);
  return trustedIdentitySurface.openTrustedIdentitySurface({
    ownerWindow,
    caller: caller.identity,
    onClosed: () => {
      const previousOpen = caller.surfaces.get('identity') === true;
      caller.surfaces.set('identity', false);
      const state = describeSurfaceState(caller, 'identity');
      updateOwnerSurfaceRail(event, state);
      emitSurfaceStateChanged(event, caller, state, previousOpen);
    },
  });
}

async function openTrustedSwarmPublishSurfaceForCaller(caller, event) {
  const ownerWindow = getEventOwnerWindow(event);
  return trustedSwarmPublishSurface.openTrustedSwarmPublishSurface({
    ownerWindow,
    hostWebContents: event?.sender || null,
    caller: caller.identity,
    onClosed: () => {
      const previousOpen = caller.surfaces.get('swarmPublish') === true;
      caller.surfaces.set('swarmPublish', false);
      const state = describeSurfaceState(caller, 'swarmPublish');
      updateOwnerSurfaceRail(event, state);
      emitSurfaceStateChanged(event, caller, state, previousOpen);
    },
  });
}

async function openTrustedSurfaceForCaller(surface, caller, event) {
  if (experimentalShellCompositorSurface.isExperimentalSurfaceSupported(surface)) {
    const ownerWindow = getEventOwnerWindow(event);
    return experimentalShellCompositorSurface.openExperimentalShellCompositorSurface({
      ownerWindow,
      onClosed: () => {
        const previousOpen = caller.surfaces.get(surface) === true;
        caller.surfaces.set(surface, false);
        const state = describeSurfaceState(caller, surface);
        emitSurfaceStateChanged(event, caller, state, previousOpen);
      },
    });
  }
  if (surface === 'wallet') {
    return openTrustedWalletSurfaceForCaller(caller, event);
  }
  if (surface === 'identity') {
    return openTrustedIdentitySurfaceForCaller(caller, event);
  }
  if (surface === 'payments') {
    return openTrustedPaymentsSurfaceForCaller(caller, event);
  }
  if (surface === 'swarmPublish') {
    return openTrustedSwarmPublishSurfaceForCaller(caller, event);
  }
  return null;
}

function closeTrustedSurface(surface, event) {
  if (experimentalShellCompositorSurface.isExperimentalSurfaceSupported(surface)) {
    const ownerWindow = event?.sender?.getOwnerBrowserWindow?.() || null;
    return experimentalShellCompositorSurface.closeExperimentalShellCompositorSurface(ownerWindow);
  }
  if (surface === 'wallet') {
    return trustedWalletSurface.closeTrustedWalletSurface();
  }
  if (surface === 'identity') {
    return trustedIdentitySurface.closeTrustedIdentitySurface();
  }
  if (surface === 'payments') {
    return trustedPaymentsSurface.closeTrustedPaymentsSurface();
  }
  if (surface === 'swarmPublish') {
    return trustedSwarmPublishSurface.closeTrustedSwarmPublishSurface();
  }
  return null;
}

async function setSurfaceOpen(caller, payload, open, event) {
  const surface = getSurfaceName(payload);
  if (!isSurfaceSupported(surface)) {
    return describeSurfaceState(caller, surface);
  }

  const previousOpen = caller.surfaces.get(surface) === true;
  if (isTrustedSurfaceMode(getSurfaceModeForCaller(caller, surface))) {
    const result = open
      ? await openTrustedSurfaceForCaller(surface, caller, event)
      : closeTrustedSurface(surface, event);
    if (result?.ok !== true) {
      return {
        ok: false,
        surface,
        owner: 'shell',
        mode: getSurfaceModeForCaller(caller, surface),
        trusted: true,
        error: result?.error || {
          code: 'SURFACE_OPEN_FAILED',
          message: `Failed to update trusted ${surface} surface`,
        },
      };
    }
    if (result?.mode) {
      caller.surfaceModes.set(surface, result.mode);
    }
    if (result?.layoutMode) {
      caller.surfaceLayoutModes.set(surface, result.layoutMode);
    }
  }
  caller.surfaces.set(surface, open);
  const state = describeSurfaceState(caller, surface);
  updateOwnerSurfaceRail(event, state);
  emitSurfaceStateChanged(event, caller, state, previousOpen);
  return state;
}

async function toggleSurfaceOpen(caller, payload, event) {
  const surface = getSurfaceName(payload);
  if (!isSurfaceSupported(surface)) {
    return describeSurfaceState(caller, surface);
  }

  const previousOpen = caller.surfaces.get(surface) === true;
  const nextOpen = !previousOpen;
  if (isTrustedSurfaceMode(getSurfaceModeForCaller(caller, surface))) {
    const result = nextOpen
      ? await openTrustedSurfaceForCaller(surface, caller, event)
      : closeTrustedSurface(surface);
    if (result?.ok !== true) {
      return {
        ok: false,
        surface,
        owner: 'shell',
        mode: getSurfaceModeForCaller(caller, surface),
        trusted: true,
        error: result?.error || {
          code: 'SURFACE_OPEN_FAILED',
          message: `Failed to update trusted ${surface} surface`,
        },
      };
    }
    if (result?.mode) {
      caller.surfaceModes.set(surface, result.mode);
    }
    if (result?.layoutMode) {
      caller.surfaceLayoutModes.set(surface, result.layoutMode);
    }
  }
  caller.surfaces.set(surface, nextOpen);
  const state = describeSurfaceState(caller, surface);
  updateOwnerSurfaceRail(event, state);
  emitSurfaceStateChanged(event, caller, state, previousOpen);
  return state;
}

async function presentNativeTestTrustedPrompt(request, context = {}) {
  if (!dialog || typeof dialog.showMessageBox !== 'function') {
    return {
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_NATIVE_DIALOG_UNAVAILABLE',
        message: 'Native trusted prompt dialog is unavailable',
      },
    };
  }

  const ownerWindow = context.ownerWindow || null;
  const result = await dialog.showMessageBox(ownerWindow, {
    type: 'info',
    title: 'Freedom Trusted Prompt',
    message: 'Freedom trusted prompt',
    detail: request.reason || 'Test trusted prompt request',
    buttons: ['OK'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return {
    ok: true,
    outcome: 'accepted',
    response: result?.response,
  };
}

function requestTestTrustedPromptForShell(payload, caller, event) {
  return defaultTrustedPromptBroker.requestTestPrompt(payload, {
    caller: caller.identity,
    ownerWindow: event?.sender?.getOwnerBrowserWindow?.() || null,
    presentNativeDialog: presentNativeTestTrustedPrompt,
  });
}

function formatWindowTitleForShell(title) {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return trimmed ? `${trimmed} - Freedom` : 'Freedom';
}

function describeWindowState(window) {
  return {
    minimized: typeof window?.isMinimized === 'function' ? window.isMinimized() : false,
    maximized: typeof window?.isMaximized === 'function' ? window.isMaximized() : false,
    fullScreen: typeof window?.isFullScreen === 'function' ? window.isFullScreen() : false,
  };
}

function controlOwnerWindow(event, command, action) {
  const window = event?.sender?.getOwnerBrowserWindow?.() || null;
  if (!window || window.isDestroyed?.()) {
    return {
      ok: false,
      command,
      owner: 'shell',
      error: {
        code: 'WINDOW_UNAVAILABLE',
        message: 'Owner window is unavailable',
      },
    };
  }

  try {
    const details = action(window) || {};
    return {
      ok: true,
      command,
      owner: 'shell',
      ...details,
      state: describeWindowState(window),
    };
  } catch {
    return {
      ok: false,
      command,
      owner: 'shell',
      error: {
        code: 'WINDOW_COMMAND_FAILED',
        message: 'Window command failed',
      },
    };
  }
}

function setWindowTitleForShell([title], event) {
  const formattedTitle = formatWindowTitleForShell(title);
  return controlOwnerWindow(event, SHELL_API_METHODS.WINDOWS_SET_TITLE, (window) => {
    window.setTitle(formattedTitle);
    return { title: formattedTitle };
  });
}

function closeWindowForShell(_args, event) {
  return controlOwnerWindow(event, SHELL_API_METHODS.WINDOWS_CLOSE, (window) => {
    window.close();
  });
}

function minimizeWindowForShell(_args, event) {
  return controlOwnerWindow(event, SHELL_API_METHODS.WINDOWS_MINIMIZE, (window) => {
    window.minimize();
  });
}

function toggleMaximizeWindowForShell(_args, event) {
  return controlOwnerWindow(event, SHELL_API_METHODS.WINDOWS_TOGGLE_MAXIMIZE, (window) => {
    if (window.isMaximized?.()) {
      window.unmaximize?.();
      return { maximized: false };
    }
    window.maximize?.();
    return { maximized: true };
  });
}

function toggleFullscreenWindowForShell(_args, event) {
  return controlOwnerWindow(event, SHELL_API_METHODS.WINDOWS_TOGGLE_FULLSCREEN, (window) => {
    const nextFullScreen = !window.isFullScreen?.();
    window.setFullScreen?.(nextFullScreen);
    return { fullScreen: nextFullScreen };
  });
}

function configureShellCommandHandlers(options = {}) {
  shellCommandHandlers.onNewWindow =
    typeof options.onNewWindow === 'function' ? options.onNewWindow : null;
  shellCommandHandlers.onCheckForUpdates =
    typeof options.onCheckForUpdates === 'function' ? options.onCheckForUpdates : null;
  shellCommandHandlers.onRestartAndInstallUpdate =
    typeof options.onRestartAndInstallUpdate === 'function'
      ? options.onRestartAndInstallUpdate
      : null;
  shellCommandHandlers.onUpdateTabMenuState =
    typeof options.onUpdateTabMenuState === 'function' ? options.onUpdateTabMenuState : null;
  shellCommandHandlers.onSetBookmarkBarToggleEnabled =
    typeof options.onSetBookmarkBarToggleEnabled === 'function'
      ? options.onSetBookmarkBarToggleEnabled
      : null;
  shellCommandHandlers.onSetBookmarkBarChecked =
    typeof options.onSetBookmarkBarChecked === 'function'
      ? options.onSetBookmarkBarChecked
      : null;
}

function shellCommandUnavailable(command, message = 'Shell command is unavailable') {
  return {
    ok: false,
    command,
    owner: 'shell',
    error: {
      code: 'SHELL_COMMAND_UNAVAILABLE',
      message,
    },
  };
}

function shellCommandFailed(command, message = 'Shell command failed') {
  return {
    ok: false,
    command,
    owner: 'shell',
    error: {
      code: 'SHELL_COMMAND_FAILED',
      message,
    },
  };
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return Math.floor(number);
}

function normalizeTabMenuState(state) {
  const payload = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const tabCount = normalizeNonNegativeInteger(payload.tabCount, 0);
  const activeIndex = normalizeNonNegativeInteger(payload.activeIndex, 0);
  return {
    tabCount,
    activeIndex: tabCount > 0 ? Math.min(activeIndex, tabCount - 1) : 0,
    hasClosedTabs: payload.hasClosedTabs === true,
  };
}

function getOwnerWindowForShellEvent(event) {
  try {
    return event?.sender?.getOwnerBrowserWindow?.() || null;
  } catch {
    return null;
  }
}

function runChromeUiMenuStateCommand(command, handler, payload, event) {
  if (typeof handler !== 'function') {
    return shellCommandUnavailable(command, 'Chrome UI menu state command is unavailable');
  }

  try {
    const ownerWindow = getOwnerWindowForShellEvent(event);
    const applied = ownerWindow ? handler(payload, ownerWindow) : handler(payload);
    return {
      ok: applied !== false,
      command,
      owner: 'shell',
    };
  } catch {
    return shellCommandFailed(command, 'Chrome UI menu state command failed');
  }
}

function updateTabMenuStateForShell([state], event) {
  return runChromeUiMenuStateCommand(
    SHELL_API_METHODS.CHROME_UI_UPDATE_TAB_MENU_STATE,
    shellCommandHandlers.onUpdateTabMenuState,
    normalizeTabMenuState(state),
    event
  );
}

function setBookmarkBarToggleEnabledForShell([enabled], event) {
  return runChromeUiMenuStateCommand(
    SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_TOGGLE_ENABLED,
    shellCommandHandlers.onSetBookmarkBarToggleEnabled,
    Boolean(enabled),
    event
  );
}

function setBookmarkBarCheckedForShell([checked], event) {
  return runChromeUiMenuStateCommand(
    SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_CHECKED,
    shellCommandHandlers.onSetBookmarkBarChecked,
    Boolean(checked),
    event
  );
}

function shellActionResultError(code, message) {
  return {
    success: false,
    error: {
      code,
      message,
    },
  };
}

function normalizeShellContextUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) {
    return { error: shellActionResultError('URL_MISSING', 'Missing URL') };
  }
  if (url.length > MAX_CONTEXT_URL_LENGTH) {
    return { error: shellActionResultError('URL_TOO_LONG', 'URL is too long') };
  }
  return { url };
}

function defaultImageFileName(imageUrl) {
  try {
    const url = new URL(imageUrl);
    const lastSegment = url.pathname.split('/').pop();
    if (lastSegment) {
      return lastSegment;
    }
  } catch {
    // Use the generic fallback below.
  }
  return 'image';
}

function copyTextForShell([text]) {
  if (typeof text !== 'string' || !text) {
    return shellActionResultError('CLIPBOARD_TEXT_MISSING', 'No text provided');
  }
  if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
    return shellActionResultError('CLIPBOARD_TEXT_TOO_LONG', 'Clipboard text is too long');
  }
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return shellActionResultError('CLIPBOARD_UNAVAILABLE', 'Clipboard is unavailable');
  }

  try {
    clipboard.writeText(text);
    return { success: true };
  } catch {
    return shellActionResultError('CLIPBOARD_WRITE_FAILED', 'Clipboard write failed');
  }
}

async function copyImageFromUrlForShell([imageUrl]) {
  const normalized = normalizeShellContextUrl(imageUrl);
  if (normalized.error) {
    return normalized.error;
  }
  if (!clipboard || typeof clipboard.writeImage !== 'function') {
    return shellActionResultError('CLIPBOARD_UNAVAILABLE', 'Clipboard is unavailable');
  }
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
    return shellActionResultError('IMAGE_CLIPBOARD_UNAVAILABLE', 'Image clipboard is unavailable');
  }

  try {
    const { fetchBuffer } = require('./http-fetch');
    const imageData = await fetchBuffer(normalized.url);
    const image = nativeImage.createFromBuffer(imageData);
    if (!image || image.isEmpty?.()) {
      return shellActionResultError('IMAGE_DECODE_FAILED', 'Failed to create image from data');
    }
    clipboard.writeImage(image);
    return { success: true };
  } catch (error) {
    log.error('[shell-api] Failed to copy image:', error);
    return shellActionResultError(
      'IMAGE_COPY_FAILED',
      error?.message || 'Failed to copy image'
    );
  }
}

async function saveImageForShell([imageUrl], event) {
  const normalized = normalizeShellContextUrl(imageUrl);
  if (normalized.error) {
    return normalized.error;
  }
  if (!dialog || typeof dialog.showSaveDialog !== 'function') {
    return shellActionResultError('SAVE_DIALOG_UNAVAILABLE', 'Save dialog is unavailable');
  }

  try {
    const window = event?.sender?.getOwnerBrowserWindow?.() || null;
    const result = await dialog.showSaveDialog(window, {
      defaultPath: defaultImageFileName(normalized.url),
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result?.canceled || !result?.filePath) {
      return { success: false, canceled: true };
    }

    const { fetchToFile } = require('./http-fetch');
    await fetchToFile(normalized.url, result.filePath);
    return { success: true };
  } catch (error) {
    log.error('[shell-api] Failed to save image:', error);
    return shellActionResultError(
      'IMAGE_SAVE_FAILED',
      error?.message || 'Failed to save image'
    );
  }
}

function normalizeNewWindowTargetUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const targetUrl = value.trim();
  if (!targetUrl) {
    return null;
  }
  if (targetUrl.length > MAX_WINDOW_TARGET_URL_LENGTH) {
    return {
      error: {
        code: 'WINDOW_TARGET_URL_TOO_LONG',
        message: 'Window target URL is too long',
      },
    };
  }
  return { targetUrl };
}

function openShellWindow(command, targetUrl = null) {
  if (typeof shellCommandHandlers.onNewWindow !== 'function') {
    return shellCommandUnavailable(command, 'New window command is unavailable');
  }

  try {
    shellCommandHandlers.onNewWindow(targetUrl);
    return {
      ok: true,
      command,
      owner: 'shell',
      targetUrl,
    };
  } catch {
    return shellCommandFailed(command, 'New window command failed');
  }
}

function openNewWindowForShell() {
  return openShellWindow(SHELL_API_METHODS.WINDOWS_NEW, null);
}

function openUrlInNewWindowForShell([url]) {
  const normalized = normalizeNewWindowTargetUrl(url);
  if (!normalized || normalized.error) {
    return {
      ok: false,
      command: SHELL_API_METHODS.WINDOWS_OPEN_URL,
      owner: 'shell',
      error: normalized?.error || {
        code: 'WINDOW_TARGET_URL_INVALID',
        message: 'Window target URL is invalid',
      },
    };
  }
  return openShellWindow(SHELL_API_METHODS.WINDOWS_OPEN_URL, normalized.targetUrl);
}

function showAboutForShell() {
  if (!app || typeof app.showAboutPanel !== 'function') {
    return shellCommandUnavailable(SHELL_API_METHODS.APP_SHOW_ABOUT, 'About panel is unavailable');
  }

  try {
    app.showAboutPanel();
    return {
      ok: true,
      command: SHELL_API_METHODS.APP_SHOW_ABOUT,
      owner: 'shell',
    };
  } catch {
    return shellCommandFailed(SHELL_API_METHODS.APP_SHOW_ABOUT, 'About panel failed to open');
  }
}

function checkForUpdatesForShell() {
  if (typeof shellCommandHandlers.onCheckForUpdates !== 'function') {
    return shellCommandUnavailable(
      SHELL_API_METHODS.APP_CHECK_FOR_UPDATES,
      'Update check command is unavailable'
    );
  }

  try {
    shellCommandHandlers.onCheckForUpdates();
    return {
      ok: true,
      command: SHELL_API_METHODS.APP_CHECK_FOR_UPDATES,
      owner: 'shell',
    };
  } catch {
    return shellCommandFailed(SHELL_API_METHODS.APP_CHECK_FOR_UPDATES, 'Update check failed');
  }
}

function restartAndInstallUpdateForShell() {
  if (typeof shellCommandHandlers.onRestartAndInstallUpdate !== 'function') {
    return shellCommandUnavailable(
      SHELL_API_METHODS.APP_RESTART_AND_INSTALL_UPDATE,
      'Update install command is unavailable'
    );
  }

  try {
    shellCommandHandlers.onRestartAndInstallUpdate();
    return {
      ok: true,
      command: SHELL_API_METHODS.APP_RESTART_AND_INSTALL_UPDATE,
      owner: 'shell',
    };
  } catch {
    return shellCommandFailed(
      SHELL_API_METHODS.APP_RESTART_AND_INSTALL_UPDATE,
      'Update install failed'
    );
  }
}

function registerPackageWebContents(sender, chromePackage = getActiveChromePackage(), options = {}) {
  if (!sender || typeof sender !== 'object') {
    return () => {};
  }

  const identity = createPackageCallerIdentity(sender, chromePackage);
  const caller = {
    identity,
    capabilities: new Set(identity.capabilities || []),
    tabRegistry: options.tabRegistry || createShellTabRegistry(),
    surfaces:
      options.surfaces ||
      new Map([
        ['wallet', false],
        ['payments', false],
        ['swarmPublish', false],
      ]),
    surfaceModes: options.surfaceModes || new Map(),
    surfaceLayoutModes: options.surfaceLayoutModes || new Map(),
  };
  packageCallers.set(sender, caller);
  packageSenders.add(sender);
  ensureSettingsThemeEventBridge();

  return () => {
    packageCallers.delete(sender);
    packageSenders.delete(sender);
  };
}

function isPackageWebContents(sender) {
  return packageCallers.has(sender);
}

function getPackageWebContentsIdentity(sender) {
  return packageCallers.get(sender)?.identity || null;
}

function getPackageCaller(event) {
  const sender = event?.sender || null;
  if (!sender) {
    throw createShellApiError('SHELL_SENDER_MISSING', 'Shell API request is missing a sender');
  }
  if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) {
    throw createShellApiError('SHELL_SENDER_DESTROYED', 'Shell API sender is destroyed');
  }

  const caller = packageCallers.get(sender);
  if (!caller) {
    throw createShellApiError(
      'SHELL_SENDER_UNAUTHORIZED',
      'Shell API request came from an unauthorized sender'
    );
  }

  return caller;
}

async function setSurfaceOpenForPackageWebContents(sender, payload, open, options = {}) {
  const caller = packageCallers.get(sender);
  if (!caller) {
    return {
      ok: false,
      surface: getSurfaceName(payload),
      owner: 'shell',
      trusted: true,
      error: {
        code: 'SHELL_SENDER_UNAUTHORIZED',
        message: 'No package caller is registered for this shell surface command',
      },
    };
  }
  const method = open ? SHELL_API_METHODS.SURFACES_OPEN : SHELL_API_METHODS.SURFACES_CLOSE;
  assertMethodCapability(caller, method, [payload]);
  return setSurfaceOpen(caller, payload, open, {
    sender,
    ownerWindow: options.ownerWindow || null,
  });
}

const METHODS = Object.freeze({
  [SHELL_API_METHODS.GET_INFO]: {
    handler: (_args, _event, caller) => getInfo(caller.identity),
  },
  [SHELL_API_METHODS.THEME_GET]: {
    handler: () => getThemeForShell(),
  },
  [SHELL_API_METHODS.MARK_READY]: {
    handler: (_args, event) => markReady(event),
  },
  [SHELL_API_METHODS.RESOLVE_NAVIGATION_INPUT]: {
    handler: ([input]) => resolveNavigationInput(input),
  },
  [SHELL_API_METHODS.RESOLVE_ENS]: {
    handler: ([name]) => resolveEnsContentForShell(name),
  },
  [SHELL_API_METHODS.INVALIDATE_ENS_CONTENT]: {
    handler: ([name]) => invalidateEnsContentForShell(name),
  },
  [SHELL_API_METHODS.TABS_GET_SNAPSHOT]: {
    handler: (_args, _event, caller) => caller.tabRegistry.getSnapshot(),
  },
  [SHELL_API_METHODS.TABS_CREATE]: {
    handler: ([options], _event, caller) => caller.tabRegistry.createTab(options),
  },
  [SHELL_API_METHODS.TABS_CLOSE]: {
    handler: ([options], _event, caller) => caller.tabRegistry.closeTab(options),
  },
  [SHELL_API_METHODS.TABS_ACTIVATE]: {
    handler: ([options], _event, caller) => caller.tabRegistry.activateTab(options),
  },
  [SHELL_API_METHODS.TABS_NAVIGATE]: {
    handler: ([options], _event, caller) => caller.tabRegistry.navigateTab(options),
  },
  [SHELL_API_METHODS.TABS_RELOAD]: {
    handler: ([options], _event, caller) => caller.tabRegistry.reloadTab(options),
  },
  [SHELL_API_METHODS.TABS_GO_HOME]: {
    handler: ([options], _event, caller) => caller.tabRegistry.goHome(options),
  },
  [SHELL_API_METHODS.BROWSER_STATE_SETTINGS_GET]: {
    handler: () => getSettingsForShell(),
  },
  [SHELL_API_METHODS.BROWSER_STATE_SETTINGS_SAVE]: {
    handler: ([settings]) => saveSettingsForShell(settings),
  },
  [SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_GET]: {
    handler: () => getBookmarksForShell(),
  },
  [SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_ADD]: {
    handler: ([bookmark]) => addBookmarkForShell(bookmark),
  },
  [SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_UPDATE]: {
    handler: ([payload]) => updateBookmarkForShell(payload),
  },
  [SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_REMOVE]: {
    handler: ([payload]) => removeBookmarkForShell(payload),
  },
  [SHELL_API_METHODS.BROWSER_STATE_HISTORY_GET]: {
    handler: ([options]) => getHistoryForShell(options),
  },
  [SHELL_API_METHODS.BROWSER_STATE_HISTORY_ADD]: {
    handler: ([entry]) => addHistoryForShell(entry),
  },
  [SHELL_API_METHODS.BROWSER_STATE_HISTORY_REMOVE]: {
    handler: ([payload]) => removeHistoryForShell(payload),
  },
  [SHELL_API_METHODS.BROWSER_STATE_HISTORY_CLEAR]: {
    handler: () => clearHistoryForShell(),
  },
  [SHELL_API_METHODS.BROWSER_STATE_FAVICONS_GET]: {
    handler: ([url]) => getFaviconForShell(url),
  },
  [SHELL_API_METHODS.BROWSER_STATE_FAVICONS_GET_CACHED]: {
    handler: ([url]) => getCachedFaviconForShell(url),
  },
  [SHELL_API_METHODS.BROWSER_STATE_FAVICONS_FETCH]: {
    handler: ([url]) => fetchFaviconForShell(url),
  },
  [SHELL_API_METHODS.BROWSER_STATE_FAVICONS_FETCH_WITH_KEY]: {
    handler: ([payload]) => fetchFaviconWithKeyForShell(payload),
  },
  [SHELL_API_METHODS.BROWSER_STATE_PROFILES_GET_ACTIVE]: {
    handler: () => getActiveProfileForShell(),
  },
  [SHELL_API_METHODS.BROWSER_STATE_PROFILES_LIST]: {
    handler: () => listProfilesForShell(),
  },
  [SHELL_API_METHODS.SERVICES_GET_REGISTRY]: {
    handler: () => getServiceRegistryForShell(),
  },
  [SHELL_API_METHODS.SERVICES_GET_STATUS]: {
    handler: getServiceStatusForShell,
  },
  [SHELL_API_METHODS.SERVICES_CHECK_BINARY]: {
    handler: checkServiceBinaryForShell,
  },
  [SHELL_API_METHODS.SURFACES_GET_STATE]: {
    handler: ([payload], _event, caller) => describeSurfaceState(caller, getSurfaceName(payload)),
  },
  [SHELL_API_METHODS.SURFACES_OPEN]: {
    handler: ([payload], event, caller) => setSurfaceOpen(caller, payload, true, event),
  },
  [SHELL_API_METHODS.SURFACES_CLOSE]: {
    handler: ([payload], event, caller) => setSurfaceOpen(caller, payload, false, event),
  },
  [SHELL_API_METHODS.SURFACES_TOGGLE]: {
    handler: ([payload], event, caller) => toggleSurfaceOpen(caller, payload, event),
  },
  [SHELL_API_METHODS.TRUSTED_PROMPTS_REQUEST_TEST]: {
    handler: ([payload], event, caller) => requestTestTrustedPromptForShell(payload, caller, event),
  },
  [SHELL_API_METHODS.APP_SHOW_ABOUT]: {
    handler: showAboutForShell,
  },
  [SHELL_API_METHODS.APP_CHECK_FOR_UPDATES]: {
    handler: checkForUpdatesForShell,
  },
  [SHELL_API_METHODS.APP_RESTART_AND_INSTALL_UPDATE]: {
    handler: restartAndInstallUpdateForShell,
  },
  [SHELL_API_METHODS.WINDOWS_NEW]: {
    handler: openNewWindowForShell,
  },
  [SHELL_API_METHODS.WINDOWS_OPEN_URL]: {
    handler: openUrlInNewWindowForShell,
  },
  [SHELL_API_METHODS.WINDOWS_SET_TITLE]: {
    handler: setWindowTitleForShell,
  },
  [SHELL_API_METHODS.WINDOWS_CLOSE]: {
    handler: closeWindowForShell,
  },
  [SHELL_API_METHODS.WINDOWS_MINIMIZE]: {
    handler: minimizeWindowForShell,
  },
  [SHELL_API_METHODS.WINDOWS_TOGGLE_MAXIMIZE]: {
    handler: toggleMaximizeWindowForShell,
  },
  [SHELL_API_METHODS.WINDOWS_TOGGLE_FULLSCREEN]: {
    handler: toggleFullscreenWindowForShell,
  },
  [SHELL_API_METHODS.CHROME_UI_UPDATE_TAB_MENU_STATE]: {
    handler: updateTabMenuStateForShell,
  },
  [SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_TOGGLE_ENABLED]: {
    handler: setBookmarkBarToggleEnabledForShell,
  },
  [SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_CHECKED]: {
    handler: setBookmarkBarCheckedForShell,
  },
  [SHELL_API_METHODS.CLIPBOARD_COPY_TEXT]: {
    handler: copyTextForShell,
  },
  [SHELL_API_METHODS.CLIPBOARD_COPY_IMAGE_FROM_URL]: {
    handler: copyImageFromUrlForShell,
  },
  [SHELL_API_METHODS.DOWNLOADS_SAVE_IMAGE]: {
    handler: saveImageForShell,
  },
});

function isSurfaceMethod(method) {
  return (
    method === SHELL_API_METHODS.SURFACES_GET_STATE ||
    method === SHELL_API_METHODS.SURFACES_OPEN ||
    method === SHELL_API_METHODS.SURFACES_CLOSE ||
    method === SHELL_API_METHODS.SURFACES_TOGGLE
  );
}

function getRequiredCapabilityForShellMethod(method, args = []) {
  if (isSurfaceMethod(method)) {
    return getSurfaceControlCapability(getSurfaceName(args[0])) || getRequiredCapabilityForMethod(method);
  }
  return getRequiredCapabilityForMethod(method);
}

function getRequiredCapabilityForShellEvent(eventName, data = {}) {
  if (eventName === SHELL_API_EVENTS.SURFACES_STATE_CHANGED) {
    return getSurfaceControlCapability(getSurfaceName(data)) || getRequiredCapabilityForEvent(eventName);
  }
  return getRequiredCapabilityForEvent(eventName);
}

function assertMethodCapability(caller, method, args = []) {
  const requiredCapability = getRequiredCapabilityForShellMethod(method, args);
  if (!requiredCapability) {
    throw createShellApiError('SHELL_METHOD_UNSUPPORTED', `Unsupported shell API method: ${method}`);
  }
  if (!caller.capabilities.has(requiredCapability)) {
    throw createShellApiError(
      'SHELL_CAPABILITY_DENIED',
      `Shell API method requires capability: ${requiredCapability}`,
      {
        method,
        requiredCapability,
        caller: describePackageCaller(caller.identity),
      }
    );
  }
}

function emitShellEvent(event, caller, eventName, data) {
  const requiredCapability = getRequiredCapabilityForShellEvent(eventName, data);
  if (!requiredCapability || !caller.capabilities.has(requiredCapability)) {
    return;
  }

  event?.sender?.send?.(IPC.SHELL_EVENT, {
    event: eventName,
    data: cloneShellApiValue(data),
  });
}

function emitShellEventToPackageWebContents(sender, eventName, data = {}) {
  if (!sender || typeof sender !== 'object') {
    return { delivered: false, reason: 'missing-sender' };
  }

  const caller = packageCallers.get(sender);
  if (!caller) {
    return { delivered: false, reason: 'not-package' };
  }

  const requiredCapability = getRequiredCapabilityForShellEvent(eventName, data);
  if (!requiredCapability) {
    return { delivered: false, reason: 'unsupported-event' };
  }

  if (!caller.capabilities.has(requiredCapability)) {
    return {
      delivered: false,
      reason: 'capability-denied',
      requiredCapability,
    };
  }

  sender.send?.(IPC.SHELL_EVENT, {
    event: eventName,
    data: cloneShellApiValue(data),
  });
  return { delivered: true };
}

async function handleShellRequest(event, payload = {}) {
  if (!payload || typeof payload !== 'object') {
    throw createShellApiError('SHELL_PAYLOAD_INVALID', 'Shell API payload must be an object');
  }

  const method = payload?.method;
  if (typeof method !== 'string' || !method) {
    throw createShellApiError('SHELL_METHOD_INVALID', 'Shell API method must be a string');
  }
  if (!Object.prototype.hasOwnProperty.call(METHODS, method)) {
    throw createShellApiError('SHELL_METHOD_UNSUPPORTED', `Unsupported shell API method: ${method}`);
  }
  if (!Array.isArray(payload?.args)) {
    throw createShellApiError('SHELL_ARGS_INVALID', 'Shell API args must be an array');
  }

  const caller = getPackageCaller(event);
  assertMethodCapability(caller, method, payload.args);

  const result = cloneShellApiValue(await METHODS[method].handler(payload.args, event, caller));
  if (TAB_COMMAND_METHODS.has(method)) {
    emitShellEvent(event, caller, SHELL_API_EVENTS.TABS_COMMAND_RESULT, result);
    if (result?.snapshotChanged === true && result.snapshot) {
      emitShellEvent(event, caller, SHELL_API_EVENTS.TABS_SNAPSHOT_CHANGED, result.snapshot);
    }
  }
  return result;
}

function registerShellApiIpc(options = {}) {
  configureShellCommandHandlers(options);
  const targetIpcMain = options.ipcMain || ipcMain;
  targetIpcMain.handle(IPC.SHELL_REQUEST, handleShellRequest);
}

module.exports = {
  configureShellCommandHandlers,
  createShellApiError,
  cloneShellApiValue,
  createPackageCallerIdentity,
  describeChromePackage,
  describePackageCaller,
  emitShellEventToPackageWebContents,
  getInfo,
  getPackageWebContentsIdentity,
  handleShellRequest,
  isPackageWebContents,
  markReady,
  onPackageReady,
  registerPackageWebContents,
  registerShellApiIpc,
  serializeProfileForShell,
  setSurfaceOpenForPackageWebContents,
};
