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
      'getTabSnapshot',
      'createTab',
      'closeTab',
      'activateTab',
      'navigateTab',
      'reloadTab',
      'goHome',
      'onTabCommandResult',
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
  });

  test('subscribes to package-visible tab command result events', () => {
    const { exposures, ipcRenderer } = loadPackagePreload();
    const callback = jest.fn();

    const cleanup = exposures.freedomShell.onTabCommandResult(callback);
    const [handler] = ipcRenderer.listeners.get(IPC.SHELL_EVENT);

    ipcRenderer.emit(IPC.SHELL_EVENT, {
      event: SHELL_API_EVENTS.TABS_COMMAND_RESULT,
      data: {
        ok: true,
        command: SHELL_API_METHODS.TABS_CREATE,
        tabId: 2,
      },
    });
    ipcRenderer.emit(IPC.SHELL_EVENT, {
      event: 'unrelated.event',
      data: {
        ok: true,
      },
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      ok: true,
      command: SHELL_API_METHODS.TABS_CREATE,
      tabId: 2,
    });

    cleanup();

    expect(ipcRenderer.removeListener).toHaveBeenLastCalledWith(IPC.SHELL_EVENT, handler);
    expect(ipcRenderer.listeners.get(IPC.SHELL_EVENT)).toEqual([]);
  });
});
