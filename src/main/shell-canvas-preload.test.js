const IPC = require('../shared/ipc-channels');
const {
  createContextBridgeMock,
  createIpcRendererMock,
  loadMainModule,
} = require('../../test/helpers/main-process-test-utils');

function loadShellCanvasPreload(options = {}) {
  const ipcRenderer =
    options.ipcRenderer ||
    createIpcRendererMock({
      invokeResponses: {
        [IPC.SHELL_CANVAS_COMMAND]: { ok: true },
      },
    });
  const contextBridge = options.contextBridge || createContextBridgeMock();

  const context = loadMainModule(require.resolve('./shell-canvas-preload'), {
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

describe('shell-canvas-preload', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('exposes only the shell canvas bridge', () => {
    const { contextBridge, exposures } = loadShellCanvasPreload();

    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(Object.keys(exposures)).toEqual(['freedomShellCanvas']);
    expect(Object.keys(exposures.freedomShellCanvas)).toEqual([
      'ready',
      'command',
      'onState',
    ]);
  });

  test('keeps preload-local channels aligned with the shared IPC contract', () => {
    const { mod } = loadShellCanvasPreload();

    expect(mod.SHELL_CANVAS_COMMAND).toBe(IPC.SHELL_CANVAS_COMMAND);
    expect(mod.SHELL_CANVAS_READY).toBe(IPC.SHELL_CANVAS_READY);
    expect(mod.SHELL_CANVAS_STATE).toBe(IPC.SHELL_CANVAS_STATE);
  });

  test('routes ready and command calls through shell canvas IPC channels', async () => {
    const { exposures, ipcRenderer } = loadShellCanvasPreload();

    exposures.freedomShellCanvas.ready();
    expect(ipcRenderer.send).toHaveBeenCalledWith(IPC.SHELL_CANVAS_READY);

    await exposures.freedomShellCanvas.command('launch-app', { app: 'browser' });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC.SHELL_CANVAS_COMMAND, {
      command: 'launch-app',
      payload: { app: 'browser' },
    });
  });

  test('subscribes and unsubscribes from shell canvas state events', () => {
    const { exposures, ipcRenderer } = loadShellCanvasPreload();
    const onState = jest.fn();

    const unsubscribe = exposures.freedomShellCanvas.onState(onState);
    ipcRenderer.emit(IPC.SHELL_CANVAS_STATE, { launcher: { visible: true } });
    expect(onState).toHaveBeenCalledWith({ launcher: { visible: true } });

    unsubscribe();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC.SHELL_CANVAS_STATE,
      expect.any(Function)
    );
  });
});
