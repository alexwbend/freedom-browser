const { EventEmitter } = require('events');
const { app, ipcMain } = require('electron');
const IPC = require('../shared/ipc-channels');
const { version: packageVersion } = require('../../package.json');
const { getActiveChromePackage } = require('./chrome-package');
const { resolveNavigationInput } = require('../shared/navigation-input');
const { createShellTabRegistry } = require('./shell-tabs');
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
          error: chromePackage.fallback.error,
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

function getInfo(callerIdentity = null) {
  const chromePackage = getActiveChromePackage();
  return {
    shellApiVersion: SHELL_API_VERSION,
    runtimeMode: chromePackage.runtimeMode,
    appVersion: getAppVersion(),
    platform: process.platform,
    chromePackage: describeChromePackage(chromePackage),
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

function registerPackageWebContents(sender, chromePackage = getActiveChromePackage(), options = {}) {
  if (!sender || typeof sender !== 'object') {
    return () => {};
  }

  const identity = createPackageCallerIdentity(sender, chromePackage);
  const caller = {
    identity,
    capabilities: new Set(identity.capabilities || []),
    tabRegistry: options.tabRegistry || createShellTabRegistry(),
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
