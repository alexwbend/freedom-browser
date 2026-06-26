const { EventEmitter } = require('events');
const { loadMainModule } = require('../../../test/helpers/main-process-test-utils');

function loadShellWindow() {
  return loadMainModule(require.resolve('./shell-window'));
}

function makeNativeWindow() {
  const nativeWindow = Object.assign(new EventEmitter(), {
    webContents: {
      id: 1,
      getURL: jest.fn(() => 'file:///host.html'),
    },
    getContentSize: jest.fn(() => [1200, 800]),
    getContentView: jest.fn(() => ({
      addChildView: jest.fn(),
      removeChildView: jest.fn(),
      setBackgroundColor: jest.fn(),
    })),
    close: jest.fn(),
    isDestroyed: jest.fn(() => false),
  });
  const contentView = nativeWindow.getContentView();
  nativeWindow.getContentView = jest.fn(() => contentView);
  return { nativeWindow, contentView };
}

function makeChromeView() {
  let bounds = { x: 0, y: 0, width: 1200, height: 800 };
  const webContents = Object.assign(new EventEmitter(), {
    id: 2,
    isDestroyed: jest.fn(() => false),
    close: jest.fn(),
    getURL: jest.fn(() => 'file:///package/index.html'),
  });
  const view = {
    webContents,
    setBounds: jest.fn((nextBounds) => {
      bounds = nextBounds;
    }),
    getBounds: jest.fn(() => bounds),
    getVisible: jest.fn(() => true),
    setBorderRadius: jest.fn(),
  };
  return view;
}

function makeSurfaceView(id = 3) {
  let bounds = { x: 680, y: 0, width: 520, height: 800 };
  const webContents = Object.assign(new EventEmitter(), {
    id,
    isDestroyed: jest.fn(() => false),
    close: jest.fn(),
    focus: jest.fn(),
    getURL: jest.fn(() => 'file:///trusted-wallet.html'),
    loadFile: jest.fn().mockResolvedValue(undefined),
  });
  const view = {
    webContents,
    setBounds: jest.fn((nextBounds) => {
      bounds = nextBounds;
    }),
    setVisible: jest.fn(),
    getBounds: jest.fn(() => bounds),
    getVisible: jest.fn(() => true),
    setBorderRadius: jest.fn(),
  };
  return view;
}

describe('ShellWindow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses a hardened blank host for shell-composed package chrome', () => {
    const { mod } = loadShellWindow();

    expect(mod.getCompositorHostWebPreferences()).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      enableRemoteModule: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    });
  });

  test('uses the shell compositor for local package chrome only', () => {
    const { mod } = loadShellWindow();

    expect(mod.shouldUseShellWindowCompositor({ kind: 'local-package' })).toBe(true);
    expect(mod.shouldUseShellWindowCompositor({ kind: 'bundled' })).toBe(false);
    expect(mod.shouldUseShellWindowCompositor(null)).toBe(false);
  });

  test('wraps legacy BrowserWindow chrome without creating a chrome view', () => {
    const { mod } = loadShellWindow();
    const { nativeWindow, contentView } = makeNativeWindow();

    const shellWindow = mod.createShellWindow({
      nativeWindow,
      chromePackage: { kind: 'bundled', packageId: 'builtin' },
      useChromeView: false,
    });

    expect(shellWindow.chromeWebContents).toBe(nativeWindow.webContents);
    expect(shellWindow.chromeLoadTarget).toBe(nativeWindow);
    expect(contentView.addChildView).not.toHaveBeenCalled();
    expect(nativeWindow.__freedomShellWindow.getDebugState()).toMatchObject({
      mode: 'browser-window-webcontents',
      packageId: 'builtin',
      packageKind: 'bundled',
      chromeWebContentsId: 1,
      hostWebContentsId: 1,
      chromeBounds: null,
    });
    expect(nativeWindow.__freedomShellWindow.canHostTrustedSurfaceWindows()).toBe(false);
  });

  test('attaches package chrome as a full-window compositor view', () => {
    const { mod } = loadShellWindow();
    const { nativeWindow, contentView } = makeNativeWindow();
    const chromeView = makeChromeView();

    const shellWindow = mod.createShellWindow({
      nativeWindow,
      chromePackage: { kind: 'local-package', packageId: 'package' },
      useChromeView: true,
      createChromeView: () => chromeView,
    });

    expect(shellWindow.chromeWebContents).toBe(chromeView.webContents);
    expect(shellWindow.chromeLoadTarget).toBe(chromeView.webContents);
    expect(contentView.addChildView).toHaveBeenCalledWith(chromeView);
    expect(contentView.setBackgroundColor).toHaveBeenCalledWith('#101010');
    expect(chromeView.setBorderRadius).toHaveBeenCalledWith(0);
    expect(chromeView.setBounds).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    });
    expect(nativeWindow.__freedomShellWindow.getDebugState()).toMatchObject({
      mode: 'webcontents-view-compositor',
      packageId: 'package',
      packageKind: 'local-package',
      chromeWebContentsId: 2,
      hostWebContentsId: 1,
      chromeBounds: { x: 0, y: 0, width: 1200, height: 800 },
      chromeVisible: true,
      layout: {
        outerMargin: 0,
        gap: 8,
        radius: 12,
        backgroundColor: '#101010',
      },
      closed: false,
    });
    expect(nativeWindow.__freedomShellWindow.getChromeWebContents()).toBe(chromeView.webContents);
    expect(nativeWindow.__freedomShellWindow.canHostTrustedSurfaceWindows()).toBe(true);

    shellWindow.cleanup();

    expect(contentView.removeChildView).toHaveBeenCalledWith(chromeView);
    expect(chromeView.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    expect(nativeWindow.__freedomShellWindow).toBeUndefined();
    expect(shellWindow.getDebugState()).toMatchObject({ closed: true });
  });

  test('resizes the chrome compositor view with the native window', () => {
    const { mod } = loadShellWindow();
    const { nativeWindow } = makeNativeWindow();
    const chromeView = makeChromeView();
    nativeWindow.getContentSize.mockReturnValueOnce([1200, 800]).mockReturnValueOnce([900, 700]);

    mod.createShellWindow({
      nativeWindow,
      chromePackage: { kind: 'local-package' },
      useChromeView: true,
      createChromeView: () => chromeView,
    });
    nativeWindow.emit('resize');

    expect(chromeView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 900,
      height: 700,
    });
  });

  test('closes the native host if package chrome is destroyed externally', () => {
    const { mod } = loadShellWindow();
    const { nativeWindow } = makeNativeWindow();
    const chromeView = makeChromeView();

    mod.createShellWindow({
      nativeWindow,
      chromePackage: { kind: 'local-package' },
      useChromeView: true,
      createChromeView: () => chromeView,
    });
    chromeView.webContents.emit('destroyed');

    expect(nativeWindow.close).toHaveBeenCalled();
  });

  test('does not close the native host during shell cleanup', () => {
    const { mod } = loadShellWindow();
    const { nativeWindow } = makeNativeWindow();
    const chromeView = makeChromeView();

    const shellWindow = mod.createShellWindow({
      nativeWindow,
      chromePackage: { kind: 'local-package' },
      useChromeView: true,
      createChromeView: () => chromeView,
    });
    shellWindow.cleanup();
    chromeView.webContents.emit('destroyed');

    expect(nativeWindow.close).not.toHaveBeenCalled();
  });

  test('hosts trusted surface windows as docked right-drawer views by default', async () => {
    const { mod } = loadShellWindow();
    const { nativeWindow, contentView } = makeNativeWindow();
    const chromeView = makeChromeView();
    const surfaceView = makeSurfaceView();

    const shellWindow = mod.createShellWindow({
      nativeWindow,
      chromePackage: { kind: 'local-package' },
      useChromeView: true,
      createChromeView: () => chromeView,
    });
    const surfaceWindow = shellWindow.createTrustedSurfaceWindow({
      surface: 'wallet',
      width: 520,
      minWidth: 360,
      createView: () => surfaceView,
    });
    const ready = jest.fn();
    surfaceWindow.once('ready-to-show', ready);

    await surfaceWindow.loadFile('/trusted-wallet.html', { query: { surfaceId: 'wallet-1' } });
    surfaceView.webContents.emit('dom-ready');
    surfaceWindow.show();
    surfaceWindow.focus();

    expect(contentView.addChildView).toHaveBeenCalledWith(surfaceView);
    expect(surfaceView.setBorderRadius).toHaveBeenCalledWith(12);
    expect(chromeView.setBorderRadius).toHaveBeenLastCalledWith(12);
    expect(surfaceView.setBounds).toHaveBeenCalledWith({
      x: 680,
      y: 0,
      width: 520,
      height: 800,
    });
    expect(chromeView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 672,
      height: 800,
    });
    expect(surfaceView.webContents.loadFile).toHaveBeenCalledWith('/trusted-wallet.html', {
      query: { surfaceId: 'wallet-1' },
    });
    expect(surfaceView.setVisible).toHaveBeenCalledWith(true);
    expect(surfaceView.webContents.focus).toHaveBeenCalled();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(surfaceWindow.webContents).toBe(surfaceView.webContents);
    expect(surfaceWindow.getNativeOwnerWindow()).toBe(nativeWindow);
    expect(shellWindow.getDebugState().surfaces).toEqual([
      expect.objectContaining({
        surface: 'wallet',
        layoutMode: 'dock',
        webContentsId: 3,
        bounds: { x: 680, y: 0, width: 520, height: 800 },
        visible: true,
      }),
    ]);

    surfaceWindow.close();

    expect(contentView.removeChildView).toHaveBeenCalledWith(surfaceView);
    expect(surfaceView.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    expect(chromeView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    });
    expect(chromeView.setBorderRadius).toHaveBeenLastCalledWith(0);
    expect(shellWindow.getDebugState().surfaces).toEqual([]);
  });

  test('supports overlay trusted surface windows without squeezing chrome', () => {
    const { mod } = loadShellWindow();
    const { nativeWindow } = makeNativeWindow();
    const chromeView = makeChromeView();
    const surfaceView = makeSurfaceView();

    const shellWindow = mod.createShellWindow({
      nativeWindow,
      chromePackage: { kind: 'local-package' },
      useChromeView: true,
      createChromeView: () => chromeView,
    });
    shellWindow.createTrustedSurfaceWindow({
      surface: 'wallet',
      width: 520,
      minWidth: 360,
      layoutMode: mod.SURFACE_LAYOUT_MODE_OVERLAY,
      createView: () => surfaceView,
    });

    expect(surfaceView.setBounds).toHaveBeenLastCalledWith({
      x: 680,
      y: 0,
      width: 520,
      height: 800,
    });
    expect(chromeView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    });
    expect(shellWindow.getDebugState().surfaces).toEqual([
      expect.objectContaining({
        surface: 'wallet',
        layoutMode: 'overlay',
      }),
    ]);
  });

  test('tiles multiple docked right surfaces without outer gutters', () => {
    const { mod } = loadShellWindow();
    const { nativeWindow } = makeNativeWindow();
    const chromeView = makeChromeView();
    const walletView = makeSurfaceView(3);
    const toolsView = makeSurfaceView(4);

    const shellWindow = mod.createShellWindow({
      nativeWindow,
      chromePackage: { kind: 'local-package' },
      useChromeView: true,
      createChromeView: () => chromeView,
    });
    shellWindow.createTrustedSurfaceWindow({
      surface: 'wallet',
      width: 520,
      minWidth: 360,
      createView: () => walletView,
    });
    shellWindow.createTrustedSurfaceWindow({
      surface: 'tools',
      width: 300,
      minWidth: 200,
      createView: () => toolsView,
    });

    expect(walletView.setBounds).toHaveBeenLastCalledWith({
      x: 680,
      y: 0,
      width: 520,
      height: 800,
    });
    expect(toolsView.setBounds).toHaveBeenLastCalledWith({
      x: 372,
      y: 0,
      width: 300,
      height: 800,
    });
    expect(chromeView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 364,
      height: 800,
    });
    expect(walletView.getBounds().x - (
      toolsView.getBounds().x + toolsView.getBounds().width
    )).toBe(8);
    expect(toolsView.getBounds().x - (
      chromeView.getBounds().x + chromeView.getBounds().width
    )).toBe(8);
  });

  test('resizes hosted trusted surfaces with the native window', () => {
    const { mod } = loadShellWindow();
    const { nativeWindow } = makeNativeWindow();
    const chromeView = makeChromeView();
    const surfaceView = makeSurfaceView();
    nativeWindow.getContentSize
      .mockReturnValueOnce([1200, 800])
      .mockReturnValueOnce([1200, 800])
      .mockReturnValueOnce([900, 700])
      .mockReturnValueOnce([900, 700]);

    const shellWindow = mod.createShellWindow({
      nativeWindow,
      chromePackage: { kind: 'local-package' },
      useChromeView: true,
      createChromeView: () => chromeView,
    });
    shellWindow.createTrustedSurfaceWindow({
      surface: 'wallet',
      width: 520,
      minWidth: 360,
      createView: () => surfaceView,
    });
    nativeWindow.emit('resize');

    expect(surfaceView.setBounds).toHaveBeenLastCalledWith({
      x: 380,
      y: 0,
      width: 520,
      height: 700,
    });
    expect(chromeView.setBounds).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 372,
      height: 700,
    });
  });

  test('cleans up hosted trusted surfaces with the shell window', () => {
    const { mod } = loadShellWindow();
    const { nativeWindow, contentView } = makeNativeWindow();
    const chromeView = makeChromeView();
    const surfaceView = makeSurfaceView();
    const closed = jest.fn();

    const shellWindow = mod.createShellWindow({
      nativeWindow,
      chromePackage: { kind: 'local-package' },
      useChromeView: true,
      createChromeView: () => chromeView,
    });
    const surfaceWindow = shellWindow.createTrustedSurfaceWindow({
      surface: 'wallet',
      createView: () => surfaceView,
    });
    surfaceWindow.once('closed', closed);
    shellWindow.cleanup();

    expect(contentView.removeChildView).toHaveBeenCalledWith(surfaceView);
    expect(surfaceView.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(shellWindow.getDebugState().surfaces).toEqual([]);
  });
});
