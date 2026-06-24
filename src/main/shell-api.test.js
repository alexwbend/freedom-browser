const IPC = require('../shared/ipc-channels');
const { version: appVersion } = require('../../package.json');
const { SHELL_API_VERSION } = require('./chrome-package');
const { SHELL_API_EVENTS, SHELL_API_METHODS } = require('../shared/shell-api-policy');
const { createShellTabRegistry } = require('./shell-tabs');
const { createIpcMainMock, loadMainModule } = require('../../test/helpers/main-process-test-utils');

const mockResolveEnsContent = jest.fn();
const mockInvalidateEnsContent = jest.fn();
const mockLoadSettings = jest.fn();
const mockSavePackageSettings = jest.fn();
const mockSaveSettings = jest.fn();
const mockLoadBookmarks = jest.fn();
const mockAddBookmark = jest.fn();
const mockUpdateBookmark = jest.fn();
const mockRemoveBookmark = jest.fn();
const mockGetAllHistory = jest.fn();
const mockGetRecentHistory = jest.fn();
const mockSearchHistory = jest.fn();
const mockAddHistoryEntry = jest.fn();
const mockRemoveHistoryEntry = jest.fn();
const mockClearHistory = jest.fn();
const mockGetFavicon = jest.fn();
const mockGetCachedFavicon = jest.fn();
const mockFetchFavicon = jest.fn();
const mockGetActiveProfile = jest.fn();
const mockListProfilesForActiveApp = jest.fn();
const mockGetPackageVisibleRegistry = jest.fn();
const mockCreatePackageVisibleServiceStatus = jest.fn();
const mockAntGetStatus = jest.fn();
const mockAntCheckBinary = jest.fn();
const mockIpfsGetStatus = jest.fn();
const mockIpfsCheckBinary = jest.fn();
const mockRadicleGetStatus = jest.fn();
const mockRadicleCheckBinary = jest.fn();
const mockFetchBuffer = jest.fn();
const mockFetchToFile = jest.fn();
const mockOpenTrustedWalletSurface = jest.fn();
const mockCloseTrustedWalletSurface = jest.fn();
const mockOpenTrustedIdentitySurface = jest.fn();
const mockCloseTrustedIdentitySurface = jest.fn();
const mockOpenTrustedPaymentsSurface = jest.fn();
const mockCloseTrustedPaymentsSurface = jest.fn();
const mockOpenTrustedSwarmPublishSurface = jest.fn();
const mockCloseTrustedSwarmPublishSurface = jest.fn();
const ORIGINAL_FREEDOM_TEST_MODE = process.env.FREEDOM_TEST_MODE;
const ENS_RESOLVER_MODULE = require.resolve('./ens-resolver');
const SETTINGS_STORE_MODULE = require.resolve('./settings-store');
const BOOKMARKS_STORE_MODULE = require.resolve('./bookmarks-store');
const HISTORY_MODULE = require.resolve('./history');
const FAVICONS_MODULE = require.resolve('./favicons');
const PROFILE_RESOLVER_MODULE = require.resolve('./profile-resolver');
const SERVICE_REGISTRY_MODULE = require.resolve('./service-registry');
const ANT_MANAGER_MODULE = require.resolve('./ant-manager');
const IPFS_MANAGER_MODULE = require.resolve('./ipfs-manager');
const RADICLE_MANAGER_MODULE = require.resolve('./radicle-manager');
const HTTP_FETCH_MODULE = require.resolve('./http-fetch');
const TRUSTED_WALLET_SURFACE_MODULE = require.resolve('./trusted-wallet-surface');
const TRUSTED_IDENTITY_SURFACE_MODULE = require.resolve('./trusted-identity-surface');
const TRUSTED_PAYMENTS_SURFACE_MODULE = require.resolve('./trusted-payments-surface');
const TRUSTED_SWARM_PUBLISH_SURFACE_MODULE = require.resolve('./trusted-swarm-publish-surface');

function makeSender(overrides = {}) {
  return {
    id: 42,
    isDestroyed: jest.fn(() => false),
    send: jest.fn(),
    ...overrides,
  };
}

function makePackage(overrides = {}) {
  return {
    kind: 'local-package',
    runtimeMode: 'local-package',
    source: 'local',
    packageId: 'baby.freedom.chrome.fixture',
    packageType: 'browser-chrome',
    name: 'Fixture Chrome',
    version: '0.0.1',
    capabilities: ['shell.info', 'shell.ready', 'navigation.resolve'],
    ...overrides,
  };
}

function loadShellApi(options = {}) {
  const context = loadMainModule(require.resolve('./shell-api'), {
    ipcMain: options.ipcMain,
    dialog: options.dialog,
    app: {
      getVersion: jest.fn(() => appVersion),
      showAboutPanel: jest.fn(),
    },
    extraMocks: {
      [ENS_RESOLVER_MODULE]: () => ({
        resolveEnsContent: mockResolveEnsContent,
        invalidateEnsContent: mockInvalidateEnsContent,
      }),
      [SETTINGS_STORE_MODULE]: () => ({
        loadSettings: mockLoadSettings,
        savePackageSettings: mockSavePackageSettings,
        saveSettings: mockSaveSettings,
      }),
      [BOOKMARKS_STORE_MODULE]: () => ({
        loadBookmarks: mockLoadBookmarks,
        addBookmark: mockAddBookmark,
        updateBookmark: mockUpdateBookmark,
        removeBookmark: mockRemoveBookmark,
      }),
      [HISTORY_MODULE]: () => ({
        getAllHistory: mockGetAllHistory,
        getRecentHistory: mockGetRecentHistory,
        searchHistory: mockSearchHistory,
        addHistoryEntry: mockAddHistoryEntry,
        removeHistoryEntry: mockRemoveHistoryEntry,
        clearHistory: mockClearHistory,
      }),
      [FAVICONS_MODULE]: () => ({
        getFavicon: mockGetFavicon,
        getCachedFavicon: mockGetCachedFavicon,
        fetchFavicon: mockFetchFavicon,
      }),
      [PROFILE_RESOLVER_MODULE]: () => ({
        getActiveProfile: mockGetActiveProfile,
        listProfilesForActiveApp: mockListProfilesForActiveApp,
      }),
      [SERVICE_REGISTRY_MODULE]: () => ({
        getPackageVisibleRegistry: mockGetPackageVisibleRegistry,
        createPackageVisibleServiceStatus: mockCreatePackageVisibleServiceStatus,
      }),
      [ANT_MANAGER_MODULE]: () => ({
        getStatus: mockAntGetStatus,
        checkBinary: mockAntCheckBinary,
      }),
      [IPFS_MANAGER_MODULE]: () => ({
        getStatus: mockIpfsGetStatus,
        checkBinary: mockIpfsCheckBinary,
      }),
      [RADICLE_MANAGER_MODULE]: () => ({
        getStatus: mockRadicleGetStatus,
        checkBinary: mockRadicleCheckBinary,
      }),
      [HTTP_FETCH_MODULE]: () => ({
        fetchBuffer: mockFetchBuffer,
        fetchToFile: mockFetchToFile,
      }),
      [TRUSTED_WALLET_SURFACE_MODULE]: () => ({
        openTrustedWalletSurface: (...args) => mockOpenTrustedWalletSurface(...args),
        closeTrustedWalletSurface: (...args) => mockCloseTrustedWalletSurface(...args),
      }),
      [TRUSTED_IDENTITY_SURFACE_MODULE]: () => ({
        openTrustedIdentitySurface: (...args) => mockOpenTrustedIdentitySurface(...args),
        closeTrustedIdentitySurface: (...args) => mockCloseTrustedIdentitySurface(...args),
      }),
      [TRUSTED_PAYMENTS_SURFACE_MODULE]: () => ({
        openTrustedPaymentsSurface: (...args) => mockOpenTrustedPaymentsSurface(...args),
        closeTrustedPaymentsSurface: (...args) => mockCloseTrustedPaymentsSurface(...args),
      }),
      [TRUSTED_SWARM_PUBLISH_SURFACE_MODULE]: () => ({
        openTrustedSwarmPublishSurface: (...args) =>
          mockOpenTrustedSwarmPublishSurface(...args),
        closeTrustedSwarmPublishSurface: (...args) =>
          mockCloseTrustedSwarmPublishSurface(...args),
      }),
      ...(options.extraMocks || {}),
    },
  });

  return {
    ...context,
    chromePackage: require('./chrome-package'),
  };
}

describe('shell-api', () => {
  afterEach(() => {
    mockResolveEnsContent.mockReset();
    mockInvalidateEnsContent.mockReset();
    mockLoadSettings.mockReset();
    mockSavePackageSettings.mockReset();
    mockSaveSettings.mockReset();
    mockLoadBookmarks.mockReset();
    mockAddBookmark.mockReset();
    mockUpdateBookmark.mockReset();
    mockRemoveBookmark.mockReset();
    mockGetAllHistory.mockReset();
    mockGetRecentHistory.mockReset();
    mockSearchHistory.mockReset();
    mockAddHistoryEntry.mockReset();
    mockRemoveHistoryEntry.mockReset();
    mockClearHistory.mockReset();
    mockGetFavicon.mockReset();
    mockGetCachedFavicon.mockReset();
    mockFetchFavicon.mockReset();
    mockGetActiveProfile.mockReset();
    mockListProfilesForActiveApp.mockReset();
    mockGetPackageVisibleRegistry.mockReset();
    mockCreatePackageVisibleServiceStatus.mockReset();
    mockAntGetStatus.mockReset();
    mockAntCheckBinary.mockReset();
    mockIpfsGetStatus.mockReset();
    mockIpfsCheckBinary.mockReset();
    mockRadicleGetStatus.mockReset();
    mockRadicleCheckBinary.mockReset();
    mockFetchBuffer.mockReset();
    mockFetchToFile.mockReset();
    mockOpenTrustedWalletSurface.mockReset();
    mockCloseTrustedWalletSurface.mockReset();
    mockOpenTrustedIdentitySurface.mockReset();
    mockCloseTrustedIdentitySurface.mockReset();
    mockOpenTrustedPaymentsSurface.mockReset();
    mockCloseTrustedPaymentsSurface.mockReset();
    mockOpenTrustedSwarmPublishSurface.mockReset();
    mockCloseTrustedSwarmPublishSurface.mockReset();
    delete globalThis.__FREEDOM_TEST_HARNESS__;
    if (ORIGINAL_FREEDOM_TEST_MODE === undefined) {
      delete process.env.FREEDOM_TEST_MODE;
    } else {
      process.env.FREEDOM_TEST_MODE = ORIGINAL_FREEDOM_TEST_MODE;
    }
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
      fallback: {
        requestedDir: '/tmp/requested-package',
        error: {
          code: 'PACKAGE_FILE_HASH_MISMATCH',
          message: "Chrome package file hash mismatch at '/tmp/package/index.html'",
          packageRoot: '/tmp/package',
          path: 'index.html',
          cause: {
            code: 'STORE_PACKAGE_INVALID',
            message: "Cached package failed validation at '/tmp/store/current.json'",
            installPath: 'packages/pkg/1.0.0/digest',
            packageRoot: '/tmp/store/packages/pkg/1.0.0/digest',
          },
        },
      },
    });

    const info = mod.getInfo();

    expect(info).toEqual({
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
        fallback: {
          error: {
            code: 'PACKAGE_FILE_HASH_MISMATCH',
            message: "Chrome package file hash mismatch at '[redacted-path]'",
            path: 'index.html',
            cause: {
              code: 'STORE_PACKAGE_INVALID',
              message: "Cached package failed validation at '[redacted-path]'",
            },
          },
        },
      },
      caller: null,
    });
    expect(info.chromePackage.fallback.error).not.toHaveProperty('packageRoot');
    expect(info.chromePackage.fallback.error.cause).not.toHaveProperty('installPath');
    expect(JSON.stringify(info)).not.toContain('/tmp/package');
    expect(JSON.stringify(info)).not.toContain('/tmp/store');
  });

  test('creates path-free package caller identity', () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 77 });

    const identity = mod.createPackageCallerIdentity(
      sender,
      makePackage({
        packageRoot: '/tmp/package',
        entryPath: '/tmp/package/index.html',
        preloadPath: '/app/package-preload.js',
      })
    );

    expect(identity).toEqual({
      webContentsId: 77,
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.fixture',
      packageType: 'browser-chrome',
      name: 'Fixture Chrome',
      version: '0.0.1',
      capabilities: ['shell.info', 'shell.ready', 'navigation.resolve'],
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.capabilities)).toBe(true);
    expect(JSON.stringify(identity)).not.toContain('/tmp/package');
  });

  test('handles allowed shell requests only', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender();
    mod.registerPackageWebContents(sender, makePackage());
    mockResolveEnsContent.mockResolvedValue({
      type: 'ok',
      name: 'vitalik.eth',
      protocol: 'ipfs',
      uri: 'ipfs://fixture',
    });
    mockInvalidateEnsContent.mockReturnValue(true);

    await expect(
      mod.handleShellRequest({ sender }, { method: 'resolveNavigationInput', args: ['example.com'] })
    ).resolves.toMatchObject({
      ok: true,
      kind: 'https',
      targetUrl: 'https://example.com',
    });
    await expect(
      mod.handleShellRequest({ sender }, { method: 'navigation.resolveEns', args: ['vitalik.eth'] })
    ).resolves.toMatchObject({
      type: 'ok',
      name: 'vitalik.eth',
      protocol: 'ipfs',
    });
    expect(mockResolveEnsContent).toHaveBeenCalledWith('vitalik.eth');

    await expect(
      mod.handleShellRequest({
        sender,
      }, {
        method: 'navigation.invalidateEnsContent',
        args: ['vitalik.eth'],
      })
    ).resolves.toBe(true);
    expect(mockInvalidateEnsContent).toHaveBeenCalledWith('vitalik.eth');

    await expect(
      mod.handleShellRequest({ sender }, { method: 'wallet.exportPrivateKey', args: [] })
    ).rejects.toMatchObject(
      {
        code: 'SHELL_METHOD_UNSUPPORTED',
      }
    );
  });

  test('routes ENS shell requests through test harness fixtures in test mode', async () => {
    process.env.FREEDOM_TEST_MODE = '1';
    const harness = {
      resolveEnsContent: jest.fn().mockReturnValue({
        type: 'ok',
        name: 'vitalik.eth',
        protocol: 'ipfs',
        uri: 'ipfs://fixture',
      }),
      invalidateEnsContent: jest.fn().mockReturnValue(true),
    };
    globalThis.__FREEDOM_TEST_HARNESS__ = harness;

    const { mod } = loadShellApi();
    const sender = makeSender();
    mod.registerPackageWebContents(sender, makePackage());

    await expect(
      mod.handleShellRequest({ sender }, { method: 'navigation.resolveEns', args: ['vitalik.eth'] })
    ).resolves.toMatchObject({
      type: 'ok',
      name: 'vitalik.eth',
      protocol: 'ipfs',
    });
    await expect(
      mod.handleShellRequest({
        sender,
      }, {
        method: 'navigation.invalidateEnsContent',
        args: ['vitalik.eth'],
      })
    ).resolves.toBe(true);

    expect(harness.resolveEnsContent).toHaveBeenCalledWith('vitalik.eth');
    expect(harness.invalidateEnsContent).toHaveBeenCalledWith('vitalik.eth');
    expect(mockResolveEnsContent).not.toHaveBeenCalled();
    expect(mockInvalidateEnsContent).not.toHaveBeenCalled();
  });

  test('getInfo reports caller package identity for shell requests', async () => {
    const { mod, chromePackage } = loadShellApi();
    const sender = makeSender({ id: 99 });
    chromePackage.setActiveChromePackage(makePackage({
      packageId: 'baby.freedom.chrome.global',
      name: 'Global Chrome',
      version: '9.9.9',
      capabilities: ['shell.info'],
    }));
    mod.registerPackageWebContents(
      sender,
      makePackage({
        packageId: 'baby.freedom.chrome.caller',
        name: 'Caller Chrome',
        version: '1.2.3',
        capabilities: ['shell.info'],
      })
    );

    await expect(
      mod.handleShellRequest({ sender }, { method: 'getInfo', args: [] })
    ).resolves.toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: {
        runtimeMode: 'local-package',
        source: 'local',
        packageId: 'baby.freedom.chrome.caller',
        packageType: 'browser-chrome',
        name: 'Caller Chrome',
        version: '1.2.3',
        capabilities: ['shell.info'],
        fallback: null,
      },
      caller: {
        runtimeMode: 'local-package',
        source: 'local',
        packageId: 'baby.freedom.chrome.caller',
        packageType: 'browser-chrome',
        name: 'Caller Chrome',
        version: '1.2.3',
        capabilities: ['shell.info'],
      },
    });
  });

  test('getInfo keeps package diagnostics scoped to each registered sender', async () => {
    const { mod, chromePackage } = loadShellApi();
    const firstSender = makeSender({ id: 201 });
    const secondSender = makeSender({ id: 202 });
    chromePackage.setActiveChromePackage(makePackage({
      packageId: 'baby.freedom.chrome.global',
      name: 'Global Chrome',
      version: '9.9.9',
      capabilities: ['shell.info'],
    }));
    mod.registerPackageWebContents(
      firstSender,
      makePackage({
        source: 'store',
        packageId: 'baby.freedom.chrome.first',
        name: 'First Chrome',
        version: '1.0.0',
        capabilities: ['shell.info'],
        packageRoot: '/tmp/first-package',
      })
    );
    mod.registerPackageWebContents(
      secondSender,
      makePackage({
        packageId: 'baby.freedom.chrome.second',
        name: 'Second Chrome',
        version: '2.0.0',
        capabilities: ['shell.info'],
        packageRoot: '/tmp/second-package',
      })
    );

    await expect(
      mod.handleShellRequest({ sender: firstSender }, { method: 'getInfo', args: [] })
    ).resolves.toMatchObject({
      chromePackage: {
        source: 'store',
        packageId: 'baby.freedom.chrome.first',
        name: 'First Chrome',
        version: '1.0.0',
      },
      caller: {
        source: 'store',
        packageId: 'baby.freedom.chrome.first',
      },
    });
    await expect(
      mod.handleShellRequest({ sender: secondSender }, { method: 'getInfo', args: [] })
    ).resolves.toMatchObject({
      chromePackage: {
        source: 'local',
        packageId: 'baby.freedom.chrome.second',
        name: 'Second Chrome',
        version: '2.0.0',
      },
      caller: {
        source: 'local',
        packageId: 'baby.freedom.chrome.second',
      },
    });

    const firstInfo = await mod.handleShellRequest(
      { sender: firstSender },
      { method: 'getInfo', args: [] }
    );
    const secondInfo = await mod.handleShellRequest(
      { sender: secondSender },
      { method: 'getInfo', args: [] }
    );
    expect(JSON.stringify(firstInfo)).not.toContain('baby.freedom.chrome.global');
    expect(JSON.stringify(secondInfo)).not.toContain('baby.freedom.chrome.global');
    expect(JSON.stringify(firstInfo)).not.toContain('/tmp/first-package');
    expect(JSON.stringify(secondInfo)).not.toContain('/tmp/second-package');
  });

  test('handles authorized tab snapshot and command requests', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 101 });
    const tabRegistry = createShellTabRegistry({ homeUrl: 'freedom://home' });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['tabs.read', 'tabs.write'] }),
      { tabRegistry }
    );

    await expect(
      mod.handleShellRequest({ sender }, { method: 'tabs.getSnapshot', args: [] })
    ).resolves.toMatchObject({
      activeTabId: 1,
      tabs: [expect.objectContaining({ id: 1, url: 'freedom://home', isActive: true })],
    });

    const createResult = await mod.handleShellRequest(
      { sender },
      { method: 'tabs.create', args: [{ url: 'https://example.com' }] }
    );
    expect(createResult).toMatchObject({
      ok: true,
      command: 'tabs.create',
      tabId: 2,
      snapshot: {
        activeTabId: 2,
      },
    });
    expect(sender.send).toHaveBeenLastCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_SNAPSHOT_CHANGED,
      data: expect.objectContaining({
        activeTabId: 2,
        tabs: expect.arrayContaining([expect.objectContaining({ id: 2 })]),
      }),
    });
    expect(sender.send).toHaveBeenNthCalledWith(1, IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_COMMAND_RESULT,
      data: expect.objectContaining({
        ok: true,
        command: 'tabs.create',
        tabId: 2,
      }),
    });

    sender.send.mockClear();
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: 'tabs.navigate', args: [{ tabId: 2, url: 'https://example.org' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      command: 'tabs.navigate',
      tabId: 2,
      url: 'https://example.org',
    });
    expect(sender.send).toHaveBeenNthCalledWith(1, IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_COMMAND_RESULT,
      data: expect.objectContaining({
        ok: true,
        command: 'tabs.navigate',
        tabId: 2,
        url: 'https://example.org',
      }),
    });
    expect(sender.send).toHaveBeenNthCalledWith(2, IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_SNAPSHOT_CHANGED,
      data: expect.objectContaining({
        tabs: expect.arrayContaining([
          expect.objectContaining({ id: 2, url: 'https://example.org' }),
        ]),
      }),
    });

    sender.send.mockClear();
    await expect(
      mod.handleShellRequest({ sender }, { method: 'tabs.close', args: [{ tabId: 999 }] })
    ).resolves.toMatchObject({
      ok: false,
      command: 'tabs.close',
      snapshotChanged: false,
      error: {
        code: 'TAB_NOT_FOUND',
      },
    });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_COMMAND_RESULT,
      data: expect.objectContaining({
        ok: false,
        command: 'tabs.close',
        snapshotChanged: false,
      }),
    });

    sender.send.mockClear();
    await expect(
      mod.handleShellRequest({ sender }, { method: 'tabs.close', args: [{ tabId: 2 }] })
    ).resolves.toMatchObject({
      ok: true,
      command: 'tabs.close',
      tabId: 2,
      snapshotChanged: true,
      snapshot: {
        activeTabId: 1,
      },
    });
    expect(sender.send).toHaveBeenNthCalledWith(1, IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_COMMAND_RESULT,
      data: expect.objectContaining({
        ok: true,
        command: 'tabs.close',
        tabId: 2,
      }),
    });
    expect(sender.send).toHaveBeenNthCalledWith(2, IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_SNAPSHOT_CHANGED,
      data: expect.objectContaining({
        activeTabId: 1,
        tabs: [expect.objectContaining({ id: 1 })],
      }),
    });
  });

  test('does not emit read-gated tab snapshot events to write-only callers', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 102 });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['tabs.write'] }), {
      tabRegistry: createShellTabRegistry({ homeUrl: 'freedom://home' }),
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: 'tabs.create', args: [{ url: 'https://example.com' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      command: 'tabs.create',
      snapshotChanged: true,
    });

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_COMMAND_RESULT,
      data: expect.objectContaining({
        ok: true,
        command: 'tabs.create',
        snapshotChanged: true,
      }),
    });
  });

  test('emits package shell events only to registered capable package callers', () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 1021 });

    expect(mod.isPackageWebContents(sender)).toBe(false);
    expect(
      mod.emitShellEventToPackageWebContents(
        sender,
        SHELL_API_EVENTS.CHROME_FOCUS_ADDRESS_BAR_REQUESTED
      )
    ).toEqual({
      delivered: false,
      reason: 'not-package',
    });
    expect(sender.send).not.toHaveBeenCalled();

    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['shell.info', 'chrome.ui.commands'] })
    );
    expect(mod.isPackageWebContents(sender)).toBe(true);

    expect(
      mod.emitShellEventToPackageWebContents(
        sender,
        SHELL_API_EVENTS.CHROME_FOCUS_ADDRESS_BAR_REQUESTED
      )
    ).toEqual({ delivered: true });
    expect(sender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.CHROME_FOCUS_ADDRESS_BAR_REQUESTED,
      data: {},
    });

    sender.send.mockClear();
    expect(
      mod.emitShellEventToPackageWebContents(
        sender,
        SHELL_API_EVENTS.TABS_SNAPSHOT_CHANGED,
        { activeTabId: 1 }
      )
    ).toEqual({
      delivered: false,
      reason: 'capability-denied',
      requiredCapability: 'tabs.read',
    });
    expect(sender.send).not.toHaveBeenCalled();

    expect(mod.emitShellEventToPackageWebContents(sender, 'unknown.event')).toEqual({
      delivered: false,
      reason: 'unsupported-event',
    });
  });

  test('handles capability-gated browser state requests', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 103 });
    mod.registerPackageWebContents(
      sender,
      makePackage({
        capabilities: [
          'browserState.settings.read',
          'browserState.settings.write',
          'browserState.bookmarks.read',
          'browserState.bookmarks.write',
          'browserState.history.read',
          'browserState.history.write',
          'browserState.favicons.read',
          'browserState.favicons.write',
          'browserState.profiles.read',
        ],
      })
    );
    const settings = {
      theme: 'system',
      showBookmarkBar: true,
      enableIdentityWallet: true,
    };
    mockLoadSettings.mockReturnValue(settings);
    mockSavePackageSettings.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mockLoadBookmarks.mockReturnValue([{ label: 'Example', target: 'https://example.com' }]);
    mockAddBookmark.mockReturnValue(true);
    mockUpdateBookmark.mockReturnValue(true);
    mockRemoveBookmark.mockReturnValue(true);
    mockGetAllHistory.mockReturnValue([{ url: 'https://history.example', title: 'History' }]);
    mockGetRecentHistory.mockReturnValue([
      { url: 'https://recent.example', title: 'Recent' },
    ]);
    mockSearchHistory.mockReturnValue([{ url: 'https://search.example', title: 'Search' }]);
    mockAddHistoryEntry.mockReturnValue({
      url: 'https://added-history.example',
      title: 'Added History',
      protocol: 'https',
    });
    mockRemoveHistoryEntry.mockReturnValue(true);
    mockClearHistory.mockReturnValue(2);
    mockGetFavicon.mockResolvedValue('data:image/png;base64,Z2V0');
    mockGetCachedFavicon.mockReturnValue('data:image/png;base64,ZmF2');
    mockFetchFavicon
      .mockResolvedValueOnce('data:image/png;base64,ZmV0Y2g')
      .mockResolvedValueOnce('data:image/png;base64,a2V5');
    mockGetActiveProfile.mockReturnValue({
      id: 'test',
      displayName: 'Test',
      source: 'test-user-data',
      isDev: true,
      appRoot: '/tmp/private-app-root',
      userDataDir: '/tmp/private-user-data',
      metadata: {
        slot: 1,
        nodes: {
          bee: { mode: 'managed' },
        },
      },
    });
    mockListProfilesForActiveApp.mockReturnValue([
      {
        id: 'test',
        displayName: 'Test',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        nodes: {
          bee: { mode: 'managed' },
        },
      },
      {
        id: 'work',
        displayName: 'Work',
        isActive: false,
        isUnregistered: true,
        lastOpenedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    const settingsResult = await mod.handleShellRequest(
      { sender },
      { method: SHELL_API_METHODS.BROWSER_STATE_SETTINGS_GET, args: [] }
    );
    expect(settingsResult).toEqual({
      theme: 'system',
      showBookmarkBar: true,
      enableIdentityWallet: true,
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_SETTINGS_SAVE,
          args: [
            {
              theme: 'light',
              showBookmarkBar: false,
              blockUnverifiedEns: false,
              sidebarOpen: true,
              sidebarWidth: 375.8,
              enableIdentityWallet: false,
              startAntAtLaunch: false,
              injected: 'ignored',
            },
          ],
        }
      )
    ).resolves.toBe(true);
    expect(mockSavePackageSettings).toHaveBeenCalledWith({
      theme: 'light',
      showBookmarkBar: false,
      blockUnverifiedEns: false,
      sidebarOpen: true,
      sidebarWidth: 375.8,
      enableIdentityWallet: false,
      startAntAtLaunch: false,
      injected: 'ignored',
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_SETTINGS_SAVE,
          args: [{ theme: 'sepia', enableIdentityWallet: false }],
        }
      )
    ).resolves.toBe(false);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_GET, args: [] }
      )
    ).resolves.toEqual([{ label: 'Example', target: 'https://example.com' }]);
    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_ADD,
          args: [{ label: ' Added ', target: ' https://added.example ' }],
        }
      )
    ).resolves.toBe(true);
    expect(mockAddBookmark).toHaveBeenCalledWith({
      label: 'Added',
      target: 'https://added.example',
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_UPDATE,
          args: [
            {
              originalTarget: ' https://example.com ',
              bookmark: { label: 'Updated', target: 'https://updated.example' },
            },
          ],
        }
      )
    ).resolves.toBe(true);
    expect(mockUpdateBookmark).toHaveBeenCalledWith('https://example.com', {
      label: 'Updated',
      target: 'https://updated.example',
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_REMOVE,
          args: [{ target: ' https://updated.example ' }],
        }
      )
    ).resolves.toBe(true);
    expect(mockRemoveBookmark).toHaveBeenCalledWith('https://updated.example');

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_GET, args: [{ limit: 3 }] }
      )
    ).resolves.toEqual([{ url: 'https://recent.example', title: 'Recent' }]);
    expect(mockGetRecentHistory).toHaveBeenCalledWith(3);

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_GET,
          args: [{ query: ' Search ', limit: 999 }],
        }
      )
    ).resolves.toEqual([{ url: 'https://search.example', title: 'Search' }]);
    expect(mockSearchHistory).toHaveBeenCalledWith('Search', 500);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_GET, args: [] }
      )
    ).resolves.toEqual([{ url: 'https://history.example', title: 'History' }]);

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_ADD,
          args: [{ url: ' https://added-history.example ', title: 'Added History' }],
        }
      )
    ).resolves.toEqual({
      url: 'https://added-history.example',
      title: 'Added History',
      protocol: 'https',
    });
    expect(mockAddHistoryEntry).toHaveBeenCalledWith({
      url: 'https://added-history.example',
      title: 'Added History',
      protocol: 'unknown',
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_REMOVE, args: [{ id: 7 }] }
      )
    ).resolves.toBe(true);
    expect(mockRemoveHistoryEntry).toHaveBeenCalledWith(7);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_CLEAR, args: [] }
      )
    ).resolves.toBe(2);
    expect(mockClearHistory).toHaveBeenCalledTimes(1);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_FAVICONS_GET, args: [' https://favicon.example '] }
      )
    ).resolves.toBe('data:image/png;base64,Z2V0');
    expect(mockGetFavicon).toHaveBeenCalledWith('https://favicon.example');

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_FAVICONS_GET_CACHED,
          args: [' https://favicon.example '],
        }
      )
    ).resolves.toBe('data:image/png;base64,ZmF2');
    expect(mockGetCachedFavicon).toHaveBeenCalledWith('https://favicon.example');

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_FAVICONS_FETCH,
          args: [' https://favicon.example/page '],
        }
      )
    ).resolves.toBe('data:image/png;base64,ZmV0Y2g');
    expect(mockFetchFavicon).toHaveBeenCalledWith('https://favicon.example/page');

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_FAVICONS_FETCH_WITH_KEY,
          args: [
            {
              fetchUrl: ' https://gateway.example/ipfs/cid/index.html ',
              cacheKey: ' ipfs://cid/index.html ',
            },
          ],
        }
      )
    ).resolves.toBe('data:image/png;base64,a2V5');
    expect(mockFetchFavicon).toHaveBeenLastCalledWith(
      'https://gateway.example/ipfs/cid/index.html',
      'ipfs://cid/index.html'
    );

    const activeProfile = await mod.handleShellRequest(
      { sender },
      { method: SHELL_API_METHODS.BROWSER_STATE_PROFILES_GET_ACTIVE, args: [] }
    );
    expect(activeProfile).toEqual({
      id: 'test',
      displayName: 'Test',
      source: 'test-user-data',
      isDev: true,
      isActive: true,
    });
    expect(JSON.stringify(activeProfile)).not.toContain('/tmp/private');
    expect(activeProfile).not.toHaveProperty('metadata');
    expect(activeProfile).not.toHaveProperty('nodes');

    const profileList = await mod.handleShellRequest(
      { sender },
      { method: SHELL_API_METHODS.BROWSER_STATE_PROFILES_LIST, args: [] }
    );
    expect(profileList).toEqual({
      success: true,
      profiles: [
        {
          id: 'test',
          displayName: 'Test',
          isDev: false,
          isActive: true,
        },
        {
          id: 'work',
          displayName: 'Work',
          isDev: false,
          isUnregistered: true,
        },
      ],
    });
    expect(JSON.stringify(profileList)).not.toContain('createdAt');
    expect(JSON.stringify(profileList)).not.toContain('lastOpenedAt');
    expect(JSON.stringify(profileList)).not.toContain('nodes');

    settings.theme = 'mutated';
    expect(settingsResult.theme).toBe('system');
  });

  test('rejects browser state requests without declared capabilities', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 104 });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['shell.info'] }));

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_GET, args: [] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_GET,
        requiredCapability: 'browserState.bookmarks.read',
      },
    });
    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_SETTINGS_SAVE,
          args: [{ showBookmarkBar: true }],
        }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.BROWSER_STATE_SETTINGS_SAVE,
        requiredCapability: 'browserState.settings.write',
      },
    });
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_GET, args: [] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_GET,
        requiredCapability: 'browserState.history.read',
      },
    });
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_PROFILES_GET_ACTIVE, args: [] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.BROWSER_STATE_PROFILES_GET_ACTIVE,
        requiredCapability: 'browserState.profiles.read',
      },
    });
  });

  test('handles capability-gated read-only service requests without exposing endpoints', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 1051 });
    mod.registerPackageWebContents(
      sender,
      makePackage({
        capabilities: ['services.read'],
      })
    );
    mockGetPackageVisibleRegistry.mockReturnValue({
      ant: {
        mode: 'bundled',
        statusMessage: 'Node: Ant',
        tempMessage: null,
      },
      ipfs: {
        mode: 'bundled',
        statusMessage: 'Node: freedom-ipfs',
        tempMessage: null,
      },
      radicle: {
        mode: 'none',
        statusMessage: null,
        tempMessage: null,
      },
    });
    mockAntGetStatus.mockReturnValue({
      status: 'error',
      error: 'binary not found at /tmp/private/antd',
    });
    mockCreatePackageVisibleServiceStatus.mockReturnValue({
      success: true,
      service: 'ant',
      status: 'error',
      error: 'Service error',
      controllable: false,
    });
    mockIpfsCheckBinary.mockReturnValue(true);

    const registry = await mod.handleShellRequest(
      { sender },
      { method: SHELL_API_METHODS.SERVICES_GET_REGISTRY, args: [] }
    );
    expect(registry).toEqual({
      ant: {
        mode: 'bundled',
        statusMessage: 'Node: Ant',
        tempMessage: null,
      },
      ipfs: {
        mode: 'bundled',
        statusMessage: 'Node: freedom-ipfs',
        tempMessage: null,
      },
      radicle: {
        mode: 'none',
        statusMessage: null,
        tempMessage: null,
      },
    });
    expect(JSON.stringify(registry)).not.toContain('127.0.0.1');
    expect(JSON.stringify(registry)).not.toContain('api');
    expect(JSON.stringify(registry)).not.toContain('gateway');

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SERVICES_GET_STATUS, args: [{ service: 'ant' }] }
      )
    ).resolves.toEqual({
      success: true,
      service: 'ant',
      status: 'error',
      error: 'Service error',
      controllable: false,
    });
    expect(mockAntGetStatus).toHaveBeenCalledTimes(1);
    expect(mockCreatePackageVisibleServiceStatus).toHaveBeenCalledWith('ant', {
      status: 'error',
      error: 'binary not found at /tmp/private/antd',
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SERVICES_CHECK_BINARY, args: [{ service: 'ipfs' }] }
      )
    ).resolves.toEqual({
      success: true,
      service: 'ipfs',
      available: true,
      controllable: false,
    });
    expect(mockIpfsCheckBinary).toHaveBeenCalledTimes(1);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SERVICES_GET_STATUS, args: [{ service: 'wallet' }] }
      )
    ).resolves.toEqual({
      success: false,
      service: 'wallet',
      controllable: false,
      error: {
        code: 'SERVICE_UNSUPPORTED',
        message: 'Unsupported service',
      },
    });
  });

  test('rejects service requests without declared capabilities', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 1052 });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['shell.info'] }));

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SERVICES_GET_REGISTRY, args: [] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.SERVICES_GET_REGISTRY,
        requiredCapability: 'services.read',
      },
    });
  });

  test('returns an active-only profile list outside profile catalog launches', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 105 });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['browserState.profiles.read'] })
    );
    mockGetActiveProfile.mockReturnValue({
      id: 'test',
      displayName: 'Test',
      source: 'test-user-data',
      isDev: true,
      userDataDir: '/tmp/private-test-user-data',
    });
    mockListProfilesForActiveApp.mockReturnValue(null);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_PROFILES_LIST, args: [] }
      )
    ).resolves.toEqual({
      success: true,
      profiles: [
        {
          id: 'test',
          displayName: 'Test',
          source: 'test-user-data',
          isDev: true,
          isActive: true,
        },
      ],
    });
  });

  test('handles capability-gated shell-owned surface requests per caller', async () => {
    mockOpenTrustedWalletSurface.mockResolvedValue({
      ok: true,
      surface: 'wallet',
      owner: 'shell',
      trusted: true,
    });
    mockCloseTrustedWalletSurface.mockReturnValue({
      ok: true,
      surface: 'wallet',
      owner: 'shell',
      trusted: true,
    });

    const { mod } = loadShellApi();
    const ownerWindow = { id: 502 };
    const firstSender = makeSender({
      id: 106,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    });
    const secondSender = makeSender({ id: 107 });
    const packageWithSurfaceControl = makePackage({
      capabilities: ['surfaces.wallet.control'],
    });
    mod.registerPackageWebContents(firstSender, packageWithSurfaceControl);
    mod.registerPackageWebContents(secondSender, packageWithSurfaceControl);

    await expect(
      mod.handleShellRequest(
        { sender: firstSender },
        { method: SHELL_API_METHODS.SURFACES_GET_STATE, args: [{ surface: 'wallet' }] }
      )
    ).resolves.toEqual({
      ok: true,
      surface: 'wallet',
      open: false,
      owner: 'shell',
      mode: 'shell-owned-trusted-window',
      trusted: true,
      capabilities: ['open', 'close', 'toggle'],
    });

    await expect(
      mod.handleShellRequest(
        { sender: firstSender },
        { method: SHELL_API_METHODS.SURFACES_OPEN, args: [{ surface: 'wallet' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'wallet',
      open: true,
      owner: 'shell',
      mode: 'shell-owned-trusted-window',
    });
    expect(mockOpenTrustedWalletSurface).toHaveBeenCalledWith({
      ownerWindow,
      caller: expect.objectContaining({
        packageId: 'baby.freedom.chrome.fixture',
      }),
      onClosed: expect.any(Function),
    });
    expect(firstSender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.SURFACES_STATE_CHANGED,
      data: expect.objectContaining({
        ok: true,
        surface: 'wallet',
        open: true,
        owner: 'shell',
        mode: 'shell-owned-trusted-window',
      }),
    });
    expect(secondSender.send).not.toHaveBeenCalled();
    firstSender.send.mockClear();

    await expect(
      mod.handleShellRequest(
        { sender: secondSender },
        { method: SHELL_API_METHODS.SURFACES_GET_STATE, args: ['wallet'] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'wallet',
      open: false,
    });
    expect(secondSender.send).not.toHaveBeenCalled();

    await expect(
      mod.handleShellRequest(
        { sender: firstSender },
        { method: SHELL_API_METHODS.SURFACES_TOGGLE, args: [{ surface: 'wallet' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'wallet',
      open: false,
    });
    expect(mockCloseTrustedWalletSurface).toHaveBeenCalledTimes(1);
    expect(firstSender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.SURFACES_STATE_CHANGED,
      data: expect.objectContaining({
        ok: true,
        surface: 'wallet',
        open: false,
      }),
    });
    firstSender.send.mockClear();

    await expect(
      mod.handleShellRequest(
        { sender: firstSender },
        { method: SHELL_API_METHODS.SURFACES_CLOSE, args: [{ surface: 'wallet' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'wallet',
      open: false,
    });
    expect(firstSender.send).not.toHaveBeenCalled();

    await expect(
      mod.handleShellRequest(
        { sender: firstSender },
        { method: SHELL_API_METHODS.SURFACES_OPEN, args: [{ surface: 'unknown' }] }
      )
    ).resolves.toEqual({
      ok: false,
      surface: 'unknown',
      owner: 'shell',
      mode: 'shell-owned-placeholder',
      trusted: true,
      error: {
        code: 'SURFACE_UNSUPPORTED',
        message: 'Unsupported shell surface',
      },
    });
  });

  test('opens the shell-owned identity surface behind a separate capability', async () => {
    mockOpenTrustedIdentitySurface.mockResolvedValue({
      ok: true,
      surface: 'identity',
      owner: 'shell',
      trusted: true,
    });
    mockCloseTrustedIdentitySurface.mockReturnValue({
      ok: true,
      surface: 'identity',
      owner: 'shell',
      trusted: true,
    });

    const { mod } = loadShellApi();
    const ownerWindow = { id: 504 };
    const sender = makeSender({
      id: 113,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['surfaces.identity.control'] })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_GET_STATE, args: [{ surface: 'identity' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'identity',
      open: false,
      owner: 'shell',
      mode: 'shell-owned-trusted-window',
      trusted: true,
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_OPEN, args: [{ surface: 'identity' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'identity',
      open: true,
      mode: 'shell-owned-trusted-window',
    });
    expect(mockOpenTrustedIdentitySurface).toHaveBeenCalledWith({
      ownerWindow,
      caller: expect.objectContaining({
        packageId: 'baby.freedom.chrome.fixture',
      }),
      onClosed: expect.any(Function),
    });
    expect(sender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.SURFACES_STATE_CHANGED,
      data: expect.objectContaining({
        surface: 'identity',
        open: true,
        mode: 'shell-owned-trusted-window',
      }),
    });

    sender.send.mockClear();
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_CLOSE, args: [{ surface: 'identity' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'identity',
      open: false,
    });
    expect(mockCloseTrustedIdentitySurface).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.SURFACES_STATE_CHANGED,
      data: expect.objectContaining({
        surface: 'identity',
        open: false,
      }),
    });
  });

  test('does not let wallet surface capability control identity surface', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 114 });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['surfaces.wallet.control'] })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_OPEN, args: [{ surface: 'identity' }] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.SURFACES_OPEN,
        requiredCapability: 'surfaces.identity.control',
      },
    });
    expect(mockOpenTrustedIdentitySurface).not.toHaveBeenCalled();
  });

  test('opens the shell-owned payments surface behind a separate capability', async () => {
    mockOpenTrustedPaymentsSurface.mockResolvedValue({
      ok: true,
      surface: 'payments',
      owner: 'shell',
      trusted: true,
    });
    mockCloseTrustedPaymentsSurface.mockReturnValue({
      ok: true,
      surface: 'payments',
      owner: 'shell',
      trusted: true,
    });

    const { mod } = loadShellApi();
    const ownerWindow = { id: 501 };
    const sender = makeSender({
      id: 109,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['surfaces.payments.control'] })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_GET_STATE, args: [{ surface: 'payments' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'payments',
      open: false,
      owner: 'shell',
      mode: 'shell-owned-trusted-window',
      trusted: true,
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_OPEN, args: [{ surface: 'payments' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'payments',
      open: true,
      mode: 'shell-owned-trusted-window',
    });
    expect(mockOpenTrustedPaymentsSurface).toHaveBeenCalledWith({
      ownerWindow,
      caller: expect.objectContaining({
        packageId: 'baby.freedom.chrome.fixture',
      }),
      onClosed: expect.any(Function),
    });
    expect(sender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.SURFACES_STATE_CHANGED,
      data: expect.objectContaining({
        surface: 'payments',
        open: true,
        mode: 'shell-owned-trusted-window',
      }),
    });

    sender.send.mockClear();
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_CLOSE, args: [{ surface: 'payments' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'payments',
      open: false,
    });
    expect(mockCloseTrustedPaymentsSurface).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.SURFACES_STATE_CHANGED,
      data: expect.objectContaining({
        surface: 'payments',
        open: false,
      }),
    });
  });

  test('does not let wallet surface capability control payments surface', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 110 });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['surfaces.wallet.control'] })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_OPEN, args: [{ surface: 'payments' }] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.SURFACES_OPEN,
        requiredCapability: 'surfaces.payments.control',
      },
    });
    expect(mockOpenTrustedPaymentsSurface).not.toHaveBeenCalled();
  });

  test('opens the shell-owned Swarm publish surface behind a separate capability', async () => {
    mockOpenTrustedSwarmPublishSurface.mockResolvedValue({
      ok: true,
      surface: 'swarmPublish',
      owner: 'shell',
      trusted: true,
    });
    mockCloseTrustedSwarmPublishSurface.mockReturnValue({
      ok: true,
      surface: 'swarmPublish',
      owner: 'shell',
      trusted: true,
    });

    const { mod } = loadShellApi();
    const ownerWindow = { id: 503 };
    const sender = makeSender({
      id: 111,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['surfaces.swarmPublish.control'] })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_GET_STATE, args: [{ surface: 'swarmPublish' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'swarmPublish',
      open: false,
      owner: 'shell',
      mode: 'shell-owned-trusted-window',
      trusted: true,
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_OPEN, args: [{ surface: 'swarmPublish' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'swarmPublish',
      open: true,
      mode: 'shell-owned-trusted-window',
    });
    expect(mockOpenTrustedSwarmPublishSurface).toHaveBeenCalledWith({
      ownerWindow,
      hostWebContents: sender,
      caller: expect.objectContaining({
        packageId: 'baby.freedom.chrome.fixture',
      }),
      onClosed: expect.any(Function),
    });
    expect(sender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.SURFACES_STATE_CHANGED,
      data: expect.objectContaining({
        surface: 'swarmPublish',
        open: true,
        mode: 'shell-owned-trusted-window',
      }),
    });

    sender.send.mockClear();
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_CLOSE, args: [{ surface: 'swarmPublish' }] }
      )
    ).resolves.toMatchObject({
      ok: true,
      surface: 'swarmPublish',
      open: false,
    });
    expect(mockCloseTrustedSwarmPublishSurface).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.SURFACES_STATE_CHANGED,
      data: expect.objectContaining({
        surface: 'swarmPublish',
        open: false,
      }),
    });
  });

  test('does not let payments surface capability control Swarm publish surface', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 112 });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['surfaces.payments.control'] })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_OPEN, args: [{ surface: 'swarmPublish' }] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.SURFACES_OPEN,
        requiredCapability: 'surfaces.swarmPublish.control',
      },
    });
    expect(mockOpenTrustedSwarmPublishSurface).not.toHaveBeenCalled();
  });

  test('rejects shell-owned surface requests without declared capabilities', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 108 });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['shell.info'] }));

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.SURFACES_TOGGLE, args: [{ surface: 'wallet' }] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.SURFACES_TOGGLE,
        requiredCapability: 'surfaces.wallet.control',
      },
    });
  });

  test('routes test trusted prompt requests through main-derived caller context', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 109 });
    mod.registerPackageWebContents(
      sender,
      makePackage({
        capabilities: ['trustedPrompts.test'],
      })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.TRUSTED_PROMPTS_REQUEST_TEST,
          args: [
            {
              kind: 'test.confirmation',
              reason: ' Prompt from package chrome ',
              origin: 'https://spoofed.example',
              tabId: 999,
            },
          ],
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      kind: 'test.confirmation',
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'trusted-prompt-broker',
      context: {
        source: 'main',
        origin: null,
        tabId: null,
        caller: {
          packageId: 'baby.freedom.chrome.fixture',
          packageType: 'browser-chrome',
          name: 'Fixture Chrome',
          version: '0.0.1',
        },
      },
      request: {
        reason: 'Prompt from package chrome',
      },
      result: {
        outcome: 'accepted',
        source: 'test-only-broker',
      },
    });
  });

  test('routes test trusted prompts through a shell-owned native dialog', async () => {
    const ownerWindow = { id: 777 };
    const dialog = {
      showErrorBox: jest.fn(),
      showMessageBox: jest.fn().mockResolvedValue({ response: 0 }),
      showSaveDialog: jest.fn(),
    };
    const { mod } = loadShellApi({ dialog });
    const sender = makeSender({
      id: 1091,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    });
    mod.registerPackageWebContents(
      sender,
      makePackage({
        capabilities: ['trustedPrompts.test'],
      })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.TRUSTED_PROMPTS_REQUEST_TEST,
          args: [
            {
              kind: 'test.confirmation',
              reason: ' Native prompt from package chrome ',
              presentation: 'native-dialog',
              origin: 'https://spoofed.example',
              tabId: 42,
            },
          ],
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      kind: 'test.confirmation',
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'shell-native-dialog',
      context: {
        source: 'main',
        origin: null,
        tabId: null,
        caller: {
          packageId: 'baby.freedom.chrome.fixture',
          packageType: 'browser-chrome',
        },
      },
      request: {
        reason: 'Native prompt from package chrome',
        presentation: 'native-dialog',
      },
      result: {
        outcome: 'accepted',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(sender.getOwnerBrowserWindow).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBox).toHaveBeenCalledWith(ownerWindow, {
      type: 'info',
      title: 'Freedom Trusted Prompt',
      message: 'Freedom trusted prompt',
      detail: 'Native prompt from package chrome',
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
  });

  test('rejects trusted prompt requests without declared capabilities', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 110 });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['shell.info'] }));

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.TRUSTED_PROMPTS_REQUEST_TEST,
          args: [{ kind: 'test.confirmation' }],
        }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.TRUSTED_PROMPTS_REQUEST_TEST,
        requiredCapability: 'trustedPrompts.test',
      },
    });
  });

  test('handles capability-gated window control requests for the owner window', async () => {
    const { mod } = loadShellApi();
    let maximized = false;
    let fullScreen = false;
    const ownerWindow = {
      isDestroyed: jest.fn(() => false),
      isMinimized: jest.fn(() => false),
      isMaximized: jest.fn(() => maximized),
      maximize: jest.fn(() => {
        maximized = true;
      }),
      unmaximize: jest.fn(() => {
        maximized = false;
      }),
      isFullScreen: jest.fn(() => fullScreen),
      setFullScreen: jest.fn((value) => {
        fullScreen = value;
      }),
      setTitle: jest.fn(),
      close: jest.fn(),
      minimize: jest.fn(),
    };
    const sender = makeSender({
      id: 111,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['windows.control'] }));

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.WINDOWS_SET_TITLE, args: [' Loaded Title '] }
      )
    ).resolves.toMatchObject({
      ok: true,
      command: SHELL_API_METHODS.WINDOWS_SET_TITLE,
      owner: 'shell',
      title: 'Loaded Title - Freedom',
      state: {
        maximized: false,
        fullScreen: false,
      },
    });
    expect(ownerWindow.setTitle).toHaveBeenCalledWith('Loaded Title - Freedom');

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.WINDOWS_TOGGLE_MAXIMIZE, args: [] }
      )
    ).resolves.toMatchObject({
      ok: true,
      command: SHELL_API_METHODS.WINDOWS_TOGGLE_MAXIMIZE,
      maximized: true,
      state: {
        maximized: true,
      },
    });
    expect(ownerWindow.maximize).toHaveBeenCalledTimes(1);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.WINDOWS_TOGGLE_MAXIMIZE, args: [] }
      )
    ).resolves.toMatchObject({
      ok: true,
      command: SHELL_API_METHODS.WINDOWS_TOGGLE_MAXIMIZE,
      maximized: false,
      state: {
        maximized: false,
      },
    });
    expect(ownerWindow.unmaximize).toHaveBeenCalledTimes(1);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.WINDOWS_TOGGLE_FULLSCREEN, args: [] }
      )
    ).resolves.toMatchObject({
      ok: true,
      command: SHELL_API_METHODS.WINDOWS_TOGGLE_FULLSCREEN,
      fullScreen: true,
      state: {
        fullScreen: true,
      },
    });
    expect(ownerWindow.setFullScreen).toHaveBeenCalledWith(true);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.WINDOWS_MINIMIZE, args: [] }
      )
    ).resolves.toMatchObject({
      ok: true,
      command: SHELL_API_METHODS.WINDOWS_MINIMIZE,
    });
    expect(ownerWindow.minimize).toHaveBeenCalledTimes(1);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.WINDOWS_CLOSE, args: [] }
      )
    ).resolves.toMatchObject({
      ok: true,
      command: SHELL_API_METHODS.WINDOWS_CLOSE,
    });
    expect(ownerWindow.close).toHaveBeenCalledTimes(1);
  });

  test('handles capability-gated shell-owned system menu commands', async () => {
    const onNewWindow = jest.fn();
    const onCheckForUpdates = jest.fn();
    const onRestartAndInstallUpdate = jest.fn();
    const { app, mod } = loadShellApi();
    const sender = makeSender({ id: 114 });
    mod.configureShellCommandHandlers({
      onNewWindow,
      onCheckForUpdates,
      onRestartAndInstallUpdate,
    });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['windows.open', 'app.about', 'app.updates'] })
    );

    await expect(
      mod.handleShellRequest({ sender }, { method: SHELL_API_METHODS.WINDOWS_NEW, args: [] })
    ).resolves.toEqual({
      ok: true,
      command: SHELL_API_METHODS.WINDOWS_NEW,
      owner: 'shell',
      targetUrl: null,
    });
    expect(onNewWindow).toHaveBeenCalledWith(null);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.WINDOWS_OPEN_URL, args: [' https://example.com/path '] }
      )
    ).resolves.toEqual({
      ok: true,
      command: SHELL_API_METHODS.WINDOWS_OPEN_URL,
      owner: 'shell',
      targetUrl: 'https://example.com/path',
    });
    expect(onNewWindow).toHaveBeenLastCalledWith('https://example.com/path');

    await expect(
      mod.handleShellRequest({ sender }, { method: SHELL_API_METHODS.APP_SHOW_ABOUT, args: [] })
    ).resolves.toEqual({
      ok: true,
      command: SHELL_API_METHODS.APP_SHOW_ABOUT,
      owner: 'shell',
    });
    expect(app.showAboutPanel).toHaveBeenCalledTimes(1);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.APP_CHECK_FOR_UPDATES, args: [] }
      )
    ).resolves.toEqual({
      ok: true,
      command: SHELL_API_METHODS.APP_CHECK_FOR_UPDATES,
      owner: 'shell',
    });
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.APP_RESTART_AND_INSTALL_UPDATE, args: [] }
      )
    ).resolves.toEqual({
      ok: true,
      command: SHELL_API_METHODS.APP_RESTART_AND_INSTALL_UPDATE,
      owner: 'shell',
    });
    expect(onRestartAndInstallUpdate).toHaveBeenCalledTimes(1);
  });

  test('handles capability-gated page context menu clipboard and image actions', async () => {
    const ownerWindow = { id: 1 };
    const { clipboard, dialog, mod, nativeImage } = loadShellApi();
    const sender = makeSender({
      id: 116,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['clipboard.write', 'downloads.saveImage'] })
    );
    mockFetchBuffer.mockResolvedValue(Buffer.from('image-bytes'));
    mockFetchToFile.mockResolvedValue(undefined);
    dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/private-logo.png',
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.CLIPBOARD_COPY_TEXT, args: ['copied text'] }
      )
    ).resolves.toEqual({ success: true });
    expect(clipboard.writeText).toHaveBeenCalledWith('copied text');

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.CLIPBOARD_COPY_IMAGE_FROM_URL,
          args: ['https://example.com/assets/logo.png'],
        }
      )
    ).resolves.toEqual({ success: true });
    expect(mockFetchBuffer).toHaveBeenCalledWith('https://example.com/assets/logo.png');
    expect(nativeImage.createFromBuffer).toHaveBeenCalledWith(Buffer.from('image-bytes'));
    expect(clipboard.writeImage).toHaveBeenCalled();

    const saveResult = await mod.handleShellRequest(
      { sender },
      {
        method: SHELL_API_METHODS.DOWNLOADS_SAVE_IMAGE,
        args: ['https://example.com/assets/logo.png'],
      }
    );
    expect(saveResult).toEqual({ success: true });
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      ownerWindow,
      expect.objectContaining({
        defaultPath: 'logo.png',
      })
    );
    expect(mockFetchToFile).toHaveBeenCalledWith(
      'https://example.com/assets/logo.png',
      '/tmp/private-logo.png'
    );
    expect(saveResult).not.toHaveProperty('filePath');

    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.DOWNLOADS_SAVE_IMAGE,
          args: ['https://example.com/assets/logo.png'],
        }
      )
    ).resolves.toEqual({ success: false, canceled: true });
  });

  test('returns structured errors for invalid page context menu actions', async () => {
    const { mod, nativeImage } = loadShellApi();
    const sender = makeSender({ id: 1161 });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['clipboard.write', 'downloads.saveImage'] })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.CLIPBOARD_COPY_TEXT, args: [''] }
      )
    ).resolves.toEqual({
      success: false,
      error: {
        code: 'CLIPBOARD_TEXT_MISSING',
        message: 'No text provided',
      },
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.DOWNLOADS_SAVE_IMAGE, args: [''] }
      )
    ).resolves.toEqual({
      success: false,
      error: {
        code: 'URL_MISSING',
        message: 'Missing URL',
      },
    });

    nativeImage.createFromBuffer.mockReturnValueOnce({ isEmpty: () => true });
    mockFetchBuffer.mockResolvedValue(Buffer.from('not-an-image'));
    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.CLIPBOARD_COPY_IMAGE_FROM_URL,
          args: ['https://example.com/empty.png'],
        }
      )
    ).resolves.toEqual({
      success: false,
      error: {
        code: 'IMAGE_DECODE_FAILED',
        message: 'Failed to create image from data',
      },
    });

    mockFetchBuffer.mockRejectedValueOnce(new Error('download failed'));
    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.CLIPBOARD_COPY_IMAGE_FROM_URL,
          args: ['https://example.com/error.png'],
        }
      )
    ).resolves.toEqual({
      success: false,
      error: {
        code: 'IMAGE_COPY_FAILED',
        message: 'download failed',
      },
    });
  });

  test('handles capability-gated package chrome UI menu state commands', async () => {
    const onUpdateTabMenuState = jest.fn(() => true);
    const onSetBookmarkBarToggleEnabled = jest.fn(() => true);
    const onSetBookmarkBarChecked = jest.fn(() => true);
    const { mod } = loadShellApi();
    const ownerWindow = { id: 1170 };
    const sender = makeSender({
      id: 117,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    });
    mod.configureShellCommandHandlers({
      onUpdateTabMenuState,
      onSetBookmarkBarToggleEnabled,
      onSetBookmarkBarChecked,
    });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['chrome.ui.commands'] })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.CHROME_UI_UPDATE_TAB_MENU_STATE,
          args: [{ tabCount: 2.7, activeIndex: 8, hasClosedTabs: true }],
        }
      )
    ).resolves.toEqual({
      ok: true,
      command: SHELL_API_METHODS.CHROME_UI_UPDATE_TAB_MENU_STATE,
      owner: 'shell',
    });
    expect(onUpdateTabMenuState).toHaveBeenCalledWith(
      {
        tabCount: 2,
        activeIndex: 1,
        hasClosedTabs: true,
      },
      ownerWindow
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_TOGGLE_ENABLED,
          args: [0],
        }
      )
    ).resolves.toEqual({
      ok: true,
      command: SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_TOGGLE_ENABLED,
      owner: 'shell',
    });
    expect(onSetBookmarkBarToggleEnabled).toHaveBeenCalledWith(false, ownerWindow);

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_CHECKED, args: ['yes'] }
      )
    ).resolves.toEqual({
      ok: true,
      command: SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_CHECKED,
      owner: 'shell',
    });
    expect(onSetBookmarkBarChecked).toHaveBeenCalledWith(true, ownerWindow);
  });

  test('returns structured errors for unavailable or invalid system menu commands', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 115 });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['windows.open'] }));

    await expect(
      mod.handleShellRequest({ sender }, { method: SHELL_API_METHODS.WINDOWS_NEW, args: [] })
    ).resolves.toEqual({
      ok: false,
      command: SHELL_API_METHODS.WINDOWS_NEW,
      owner: 'shell',
      error: {
        code: 'SHELL_COMMAND_UNAVAILABLE',
        message: 'New window command is unavailable',
      },
    });

    await expect(
      mod.handleShellRequest({ sender }, { method: SHELL_API_METHODS.WINDOWS_OPEN_URL, args: [''] })
    ).resolves.toEqual({
      ok: false,
      command: SHELL_API_METHODS.WINDOWS_OPEN_URL,
      owner: 'shell',
      error: {
        code: 'WINDOW_TARGET_URL_INVALID',
        message: 'Window target URL is invalid',
      },
    });
  });

  test('returns structured errors for unavailable chrome UI menu state commands', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 118 });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['chrome.ui.commands'] })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.CHROME_UI_UPDATE_TAB_MENU_STATE,
          args: [{ tabCount: 1 }],
        }
      )
    ).resolves.toEqual({
      ok: false,
      command: SHELL_API_METHODS.CHROME_UI_UPDATE_TAB_MENU_STATE,
      owner: 'shell',
      error: {
        code: 'SHELL_COMMAND_UNAVAILABLE',
        message: 'Chrome UI menu state command is unavailable',
      },
    });
  });

  test('rejects system menu commands without declared capabilities', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 116 });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['shell.info'] }));

    await expect(
      mod.handleShellRequest({ sender }, { method: SHELL_API_METHODS.WINDOWS_NEW, args: [] })
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.WINDOWS_NEW,
        requiredCapability: 'windows.open',
      },
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.APP_CHECK_FOR_UPDATES, args: [] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.APP_CHECK_FOR_UPDATES,
        requiredCapability: 'app.updates',
      },
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_CHECKED, args: [true] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_CHECKED,
        requiredCapability: 'chrome.ui.commands',
      },
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.CLIPBOARD_COPY_TEXT, args: ['blocked'] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.CLIPBOARD_COPY_TEXT,
        requiredCapability: 'clipboard.write',
      },
    });

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.DOWNLOADS_SAVE_IMAGE, args: ['https://example.com/a.png'] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.DOWNLOADS_SAVE_IMAGE,
        requiredCapability: 'downloads.saveImage',
      },
    });
  });

  test('rejects window control requests without declared capabilities', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 112 });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['shell.info'] }));

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.WINDOWS_TOGGLE_FULLSCREEN, args: [] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.WINDOWS_TOGGLE_FULLSCREEN,
        requiredCapability: 'windows.control',
      },
    });
  });

  test('returns a structured window error when the owner window is unavailable', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({
      id: 113,
      getOwnerBrowserWindow: jest.fn(() => null),
    });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['windows.control'] }));

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.WINDOWS_MINIMIZE, args: [] }
      )
    ).resolves.toEqual({
      ok: false,
      command: SHELL_API_METHODS.WINDOWS_MINIMIZE,
      owner: 'shell',
      error: {
        code: 'WINDOW_UNAVAILABLE',
        message: 'Owner window is unavailable',
      },
    });
  });

  test('returns false for malformed browser state write payloads', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 105 });
    mod.registerPackageWebContents(
      sender,
      makePackage({
        capabilities: [
          'browserState.bookmarks.write',
          'browserState.history.write',
          'browserState.favicons.write',
        ],
      })
    );

    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_ADD, args: [{}] }
      )
    ).resolves.toBe(false);
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_UPDATE, args: [{}] }
      )
    ).resolves.toBe(false);
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_REMOVE, args: [{}] }
      )
    ).resolves.toBe(false);
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_ADD, args: [{}] }
      )
    ).resolves.toBeNull();
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_REMOVE, args: [{ id: 'bad' }] }
      )
    ).resolves.toBe(false);
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_FAVICONS_GET, args: [''] }
      )
    ).resolves.toBeNull();
    await expect(
      mod.handleShellRequest(
        { sender },
        { method: SHELL_API_METHODS.BROWSER_STATE_FAVICONS_FETCH, args: ['file:///tmp/icon'] }
      )
    ).resolves.toBeNull();
    await expect(
      mod.handleShellRequest(
        { sender },
        {
          method: SHELL_API_METHODS.BROWSER_STATE_FAVICONS_FETCH_WITH_KEY,
          args: [{ fetchUrl: 'https://favicon.example', cacheKey: '' }],
        }
      )
    ).resolves.toBeNull();
    expect(mockAddBookmark).not.toHaveBeenCalled();
    expect(mockUpdateBookmark).not.toHaveBeenCalled();
    expect(mockRemoveBookmark).not.toHaveBeenCalled();
    expect(mockAddHistoryEntry).not.toHaveBeenCalled();
    expect(mockRemoveHistoryEntry).not.toHaveBeenCalled();
    expect(mockGetFavicon).not.toHaveBeenCalled();
    expect(mockFetchFavicon).not.toHaveBeenCalled();
  });

  test('clones shell API handler results before returning them', async () => {
    const { mod } = loadShellApi();
    const value = {
      ok: true,
      nested: {
        keep: 'value',
      },
      drop: undefined,
    };

    const result = mod.cloneShellApiValue(value);

    expect(result).toEqual({
      ok: true,
      nested: {
        keep: 'value',
      },
    });
    expect(result).not.toBe(value);
    expect(result.nested).not.toBe(value.nested);
  });

  test('uses stable shell API error codes', () => {
    const { mod } = loadShellApi();
    const error = mod.createShellApiError('SHELL_TEST', 'test message', { method: 'getInfo' });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ShellApiError');
    expect(error.code).toBe('SHELL_TEST');
    expect(error.message).toBe('test message');
    expect(error.details).toEqual({ method: 'getInfo' });
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
        caller: {
          packageId: 'baby.freedom.chrome.fixture',
        },
      },
    });
    await expect(
      mod.handleShellRequest({ sender }, { method: 'tabs.create', args: [{ url: 'https://x.test' }] })
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: 'tabs.create',
        requiredCapability: 'tabs.write',
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
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
      },
    });
  });
});
