const IPC = require('../shared/ipc-channels');
const { SHELL_API_EVENTS, SHELL_API_METHODS } = require('../shared/shell-api-policy');
const {
  createContextBridgeMock,
  createIpcRendererMock,
  loadMainModule,
} = require('../../test/helpers/main-process-test-utils');

function loadPackagePreload(options = {}) {
  const ipcRenderer =
    options.ipcRenderer ||
    createIpcRendererMock({
      invokeResponses: {
        [IPC.SHELL_REQUEST]: { ok: true },
      },
    });
  const contextBridge = options.contextBridge || createContextBridgeMock();

  const context = loadMainModule(require.resolve('./package-preload'), {
    ipcRenderer,
    contextBridge,
  });

  return {
    mod: context.mod,
    contextBridge,
    exposures: contextBridge.exposedValues,
    ipcRenderer,
  };
}

describe('package-preload', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('exposes only freedomShell', () => {
    const { contextBridge, exposures } = loadPackagePreload();

    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(Object.keys(exposures)).toEqual(['freedomShell']);
    expect(Object.keys(exposures.freedomShell)).toEqual([
      'getInfo',
      'markReady',
      'resolveNavigationInput',
      'resolveEns',
      'invalidateEnsContent',
      'getTabSnapshot',
      'createTab',
      'closeTab',
      'activateTab',
      'navigateTab',
      'reloadTab',
      'goHome',
      'getSettings',
      'saveSettings',
      'getBookmarks',
      'addBookmark',
      'updateBookmark',
      'removeBookmark',
      'getHistory',
      'addHistory',
      'getCachedFavicon',
      'getActiveProfile',
      'listProfiles',
      'getSurfaceState',
      'openSurface',
      'closeSurface',
      'toggleSurface',
      'requestTestTrustedPrompt',
      'setWindowTitle',
      'closeWindow',
      'minimizeWindow',
      'maximizeWindow',
      'toggleFullscreen',
      'newWindow',
      'openUrlInNewWindow',
      'showAbout',
      'checkForUpdates',
      'restartAndInstallUpdate',
      'updateTabMenuState',
      'setBookmarkBarToggleEnabled',
      'setBookmarkBarChecked',
      'onTabCommandResult',
      'onTabSnapshotChanged',
      'onCloseMenusRequested',
      'onFocusAddressBarRequested',
      'onToggleDevToolsRequested',
      'onCloseDevToolsRequested',
      'onCloseAllDevToolsRequested',
      'onNewTabRequested',
      'onCloseTabRequested',
      'onNewTabWithUrlRequested',
      'onNavigateToUrlRequested',
      'onLoadUrlRequested',
      'onReloadRequested',
      'onHardReloadRequested',
      'onNextTabRequested',
      'onPrevTabRequested',
      'onMoveTabLeftRequested',
      'onMoveTabRightRequested',
      'onReopenClosedTabRequested',
      'onToggleBookmarkBarRequested',
      'onProfileUpdated',
    ]);
    expect(Object.isFrozen(exposures.freedomShell)).toBe(true);
    expect(exposures.electronAPI).toBeUndefined();
    expect(exposures.wallet).toBeUndefined();
    expect(exposures.identity).toBeUndefined();
    expect(exposures.swarmProvider).toBeUndefined();
    expect(exposures.swarmPermissions).toBeUndefined();
    expect(exposures.dappPermissions).toBeUndefined();
  });

  test('keeps preload-local constants aligned with the shared shell contract', () => {
    const { mod } = loadPackagePreload();

    expect(mod.SHELL_REQUEST).toBe(IPC.SHELL_REQUEST);
    expect(mod.SHELL_EVENT).toBe(IPC.SHELL_EVENT);
    expect(mod.SHELL_API_METHODS).toEqual(SHELL_API_METHODS);
    expect(mod.SHELL_API_EVENTS).toEqual(SHELL_API_EVENTS);
  });

  test('routes shell calls through the single shell request channel', async () => {
    const { exposures, ipcRenderer } = loadPackagePreload();

    await exposures.freedomShell.getInfo();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.GET_INFO,
      args: [],
    });

    await exposures.freedomShell.markReady();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.MARK_READY,
      args: [],
    });

    await exposures.freedomShell.resolveNavigationInput('example.com');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.RESOLVE_NAVIGATION_INPUT,
      args: ['example.com'],
    });

    await exposures.freedomShell.resolveEns('vitalik.eth');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.RESOLVE_ENS,
      args: ['vitalik.eth'],
    });

    await exposures.freedomShell.invalidateEnsContent('vitalik.eth');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.INVALIDATE_ENS_CONTENT,
      args: ['vitalik.eth'],
    });

    await exposures.freedomShell.getTabSnapshot();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.TABS_GET_SNAPSHOT,
      args: [],
    });

    await exposures.freedomShell.createTab({ url: 'https://example.com' });
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.TABS_CREATE,
      args: [{ url: 'https://example.com' }],
    });

    await exposures.freedomShell.closeTab(2);
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.TABS_CLOSE,
      args: [{ tabId: 2 }],
    });

    await exposures.freedomShell.activateTab(1);
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.TABS_ACTIVATE,
      args: [{ tabId: 1 }],
    });

    await exposures.freedomShell.navigateTab(1, 'https://example.org');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.TABS_NAVIGATE,
      args: [{ tabId: 1, url: 'https://example.org' }],
    });

    await exposures.freedomShell.reloadTab(1);
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.TABS_RELOAD,
      args: [{ tabId: 1 }],
    });

    await exposures.freedomShell.goHome(1);
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.TABS_GO_HOME,
      args: [{ tabId: 1 }],
    });

    await exposures.freedomShell.getSettings();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_SETTINGS_GET,
      args: [],
    });

    await exposures.freedomShell.saveSettings({ showBookmarkBar: true });
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_SETTINGS_SAVE,
      args: [{ showBookmarkBar: true }],
    });

    await exposures.freedomShell.getBookmarks();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_GET,
      args: [],
    });

    await exposures.freedomShell.addBookmark({
      label: 'Example',
      target: 'https://example.com',
    });
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_ADD,
      args: [{ label: 'Example', target: 'https://example.com' }],
    });

    await exposures.freedomShell.updateBookmark('https://example.com', {
      label: 'Updated',
      target: 'https://updated.example',
    });
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_UPDATE,
      args: [
        {
          originalTarget: 'https://example.com',
          bookmark: {
            label: 'Updated',
            target: 'https://updated.example',
          },
        },
      ],
    });

    await exposures.freedomShell.removeBookmark('https://updated.example');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_REMOVE,
      args: [{ target: 'https://updated.example' }],
    });

    await exposures.freedomShell.getHistory({ limit: 10 });
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_GET,
      args: [{ limit: 10 }],
    });

    await exposures.freedomShell.addHistory({
      url: 'https://history.example',
      title: 'History',
      protocol: 'https',
    });
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_HISTORY_ADD,
      args: [{ url: 'https://history.example', title: 'History', protocol: 'https' }],
    });

    await exposures.freedomShell.getCachedFavicon('https://history.example');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_FAVICONS_GET_CACHED,
      args: ['https://history.example'],
    });

    await exposures.freedomShell.getActiveProfile();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_PROFILES_GET_ACTIVE,
      args: [],
    });

    await exposures.freedomShell.listProfiles();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.BROWSER_STATE_PROFILES_LIST,
      args: [],
    });

    await exposures.freedomShell.getSurfaceState('wallet');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.SURFACES_GET_STATE,
      args: [{ surface: 'wallet' }],
    });

    await exposures.freedomShell.openSurface('wallet');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.SURFACES_OPEN,
      args: [{ surface: 'wallet' }],
    });

    await exposures.freedomShell.closeSurface('wallet');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.SURFACES_CLOSE,
      args: [{ surface: 'wallet' }],
    });

    await exposures.freedomShell.toggleSurface('wallet');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.SURFACES_TOGGLE,
      args: [{ surface: 'wallet' }],
    });

    await exposures.freedomShell.requestTestTrustedPrompt({
      kind: 'test.confirmation',
      origin: 'https://spoofed.example',
    });
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.TRUSTED_PROMPTS_REQUEST_TEST,
      args: [{ kind: 'test.confirmation', origin: 'https://spoofed.example' }],
    });

    await exposures.freedomShell.setWindowTitle('Loaded Title');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.WINDOWS_SET_TITLE,
      args: ['Loaded Title'],
    });

    await exposures.freedomShell.closeWindow();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.WINDOWS_CLOSE,
      args: [],
    });

    await exposures.freedomShell.minimizeWindow();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.WINDOWS_MINIMIZE,
      args: [],
    });

    await exposures.freedomShell.maximizeWindow();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.WINDOWS_TOGGLE_MAXIMIZE,
      args: [],
    });

    await exposures.freedomShell.toggleFullscreen();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.WINDOWS_TOGGLE_FULLSCREEN,
      args: [],
    });

    await exposures.freedomShell.newWindow();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.WINDOWS_NEW,
      args: [],
    });

    await exposures.freedomShell.openUrlInNewWindow('https://example.com');
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.WINDOWS_OPEN_URL,
      args: ['https://example.com'],
    });

    await exposures.freedomShell.showAbout();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.APP_SHOW_ABOUT,
      args: [],
    });

    await exposures.freedomShell.checkForUpdates();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.APP_CHECK_FOR_UPDATES,
      args: [],
    });

    await exposures.freedomShell.restartAndInstallUpdate();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.APP_RESTART_AND_INSTALL_UPDATE,
      args: [],
    });

    await exposures.freedomShell.updateTabMenuState({
      tabCount: 2,
      activeIndex: 1,
      hasClosedTabs: true,
    });
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.CHROME_UI_UPDATE_TAB_MENU_STATE,
      args: [
        {
          tabCount: 2,
          activeIndex: 1,
          hasClosedTabs: true,
        },
      ],
    });

    await exposures.freedomShell.setBookmarkBarToggleEnabled(false);
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_TOGGLE_ENABLED,
      args: [false],
    });

    await exposures.freedomShell.setBookmarkBarChecked(true);
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(IPC.SHELL_REQUEST, {
      method: SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_CHECKED,
      args: [true],
    });
  });

  test('subscribes to package-visible shell events', () => {
    const { exposures, ipcRenderer } = loadPackagePreload();
    const commandCallback = jest.fn();
    const snapshotCallback = jest.fn();
    const newTabCallback = jest.fn();
    const newTabWithUrlCallback = jest.fn();
    const focusAddressBarCallback = jest.fn();
    const toggleBookmarkBarCallback = jest.fn();
    const profileUpdatedCallback = jest.fn();

    const cleanupCommand = exposures.freedomShell.onTabCommandResult(commandCallback);
    const cleanupSnapshot = exposures.freedomShell.onTabSnapshotChanged(snapshotCallback);
    const cleanupNewTab = exposures.freedomShell.onNewTabRequested(newTabCallback);
    const cleanupNewTabWithUrl =
      exposures.freedomShell.onNewTabWithUrlRequested(newTabWithUrlCallback);
    const cleanupFocusAddressBar =
      exposures.freedomShell.onFocusAddressBarRequested(focusAddressBarCallback);
    const cleanupToggleBookmarkBar =
      exposures.freedomShell.onToggleBookmarkBarRequested(toggleBookmarkBarCallback);
    const cleanupProfileUpdated = exposures.freedomShell.onProfileUpdated(profileUpdatedCallback);
    const [
      commandHandler,
      snapshotHandler,
      newTabHandler,
      newTabWithUrlHandler,
      focusAddressBarHandler,
      toggleBookmarkBarHandler,
      profileUpdatedHandler,
    ] = ipcRenderer.listeners.get(IPC.SHELL_EVENT);

    ipcRenderer.emit(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_COMMAND_RESULT,
      data: {
        ok: true,
        command: SHELL_API_METHODS.TABS_CREATE,
        tabId: 2,
      },
    });
    ipcRenderer.emit(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_SNAPSHOT_CHANGED,
      data: {
        activeTabId: 2,
        tabs: [{ id: 2 }],
      },
    });
    ipcRenderer.emit(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.CHROME_NEW_TAB_REQUESTED,
      data: {},
    });
    ipcRenderer.emit(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.CHROME_NEW_TAB_WITH_URL_REQUESTED,
      data: {
        url: 'freedom://history',
        targetName: 'history',
      },
    });
    ipcRenderer.emit(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.CHROME_FOCUS_ADDRESS_BAR_REQUESTED,
      data: {},
    });
    ipcRenderer.emit(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.CHROME_TOGGLE_BOOKMARK_BAR_REQUESTED,
      data: {},
    });
    ipcRenderer.emit(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.BROWSER_STATE_PROFILE_UPDATED,
      data: {
        id: 'test',
        displayName: 'Test',
        isActive: true,
      },
    });
    ipcRenderer.emit(IPC.SHELL_EVENT, {
      event: 'unrelated.event',
      data: {
        ok: true,
      },
    });

    expect(commandCallback).toHaveBeenCalledTimes(1);
    expect(commandCallback).toHaveBeenCalledWith({
      ok: true,
      command: SHELL_API_METHODS.TABS_CREATE,
      tabId: 2,
    });
    expect(snapshotCallback).toHaveBeenCalledTimes(1);
    expect(snapshotCallback).toHaveBeenCalledWith({
      activeTabId: 2,
      tabs: [{ id: 2 }],
    });
    expect(newTabCallback).toHaveBeenCalledTimes(1);
    expect(newTabWithUrlCallback).toHaveBeenCalledWith('freedom://history', 'history');
    expect(focusAddressBarCallback).toHaveBeenCalledTimes(1);
    expect(toggleBookmarkBarCallback).toHaveBeenCalledTimes(1);
    expect(profileUpdatedCallback).toHaveBeenCalledWith({
      id: 'test',
      displayName: 'Test',
      isActive: true,
    });

    cleanupCommand();
    cleanupSnapshot();
    cleanupNewTab();
    cleanupNewTabWithUrl();
    cleanupFocusAddressBar();
    cleanupToggleBookmarkBar();
    cleanupProfileUpdated();

    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(IPC.SHELL_EVENT, commandHandler);
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(IPC.SHELL_EVENT, snapshotHandler);
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(IPC.SHELL_EVENT, newTabHandler);
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(IPC.SHELL_EVENT, newTabWithUrlHandler);
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.SHELL_EVENT,
      focusAddressBarHandler
    );
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.SHELL_EVENT,
      toggleBookmarkBarHandler
    );
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.SHELL_EVENT,
      profileUpdatedHandler
    );
    expect(ipcRenderer.listeners.get(IPC.SHELL_EVENT)).toEqual([]);
  });
});
