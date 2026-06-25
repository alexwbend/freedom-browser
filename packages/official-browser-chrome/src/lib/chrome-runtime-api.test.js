const originalWindow = global.window;
const originalDocument = global.document;

async function loadModule({ freedomShell, documentBody } = {}) {
  jest.resetModules();
  global.window = { freedomShell };
  global.document = documentBody ? { body: documentBody } : undefined;
  return import('./chrome-runtime-api.js');
}

describe('official package chrome-runtime-api', () => {
  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    jest.restoreAllMocks();
  });

  test('uses the freedomShell-backed package adapter', async () => {
    const freedomShell = {
      getInfo: jest.fn().mockResolvedValue({ platform: 'freebsd' }),
      markReady: jest.fn().mockResolvedValue({ ok: true }),
      getSettings: jest.fn().mockResolvedValue({
        theme: 'dark',
        showBookmarkBar: true,
        enableIdentityWallet: true,
      }),
      saveSettings: jest.fn().mockResolvedValue(true),
      getBookmarks: jest.fn().mockResolvedValue([
        { label: 'Example', target: 'https://example.com' },
      ]),
      addBookmark: jest.fn().mockResolvedValue(true),
      updateBookmark: jest.fn().mockResolvedValue(true),
      removeBookmark: jest.fn().mockResolvedValue(true),
      getHistory: jest.fn().mockResolvedValue([
        { title: 'History', url: 'https://history.example' },
      ]),
      addHistory: jest.fn().mockResolvedValue({
        title: 'History',
        url: 'https://history.example',
      }),
      removeHistory: jest.fn().mockResolvedValue(true),
      clearHistory: jest.fn().mockResolvedValue(1),
      getFavicon: jest.fn().mockResolvedValue('data:image/png;base64,Z2V0'),
      getCachedFavicon: jest.fn().mockResolvedValue('data:image/png;base64,ZmF2'),
      fetchFavicon: jest.fn().mockResolvedValue('data:image/png;base64,ZmV0Y2g'),
      fetchFaviconWithKey: jest.fn().mockResolvedValue('data:image/png;base64,a2V5'),
      getActiveProfile: jest.fn().mockResolvedValue({
        id: 'test',
        displayName: 'Test',
        isActive: true,
      }),
      listProfiles: jest.fn().mockResolvedValue({
        success: true,
        profiles: [{ id: 'test', displayName: 'Test', isActive: true }],
      }),
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
      updateTabMenuState: jest.fn().mockResolvedValue({ ok: true }),
      setBookmarkBarToggleEnabled: jest.fn().mockResolvedValue({ ok: true }),
      setBookmarkBarChecked: jest.fn().mockResolvedValue({ ok: true }),
      copyText: jest.fn().mockResolvedValue({ success: true }),
      copyImageFromUrl: jest.fn().mockResolvedValue({ success: true }),
      saveImage: jest.fn().mockResolvedValue({ success: true }),
      getSurfaceState: jest.fn().mockResolvedValue({
        ok: true,
        surface: 'wallet',
        open: false,
        owner: 'shell',
        mode: 'shell-owned-placeholder',
      }),
      openSurface: jest.fn().mockResolvedValue({
        ok: true,
        surface: 'wallet',
        open: true,
        owner: 'shell',
        mode: 'shell-owned-placeholder',
      }),
      closeSurface: jest.fn().mockResolvedValue({
        ok: true,
        surface: 'wallet',
        open: false,
        owner: 'shell',
        mode: 'shell-owned-placeholder',
      }),
      toggleSurface: jest.fn().mockResolvedValue({
        ok: true,
        surface: 'wallet',
        open: true,
        owner: 'shell',
        mode: 'shell-owned-placeholder',
      }),
      onSurfaceStateChanged: jest.fn(() => 'cleanup-surface-state'),
      onCloseMenusRequested: jest.fn(() => 'cleanup-close-menus'),
      onFocusAddressBarRequested: jest.fn(() => 'cleanup-focus-address-bar'),
      onToggleDevToolsRequested: jest.fn(() => 'cleanup-toggle-devtools'),
      onNewTabRequested: jest.fn(() => 'cleanup-new-tab'),
      onCloseTabRequested: jest.fn(() => 'cleanup-close-tab'),
      onReloadRequested: jest.fn(() => 'cleanup-reload'),
      onProfileUpdated: jest.fn(() => 'cleanup-profile-updated'),
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
    await expect(api.addHistory({ url: 'https://history.example' })).resolves.toEqual({
      title: 'History',
      url: 'https://history.example',
    });
    await expect(api.removeHistory(7)).resolves.toBe(true);
    await expect(api.clearHistory()).resolves.toBe(1);
    await expect(api.getFavicon('https://history.example')).resolves.toBe(
      'data:image/png;base64,Z2V0'
    );
    await expect(api.getCachedFavicon('https://history.example')).resolves.toBe(
      'data:image/png;base64,ZmF2'
    );
    await expect(api.fetchFavicon('https://history.example')).resolves.toBe(
      'data:image/png;base64,ZmV0Y2g'
    );
    await expect(
      api.fetchFaviconWithKey(
        'https://gateway.example/ipfs/cid/index.html',
        'ipfs://cid/index.html'
      )
    ).resolves.toBe('data:image/png;base64,a2V5');
    await expect(api.getActiveProfile()).resolves.toEqual({
      id: 'test',
      displayName: 'Test',
      isActive: true,
    });
    await expect(api.listProfiles()).resolves.toEqual({
      success: true,
      profiles: [{ id: 'test', displayName: 'Test', isActive: true }],
    });
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
    await expect(api.updateTabMenuState({ tabCount: 2 })).resolves.toEqual({ ok: true });
    await expect(api.setBookmarkBarToggleEnabled(false)).resolves.toEqual({ ok: true });
    await expect(api.setBookmarkBarChecked(true)).resolves.toEqual({ ok: true });
    await expect(api.copyText('copied')).resolves.toEqual({ success: true });
    await expect(api.copyImageFromUrl('https://example.com/image.png')).resolves.toEqual({
      success: true,
    });
    await expect(api.saveImage('https://example.com/image.png')).resolves.toEqual({
      success: true,
    });
    await expect(api.getSurfaceState('wallet')).resolves.toMatchObject({
      ok: true,
      surface: 'wallet',
      open: false,
      owner: 'shell',
      mode: 'shell-owned-placeholder',
    });
    await expect(api.openSurface('wallet')).resolves.toMatchObject({ open: true });
    await expect(api.closeSurface('wallet')).resolves.toMatchObject({ open: false });
    await expect(api.toggleSurface('wallet')).resolves.toMatchObject({ open: true });
    expect(api.onCloseMenus(jest.fn())).toBe('cleanup-close-menus');
    expect(api.onFocusAddressBar(jest.fn())).toBe('cleanup-focus-address-bar');
    expect(api.onToggleDevTools(jest.fn())).toBe('cleanup-toggle-devtools');
    expect(api.onNewTab(jest.fn())).toBe('cleanup-new-tab');
    expect(api.onCloseTab(jest.fn())).toBe('cleanup-close-tab');
    expect(api.onReload(jest.fn())).toBe('cleanup-reload');
    expect(api.onProfileUpdated(jest.fn())).toBe('cleanup-profile-updated');
    expect(api.onSurfaceStateChanged(jest.fn())).toBe('cleanup-surface-state');
    expect(api.startSwarmProbe).toBeUndefined();
    expect(freedomShell.getSettings).toHaveBeenCalledTimes(1);
    expect(freedomShell.saveSettings).toHaveBeenCalledWith({ showBookmarkBar: false });
    expect(freedomShell.getSurfaceState).toHaveBeenCalledWith('wallet');
  });

  test('uses structured package-mode unavailable results when shell methods are absent', async () => {
    const freedomShell = {
      getInfo: jest.fn().mockResolvedValue({ platform: 'linux' }),
    };
    const mod = await loadModule({ freedomShell });
    const api = mod.getChromeRuntimeApi();

    expect(mod.isPackageChromeRuntime()).toBe(true);
    await expect(api.getSettings()).resolves.toMatchObject({
      theme: 'system',
      enableIdentityWallet: false,
    });
    await expect(api.saveSettings({ showBookmarkBar: true })).resolves.toBe(false);
    await expect(api.getBookmarks()).resolves.toEqual([]);
    await expect(api.addHistory({ url: 'https://history.example' })).resolves.toBe(false);
    await expect(api.getActiveProfile()).resolves.toBeNull();
    await expect(api.listProfiles()).resolves.toMatchObject({
      success: false,
      error: { code: 'PROFILE_READ_UNAVAILABLE' },
    });
    await expect(api.createProfile({ displayName: 'Work' })).resolves.toMatchObject({
      success: false,
      error: { code: 'PROFILE_PACKAGE_MUTATION_UNAVAILABLE' },
    });
    await expect(api.setBzzBase(1, 'http://127.0.0.1:1633')).resolves.toMatchObject({
      success: false,
      error: { code: 'SERVICE_BASE_UNAVAILABLE' },
    });
    await expect(api.resolveExternalNodeCandidates({ requestId: 'req-1' })).resolves.toMatchObject({
      success: false,
      error: { code: 'EXTERNAL_NODE_PROMPT_UNAVAILABLE' },
    });
    await expect(api.getWebviewPreloadPath()).resolves.toBeNull();
    await expect(api.resolveEnsAddress('vitalik.eth')).resolves.toMatchObject({
      success: false,
      reason: 'PACKAGE_UNAVAILABLE',
      code: 'ENS_WALLET_RESOLUTION_UNAVAILABLE',
    });
    await expect(api.x402Approve('payment-1')).resolves.toMatchObject({
      success: false,
      error: { code: 'X402_PACKAGE_API_UNAVAILABLE' },
    });
    await expect(api.copyText('copied')).resolves.toMatchObject({
      success: false,
      error: { code: 'CLIPBOARD_WRITE_UNAVAILABLE' },
    });
    await expect(api.readClipboardText()).resolves.toEqual({ success: false, text: '' });
    await expect(api.getSurfaceState('wallet')).resolves.toMatchObject({
      success: false,
      error: { code: 'SURFACE_CONTROL_UNAVAILABLE' },
    });
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

  test('does not mark ready without a package shell bridge', async () => {
    const body = { dataset: {} };
    const mod = await loadModule({ documentBody: body });

    await expect(mod.markPackageChromeReady()).resolves.toBe(false);

    expect(body.dataset.packageReady).toBeUndefined();
  });
});
