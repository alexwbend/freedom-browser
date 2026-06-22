const { EventEmitter } = require('events');
const { app, ipcMain } = require('electron');
const IPC = require('../shared/ipc-channels');
const { version: packageVersion } = require('../../package.json');
const {
  SHELL_API_VERSION,
  getActiveChromePackage,
} = require('./chrome-package');
const { resolveNavigationInput } = require('../shared/navigation-input');

const shellEvents = new EventEmitter();

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

function getInfo() {
  const chromePackage = getActiveChromePackage();
  return {
    shellApiVersion: SHELL_API_VERSION,
    runtimeMode: chromePackage.runtimeMode,
    appVersion: getAppVersion(),
    platform: process.platform,
    chromePackage: describeChromePackage(chromePackage),
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

const METHODS = Object.freeze({
  getInfo: {
    handler: () => getInfo(),
  },
  markReady: {
    handler: (_args, event) => markReady(event),
  },
  resolveNavigationInput: {
    handler: ([input]) => resolveNavigationInput(input),
  },
});

async function handleShellRequest(_event, payload = {}) {
  const method = payload?.method;
  const args = Array.isArray(payload?.args) ? payload.args : [];

  if (!Object.prototype.hasOwnProperty.call(METHODS, method)) {
    throw new Error(`Unsupported shell API method: ${method || '(missing)'}`);
  }

  return METHODS[method].handler(args, _event);
}

function registerShellApiIpc(options = {}) {
  const targetIpcMain = options.ipcMain || ipcMain;
  targetIpcMain.handle(IPC.SHELL_REQUEST, handleShellRequest);
}

module.exports = {
  describeChromePackage,
  getInfo,
  handleShellRequest,
  markReady,
  onPackageReady,
  registerShellApiIpc,
};
