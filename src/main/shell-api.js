const { app, ipcMain } = require('electron');
const IPC = require('../shared/ipc-channels');
const { version: packageVersion } = require('../../package.json');
const {
  SHELL_API_VERSION,
  getActiveChromePackage,
} = require('./chrome-package');
const { resolveNavigationInput } = require('../shared/navigation-input');

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

const METHODS = Object.freeze({
  getInfo: () => getInfo(),
  resolveNavigationInput: (input) => resolveNavigationInput(input),
});

async function handleShellRequest(_event, payload = {}) {
  const method = payload?.method;
  const args = Array.isArray(payload?.args) ? payload.args : [];

  if (!Object.prototype.hasOwnProperty.call(METHODS, method)) {
    throw new Error(`Unsupported shell API method: ${method || '(missing)'}`);
  }

  return METHODS[method](...args);
}

function registerShellApiIpc(options = {}) {
  const targetIpcMain = options.ipcMain || ipcMain;
  targetIpcMain.handle(IPC.SHELL_REQUEST, handleShellRequest);
}

module.exports = {
  describeChromePackage,
  getInfo,
  handleShellRequest,
  registerShellApiIpc,
};
