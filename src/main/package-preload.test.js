const IPC = require('../shared/ipc-channels');
const { SHELL_API_METHODS } = require('../shared/shell-api-policy');
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
    expect(mod.SHELL_API_METHODS).toEqual(SHELL_API_METHODS);
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
  });
});
