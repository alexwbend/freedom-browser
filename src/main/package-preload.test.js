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
      'getBookmarks',
      'addBookmark',
      'updateBookmark',
      'removeBookmark',
      'getHistory',
      'addHistory',
      'getCachedFavicon',
      'onTabCommandResult',
      'onTabSnapshotChanged',
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
  });

  test('subscribes to package-visible tab events', () => {
    const { exposures, ipcRenderer } = loadPackagePreload();
    const commandCallback = jest.fn();
    const snapshotCallback = jest.fn();

    const cleanupCommand = exposures.freedomShell.onTabCommandResult(commandCallback);
    const cleanupSnapshot = exposures.freedomShell.onTabSnapshotChanged(snapshotCallback);
    const [commandHandler, snapshotHandler] = ipcRenderer.listeners.get(IPC.SHELL_EVENT);

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

    cleanupCommand();
    cleanupSnapshot();

    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(IPC.SHELL_EVENT, commandHandler);
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(IPC.SHELL_EVENT, snapshotHandler);
    expect(ipcRenderer.listeners.get(IPC.SHELL_EVENT)).toEqual([]);
  });
});
