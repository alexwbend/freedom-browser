const IPC = require('../shared/ipc-channels');
const { version: appVersion } = require('../../package.json');
const { SHELL_API_VERSION } = require('./chrome-package');
const { createIpcMainMock, loadMainModule } = require('../../test/helpers/main-process-test-utils');

function loadShellApi(options = {}) {
  const context = loadMainModule(require.resolve('./shell-api'), {
    ipcMain: options.ipcMain,
    app: {
      getVersion: jest.fn(() => appVersion),
    },
  });

  return {
    ...context,
    chromePackage: require('./chrome-package'),
  };
}

describe('shell-api', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getInfo returns shell and active package diagnostics without file paths', () => {
    const { mod, chromePackage } = loadShellApi();
    chromePackage.setActiveChromePackage({
      kind: 'local-package',
      runtimeMode: 'local-package',
      source: 'local',
      packageRoot: '/tmp/package',
      entryPath: '/tmp/package/index.html',
      preloadPath: '/app/package-preload.js',
      packageId: 'baby.freedom.chrome.fixture',
      packageType: 'browser-chrome',
      name: 'Fixture Chrome',
      version: '0.0.1',
      capabilities: ['shell.info'],
    });

    expect(mod.getInfo()).toEqual({
      shellApiVersion: SHELL_API_VERSION,
      runtimeMode: 'local-package',
      appVersion,
      platform: process.platform,
      chromePackage: {
        runtimeMode: 'local-package',
        source: 'local',
        packageId: 'baby.freedom.chrome.fixture',
        packageType: 'browser-chrome',
        name: 'Fixture Chrome',
        version: '0.0.1',
        capabilities: ['shell.info'],
        fallback: null,
      },
    });
    expect(JSON.stringify(mod.getInfo())).not.toContain('/tmp/package');
  });

  test('handles allowed shell requests only', async () => {
    const { mod } = loadShellApi();

    await expect(
      mod.handleShellRequest({}, { method: 'resolveNavigationInput', args: ['example.com'] })
    ).resolves.toMatchObject({
      ok: true,
      kind: 'https',
      targetUrl: 'https://example.com',
    });
    await expect(mod.handleShellRequest({}, { method: 'wallet.exportPrivateKey' })).rejects.toThrow(
      'Unsupported shell API method'
    );
  });

  test('emits package readiness for the calling webContents', async () => {
    const { mod } = loadShellApi();
    const listener = jest.fn();
    const dispose = mod.onPackageReady(listener);
    const sender = { id: 42 };

    await expect(
      mod.handleShellRequest({ sender }, { method: 'markReady', args: [] })
    ).resolves.toEqual({ ok: true });
    expect(listener).toHaveBeenCalledWith({ sender });

    dispose();
    await mod.handleShellRequest({ sender }, { method: 'markReady', args: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('registers the shell request IPC handler', async () => {
    const ipcMain = createIpcMainMock();
    const { mod } = loadShellApi({ ipcMain });

    mod.registerShellApiIpc({ ipcMain });

    expect(ipcMain.handle).toHaveBeenCalledWith(IPC.SHELL_REQUEST, mod.handleShellRequest);
    await expect(
      ipcMain.handlers.get(IPC.SHELL_REQUEST)({}, { method: 'getInfo', args: [] })
    ).resolves.toMatchObject({
      shellApiVersion: SHELL_API_VERSION,
      runtimeMode: 'bundled',
    });
  });
});
