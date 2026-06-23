const originalWindow = global.window;
const originalDocument = global.document;

async function loadModule({ electronAPI, freedomShell, documentBody } = {}) {
  jest.resetModules();
  global.window = {
    electronAPI,
    freedomShell,
  };
  global.document = documentBody ? { body: documentBody } : undefined;
  return import('./chrome-runtime-api.js');
}

describe('chrome-runtime-api', () => {
  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    jest.restoreAllMocks();
  });

  test('uses the bundled electronAPI when it is available', async () => {
    const electronAPI = {
      getSettings: jest.fn(),
    };
    const mod = await loadModule({ electronAPI });

    expect(mod.isPackageChromeRuntime()).toBe(false);
    expect(mod.getChromeRuntimeApi()).toBe(electronAPI);
  });

  test('uses freedomShell-backed package defaults without exposing broad globals', async () => {
    const freedomShell = {
      getInfo: jest.fn().mockResolvedValue({ platform: 'freebsd' }),
      markReady: jest.fn().mockResolvedValue({ ok: true }),
      getSettings: jest.fn().mockResolvedValue({
        theme: 'dark',
        showBookmarkBar: true,
        enableIdentityWallet: true,
      }),
      saveSettings: jest.fn().mockResolvedValue(true),
      getBookmarks: jest
        .fn()
        .mockResolvedValue([{ label: 'Example', target: 'https://example.com' }]),
      addBookmark: jest.fn().mockResolvedValue(true),
      updateBookmark: jest.fn().mockResolvedValue(true),
      removeBookmark: jest.fn().mockResolvedValue(true),
      getHistory: jest
        .fn()
        .mockResolvedValue([{ title: 'History', url: 'https://history.example' }]),
      addHistory: jest.fn().mockResolvedValue({
        title: 'History',
        url: 'https://history.example',
      }),
      getCachedFavicon: jest.fn().mockResolvedValue('data:image/png;base64,ZmF2'),
      resolveEns: jest.fn().mockResolvedValue({ type: 'not_found' }),
      invalidateEnsContent: jest.fn().mockResolvedValue(true),
      setWindowTitle: jest.fn().mockResolvedValue({ ok: true }),
      closeWindow: jest.fn().mockResolvedValue({ ok: true }),
      minimizeWindow: jest.fn().mockResolvedValue({ ok: true }),
      maximizeWindow: jest.fn().mockResolvedValue({ ok: true }),
      toggleFullscreen: jest.fn().mockResolvedValue({ ok: true }),
      newWindow: jest.fn().mockResolvedValue({ ok: true }),
      openUrlInNewWindow: jest.fn().mockResolvedValue({ ok: true }),
      showAbout: jest.fn().mockResolvedValue({ ok: true }),
      checkForUpdates: jest.fn().mockResolvedValue({ ok: true }),
      restartAndInstallUpdate: jest.fn().mockResolvedValue({ ok: true }),
      onCloseMenusRequested: jest.fn(() => 'cleanup-close-menus'),
      onFocusAddressBarRequested: jest.fn(() => 'cleanup-focus-address-bar'),
      onToggleDevToolsRequested: jest.fn(() => 'cleanup-toggle-devtools'),
      onNewTabRequested: jest.fn(() => 'cleanup-new-tab'),
      onCloseTabRequested: jest.fn(() => 'cleanup-close-tab'),
      onNewTabWithUrlRequested: jest.fn(() => 'cleanup-new-tab-with-url'),
      onReloadRequested: jest.fn(() => 'cleanup-reload'),
      onNextTabRequested: jest.fn(() => 'cleanup-next-tab'),
      onPrevTabRequested: jest.fn(() => 'cleanup-prev-tab'),
      onToggleBookmarkBarRequested: jest.fn(() => 'cleanup-toggle-bookmark-bar'),
    };
    const mod = await loadModule({ freedomShell });
    const api = mod.getChromeRuntimeApi();

    expect(mod.isPackageChromeRuntime()).toBe(true);
    await expect(api.getPlatform()).resolves.toBe('freebsd');
    await expect(api.getSettings()).resolves.toMatchObject({
      theme: 'dark',
      showBookmarkBar: true,
      enableIdentityWallet: true,
    });
    await expect(api.saveSettings({ showBookmarkBar: false })).resolves.toBe(true);
    await expect(api.getBookmarks()).resolves.toEqual([
      { label: 'Example', target: 'https://example.com' },
    ]);
    await expect(
      api.addBookmark({ label: 'Added', target: 'https://added.example' })
    ).resolves.toBe(true);
    await expect(
      api.updateBookmark('https://example.com', {
        label: 'Updated',
        target: 'https://updated.example',
      })
    ).resolves.toBe(true);
    await expect(api.removeBookmark('https://updated.example')).resolves.toBe(true);
    await expect(api.getHistory({ limit: 5 })).resolves.toEqual([
      { title: 'History', url: 'https://history.example' },
    ]);
    await expect(
      api.addHistory({ title: 'History', url: 'https://history.example' })
    ).resolves.toEqual({
      title: 'History',
      url: 'https://history.example',
    });
    await expect(api.getCachedFavicon('https://history.example')).resolves.toBe(
      'data:image/png;base64,ZmF2'
    );
    await expect(api.getWebviewPreloadPath()).resolves.toBeNull();
    expect(api.startSwarmProbe).toBeUndefined();
    await expect(api.resolveEns('vitalik.eth')).resolves.toEqual({ type: 'not_found' });
    await expect(api.invalidateEnsContent('vitalik.eth')).resolves.toBe(true);
    await expect(api.setWindowTitle('Loaded Title')).resolves.toEqual({ ok: true });
    await expect(api.closeWindow()).resolves.toEqual({ ok: true });
    await expect(api.minimizeWindow()).resolves.toEqual({ ok: true });
    await expect(api.maximizeWindow()).resolves.toEqual({ ok: true });
    await expect(api.toggleFullscreen()).resolves.toEqual({ ok: true });
    await expect(api.newWindow()).resolves.toEqual({ ok: true });
    await expect(api.openUrlInNewWindow('https://example.com')).resolves.toEqual({ ok: true });
    await expect(api.showAbout()).resolves.toEqual({ ok: true });
    await expect(api.checkForUpdates()).resolves.toEqual({ ok: true });
    await expect(api.restartAndInstallUpdate()).resolves.toEqual({ ok: true });
    const callbacks = {
      closeMenus: jest.fn(),
      focusAddressBar: jest.fn(),
      toggleDevtools: jest.fn(),
      newTab: jest.fn(),
      closeTab: jest.fn(),
      newTabWithUrl: jest.fn(),
      reload: jest.fn(),
      nextTab: jest.fn(),
      prevTab: jest.fn(),
      toggleBookmarkBar: jest.fn(),
    };
    expect(api.onCloseMenus(callbacks.closeMenus)).toBe('cleanup-close-menus');
    expect(api.onFocusAddressBar(callbacks.focusAddressBar)).toBe(
      'cleanup-focus-address-bar'
    );
    expect(api.onToggleDevTools(callbacks.toggleDevtools)).toBe('cleanup-toggle-devtools');
    expect(api.onNewTab(callbacks.newTab)).toBe('cleanup-new-tab');
    expect(api.onCloseTab(callbacks.closeTab)).toBe('cleanup-close-tab');
    expect(api.onNewTabWithUrl(callbacks.newTabWithUrl)).toBe('cleanup-new-tab-with-url');
    expect(api.onReload(callbacks.reload)).toBe('cleanup-reload');
    expect(api.onNextTab(callbacks.nextTab)).toBe('cleanup-next-tab');
    expect(api.onPrevTab(callbacks.prevTab)).toBe('cleanup-prev-tab');
    expect(api.onToggleBookmarkBar(callbacks.toggleBookmarkBar)).toBe(
      'cleanup-toggle-bookmark-bar'
    );
    expect(freedomShell.resolveEns).toHaveBeenCalledWith('vitalik.eth');
    expect(freedomShell.invalidateEnsContent).toHaveBeenCalledWith('vitalik.eth');
    expect(freedomShell.setWindowTitle).toHaveBeenCalledWith('Loaded Title');
    expect(freedomShell.closeWindow).toHaveBeenCalledTimes(1);
    expect(freedomShell.minimizeWindow).toHaveBeenCalledTimes(1);
    expect(freedomShell.maximizeWindow).toHaveBeenCalledTimes(1);
    expect(freedomShell.toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(freedomShell.newWindow).toHaveBeenCalledTimes(1);
    expect(freedomShell.openUrlInNewWindow).toHaveBeenCalledWith('https://example.com');
    expect(freedomShell.showAbout).toHaveBeenCalledTimes(1);
    expect(freedomShell.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(freedomShell.restartAndInstallUpdate).toHaveBeenCalledTimes(1);
    expect(freedomShell.saveSettings).toHaveBeenCalledWith({ showBookmarkBar: false });
    expect(freedomShell.addBookmark).toHaveBeenCalledWith({
      label: 'Added',
      target: 'https://added.example',
    });
    expect(freedomShell.updateBookmark).toHaveBeenCalledWith('https://example.com', {
      label: 'Updated',
      target: 'https://updated.example',
    });
    expect(freedomShell.removeBookmark).toHaveBeenCalledWith('https://updated.example');
    expect(freedomShell.getHistory).toHaveBeenCalledWith({ limit: 5 });
    expect(freedomShell.addHistory).toHaveBeenCalledWith({
      title: 'History',
      url: 'https://history.example',
    });
    expect(freedomShell.getCachedFavicon).toHaveBeenCalledWith('https://history.example');
    expect(freedomShell.onCloseMenusRequested).toHaveBeenCalledWith(callbacks.closeMenus);
    expect(freedomShell.onFocusAddressBarRequested).toHaveBeenCalledWith(
      callbacks.focusAddressBar
    );
    expect(freedomShell.onToggleDevToolsRequested).toHaveBeenCalledWith(
      callbacks.toggleDevtools
    );
    expect(freedomShell.onNewTabRequested).toHaveBeenCalledWith(callbacks.newTab);
    expect(freedomShell.onCloseTabRequested).toHaveBeenCalledWith(callbacks.closeTab);
    expect(freedomShell.onNewTabWithUrlRequested).toHaveBeenCalledWith(
      callbacks.newTabWithUrl
    );
    expect(freedomShell.onReloadRequested).toHaveBeenCalledWith(callbacks.reload);
    expect(freedomShell.onNextTabRequested).toHaveBeenCalledWith(callbacks.nextTab);
    expect(freedomShell.onPrevTabRequested).toHaveBeenCalledWith(callbacks.prevTab);
    expect(freedomShell.onToggleBookmarkBarRequested).toHaveBeenCalledWith(
      callbacks.toggleBookmarkBar
    );
    expect(global.window.electronAPI).toBeUndefined();
  });

  test('uses safe package defaults when browser-state shell methods are unavailable', async () => {
    const freedomShell = {
      getInfo: jest.fn().mockResolvedValue({ platform: 'linux' }),
    };
    const mod = await loadModule({ freedomShell });
    const api = mod.getChromeRuntimeApi();

    await expect(api.getSettings()).resolves.toMatchObject({
      theme: 'system',
      enableIdentityWallet: false,
    });
    await expect(api.saveSettings({ showBookmarkBar: true })).resolves.toBe(false);
    await expect(api.getBookmarks()).resolves.toEqual([]);
    await expect(api.addBookmark({ label: 'Added', target: 'https://added.example' })).resolves.toBe(
      false
    );
    await expect(api.getHistory({ limit: 5 })).resolves.toEqual([]);
    await expect(api.addHistory({ url: 'https://history.example' })).resolves.toBe(false);
    await expect(api.getCachedFavicon('https://history.example')).resolves.toBeNull();
  });

  test('marks package chrome ready through freedomShell', async () => {
    const body = { dataset: {} };
    const freedomShell = {
      getInfo: jest.fn().mockResolvedValue({ platform: 'linux' }),
      markReady: jest.fn().mockResolvedValue({ ok: true }),
    };
    const mod = await loadModule({ freedomShell, documentBody: body });

    await expect(mod.markPackageChromeReady()).resolves.toBe(true);

    expect(freedomShell.markReady).toHaveBeenCalledTimes(1);
    expect(body.dataset.packageReady).toBe('true');
  });

  test('does not mark bundled chrome as package ready', async () => {
    const electronAPI = {
      getSettings: jest.fn(),
    };
    const freedomShell = {
      markReady: jest.fn(),
    };
    const mod = await loadModule({ electronAPI, freedomShell });

    await expect(mod.markPackageChromeReady()).resolves.toBe(false);

    expect(freedomShell.markReady).not.toHaveBeenCalled();
  });
});
