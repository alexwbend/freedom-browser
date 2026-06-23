const { EventEmitter } = require('events');
const { app, ipcMain } = require('electron');
const IPC = require('../shared/ipc-channels');
const { version: packageVersion } = require('../../package.json');
const { getActiveChromePackage } = require('./chrome-package');
const { resolveNavigationInput } = require('../shared/navigation-input');
const { createShellTabRegistry } = require('./shell-tabs');
const { defaultTrustedPromptBroker } = require('./trusted-prompt-broker');
const {
  SHELL_API_EVENTS,
  SHELL_API_METHODS,
  SHELL_API_VERSION,
  getRequiredCapabilityForEvent,
  getRequiredCapabilityForMethod,
} = require('../shared/shell-api-policy');

const shellEvents = new EventEmitter();
const packageCallers = new WeakMap();
const TAB_COMMAND_METHODS = new Set([
  SHELL_API_METHODS.TABS_CREATE,
  SHELL_API_METHODS.TABS_CLOSE,
  SHELL_API_METHODS.TABS_ACTIVATE,
  SHELL_API_METHODS.TABS_NAVIGATE,
  SHELL_API_METHODS.TABS_RELOAD,
  SHELL_API_METHODS.TABS_GO_HOME,
]);
const SUPPORTED_SURFACES = new Set(['wallet']);
const SURFACE_CAPABILITIES = Object.freeze(['open', 'close', 'toggle']);
const SURFACE_MODE = 'shell-owned-placeholder';
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

function describeChromePackage(chromePackage = getActiveChromePackage()) {
  return {
    runtimeMode: chromePackage.runtimeMode,
    source: chromePackage.source,
    packageId: chromePackage.packageId,
    packageType: chromePackage.packageType,
    name: chromePackage.name,
    version: chromePackage.version,
    capabilities: [...(chromePackage.capabilities || [])],
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
  return require('./settings-store').loadSettings();
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

function getCachedFaviconForShell(url) {
  if (typeof url !== 'string' || !url.trim()) {
    return null;
  }
  return require('./favicons').getCachedFavicon(url.trim());
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

function describeSurfaceState(caller, surface) {
  if (!SUPPORTED_SURFACES.has(surface)) {
    return {
      ok: false,
      surface,
      owner: 'shell',
      mode: SURFACE_MODE,
      trusted: true,
      error: {
        code: 'SURFACE_UNSUPPORTED',
        message: 'Unsupported shell surface',
      },
    };
  }

  return {
    ok: true,
    surface,
    open: caller.surfaces.get(surface) === true,
    owner: 'shell',
    mode: SURFACE_MODE,
    trusted: true,
    capabilities: [...SURFACE_CAPABILITIES],
  };
}

function setSurfaceOpen(caller, payload, open) {
  const surface = getSurfaceName(payload);
  if (!SUPPORTED_SURFACES.has(surface)) {
    return describeSurfaceState(caller, surface);
  }

  caller.surfaces.set(surface, open);
  return describeSurfaceState(caller, surface);
}

function toggleSurfaceOpen(caller, payload) {
  const surface = getSurfaceName(payload);
  if (!SUPPORTED_SURFACES.has(surface)) {
    return describeSurfaceState(caller, surface);
  }

  caller.surfaces.set(surface, caller.surfaces.get(surface) !== true);
  return describeSurfaceState(caller, surface);
}

function requestTestTrustedPromptForShell(payload, caller) {
  return defaultTrustedPromptBroker.requestTestPrompt(payload, {
    caller: caller.identity,
  });
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
    surfaces: options.surfaces || new Map([['wallet', false]]),
  };
  packageCallers.set(sender, caller);

  return () => {
    packageCallers.delete(sender);
  };
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

const METHODS = Object.freeze({
  [SHELL_API_METHODS.GET_INFO]: {
    handler: (_args, _event, caller) => getInfo(caller.identity),
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
  [SHELL_API_METHODS.BROWSER_STATE_FAVICONS_GET_CACHED]: {
    handler: ([url]) => getCachedFaviconForShell(url),
  },
  [SHELL_API_METHODS.SURFACES_GET_STATE]: {
    handler: ([payload], _event, caller) => describeSurfaceState(caller, getSurfaceName(payload)),
  },
  [SHELL_API_METHODS.SURFACES_OPEN]: {
    handler: ([payload], _event, caller) => setSurfaceOpen(caller, payload, true),
  },
  [SHELL_API_METHODS.SURFACES_CLOSE]: {
    handler: ([payload], _event, caller) => setSurfaceOpen(caller, payload, false),
  },
  [SHELL_API_METHODS.SURFACES_TOGGLE]: {
    handler: ([payload], _event, caller) => toggleSurfaceOpen(caller, payload),
  },
  [SHELL_API_METHODS.TRUSTED_PROMPTS_REQUEST_TEST]: {
    handler: ([payload], _event, caller) => requestTestTrustedPromptForShell(payload, caller),
  },
});

function assertMethodCapability(caller, method) {
  const requiredCapability = getRequiredCapabilityForMethod(method);
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
  const requiredCapability = getRequiredCapabilityForEvent(eventName);
  if (!requiredCapability || !caller.capabilities.has(requiredCapability)) {
    return;
  }

  event?.sender?.send?.(IPC.SHELL_EVENT, {
    event: eventName,
    data: cloneShellApiValue(data),
  });
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
  assertMethodCapability(caller, method);

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
  const targetIpcMain = options.ipcMain || ipcMain;
  targetIpcMain.handle(IPC.SHELL_REQUEST, handleShellRequest);
}

module.exports = {
  createShellApiError,
  cloneShellApiValue,
  createPackageCallerIdentity,
  describeChromePackage,
  describePackageCaller,
  getInfo,
  handleShellRequest,
  markReady,
  onPackageReady,
  registerPackageWebContents,
  registerShellApiIpc,
};
