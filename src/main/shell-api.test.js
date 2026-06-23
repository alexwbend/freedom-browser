const IPC = require('../shared/ipc-channels');
const { version: appVersion } = require('../../package.json');
const { SHELL_API_VERSION } = require('./chrome-package');
const { SHELL_API_EVENTS, SHELL_API_METHODS } = require('../shared/shell-api-policy');
const { createShellTabRegistry } = require('./shell-tabs');
const { createIpcMainMock, loadMainModule } = require('../../test/helpers/main-process-test-utils');

const mockResolveEnsContent = jest.fn();
const mockInvalidateEnsContent = jest.fn();
const mockLoadSettings = jest.fn();
const mockLoadBookmarks = jest.fn();
const mockAddBookmark = jest.fn();
const mockUpdateBookmark = jest.fn();
const mockRemoveBookmark = jest.fn();
const mockGetAllHistory = jest.fn();
const mockGetRecentHistory = jest.fn();
const mockSearchHistory = jest.fn();
const mockAddHistoryEntry = jest.fn();
const mockGetCachedFavicon = jest.fn();
const ORIGINAL_FREEDOM_TEST_MODE = process.env.FREEDOM_TEST_MODE;
const ENS_RESOLVER_MODULE = require.resolve('./ens-resolver');
const SETTINGS_STORE_MODULE = require.resolve('./settings-store');
const BOOKMARKS_STORE_MODULE = require.resolve('./bookmarks-store');
const HISTORY_MODULE = require.resolve('./history');
const FAVICONS_MODULE = require.resolve('./favicons');

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
    app: {
      getVersion: jest.fn(() => appVersion),
    },
    extraMocks: {
      [ENS_RESOLVER_MODULE]: () => ({
        resolveEnsContent: mockResolveEnsContent,
        invalidateEnsContent: mockInvalidateEnsContent,
      }),
      [SETTINGS_STORE_MODULE]: () => ({
        loadSettings: mockLoadSettings,
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
      }),
      [FAVICONS_MODULE]: () => ({
        getCachedFavicon: mockGetCachedFavicon,
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
    mockLoadBookmarks.mockReset();
    mockAddBookmark.mockReset();
    mockUpdateBookmark.mockReset();
    mockRemoveBookmark.mockReset();
    mockGetAllHistory.mockReset();
    mockGetRecentHistory.mockReset();
    mockSearchHistory.mockReset();
    mockAddHistoryEntry.mockReset();
    mockGetCachedFavicon.mockReset();
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
      caller: null,
    });
    expect(JSON.stringify(mod.getInfo())).not.toContain('/tmp/package');
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
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 99 });
    mod.registerPackageWebContents(sender, makePackage({ capabilities: ['shell.info'] }));

    await expect(
      mod.handleShellRequest({ sender }, { method: 'getInfo', args: [] })
    ).resolves.toMatchObject({
      caller: {
        runtimeMode: 'local-package',
        source: 'local',
        packageId: 'baby.freedom.chrome.fixture',
        packageType: 'browser-chrome',
        name: 'Fixture Chrome',
        version: '0.0.1',
        capabilities: ['shell.info'],
      },
    });
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

  test('handles capability-gated browser state requests', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 103 });
    mod.registerPackageWebContents(
      sender,
      makePackage({
        capabilities: [
          'browserState.settings.read',
          'browserState.bookmarks.read',
          'browserState.bookmarks.write',
          'browserState.history.read',
          'browserState.history.write',
          'browserState.favicons.read',
        ],
      })
    );
    const settings = {
      theme: 'system',
      showBookmarkBar: true,
      enableIdentityWallet: true,
    };
    mockLoadSettings.mockReturnValue(settings);
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
    mockGetCachedFavicon.mockReturnValue('data:image/png;base64,ZmF2');

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
        {
          method: SHELL_API_METHODS.BROWSER_STATE_FAVICONS_GET_CACHED,
          args: [' https://favicon.example '],
        }
      )
    ).resolves.toBe('data:image/png;base64,ZmF2');
    expect(mockGetCachedFavicon).toHaveBeenCalledWith('https://favicon.example');

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
        { method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_GET, args: [] }
      )
    ).rejects.toMatchObject({
      code: 'SHELL_CAPABILITY_DENIED',
      details: {
        method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_GET,
        requiredCapability: 'browserState.history.read',
      },
    });
  });

  test('returns false for malformed browser state write payloads', async () => {
    const { mod } = loadShellApi();
    const sender = makeSender({ id: 105 });
    mod.registerPackageWebContents(
      sender,
      makePackage({ capabilities: ['browserState.bookmarks.write', 'browserState.history.write'] })
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
    expect(mockAddBookmark).not.toHaveBeenCalled();
    expect(mockUpdateBookmark).not.toHaveBeenCalled();
    expect(mockRemoveBookmark).not.toHaveBeenCalled();
    expect(mockAddHistoryEntry).not.toHaveBeenCalled();
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
      runtimeMode: 'bundled',
    });
  });
});
