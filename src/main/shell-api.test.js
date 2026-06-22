const IPC = require('../shared/ipc-channels');
const { version: appVersion } = require('../../package.json');
const { SHELL_API_VERSION } = require('./chrome-package');
const { createIpcMainMock, loadMainModule } = require('../../test/helpers/main-process-test-utils');

function makeSender(overrides = {}) {
  return {
    id: 42,
    isDestroyed: jest.fn(() => false),
    ...overrides,
  };
}

function makePackage(overrides = {}) {
  return {
    kind: 'local-package',
    runtimeMode: 'local-package',
    packageId: 'baby.freedom.chrome.fixture',
    packageType: 'browser-chrome',
    capabilities: ['shell.info', 'shell.ready', 'navigation.resolve'],
    ...overrides,
  };
}

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
    const sender = makeSender();
    mod.registerPackageWebContents(sender, makePackage());

    await expect(
      mod.handleShellRequest({ sender }, { method: 'resolveNavigationInput', args: ['example.com'] })
    ).resolves.toMatchObject({
      ok: true,
      kind: 'https',
      targetUrl: 'https://example.com',
    });
    await expect(
      mod.handleShellRequest({ sender }, { method: 'wallet.exportPrivateKey', args: [] })
    ).rejects.toMatchObject(
      {
        code: 'SHELL_METHOD_UNSUPPORTED',
      }
    );
  });

  test('rejects shell requests from missing, destroyed, or unauthorized senders', async () => {
    const { mod } = loadShellApi();
    const destroyedSender = makeSender({ isDestroyed: jest.fn(() => true) });
    const unauthorizedSender = makeSender({ id: 43 });

    await expect(
      mod.handleShellRequest({}, { method: 'getInfo', args: [] })
    ).rejects.toMatchObject({ code: 'SHELL_SENDER_MISSING' });
    await expect(
      mod.handleShellRequest({ sender: destroyedSender }, { method: 'getInfo', args: [] })
    ).rejects.toMatchObject({ code: 'SHELL_SENDER_DESTROYED' });
    await expect(
      mod.handleShellRequest({ sender: unauthorizedSender }, { method: 'getInfo', args: [] })
    ).rejects.toMatchObject({ code: 'SHELL_SENDER_UNAUTHORIZED' });
  });

  test('rejects malformed payloads and missing capabilities', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender();
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['shell.info'] }));

    await expect(mod.handleShellRequest({ sender }, null)).rejects.toMatchObject({
      code: 'SHELL_PAYLOAD_INVALID',
    });
    await expect(
      mod.handleShellRequest({ sender }, { method: '', args: [] })
    ).rejects.toMatchObject({ code: 'SHELL_METHOD_INVALID' });
    await expect(
      mod.handleShellRequest({ sender }, { method: 'getInfo', args: 'nope' })
    ).rejects.toMatchObject({ code: 'SHELL_ARGS_INVALID' });
    await expect(
      mod.handleShellRequest({ sender }, { method: 'resolveNavigationInput', args: ['example.com'] })
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: 'resolveNavigationInput',
        requiredCapability: 'navigation.resolve',
        packageId: 'baby.freedom.chrome.fixture',
      },
    });
  });

  test('emits package readiness for the calling webContents', async () => {
    const { mod } = loadShellApi();
    const listener = jest.fn();
    const dispose = mod.onPackageReady(listener);
    const sender = makeSender();
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['shell.ready'] }));

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
    const sender = makeSender();
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['shell.info'] }));

    mod.registerShellApiIpc({ ipcMain });

    expect(ipcMain.handle).toHaveBeenCalledWith(IPC.SHELL_REQUEST, mod.handleShellRequest);
    await expect(
      ipcMain.handlers.get(IPC.SHELL_REQUEST)({ sender }, { method: 'getInfo', args: [] })
    ).resolves.toMatchObject({
      shellApiVersion: SHELL_API_VERSION,
      runtimeMode: 'bundled',
    });
  });
});
