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
    })),
    close: jest.fn(),
    isDestroyed: jest.fn(() => false),
  });
  const contentView = nativeWindow.getContentView();
  nativeWindow.getContentView = jest.fn(() => contentView);
  return { nativeWindow, contentView };
}

function makeChromeView() {
  const webContents = Object.assign(new EventEmitter(), {
    id: 2,
    isDestroyed: jest.fn(() => false),
    close: jest.fn(),
    getURL: jest.fn(() => 'file:///package/index.html'),
  });
  return {
    webContents,
    setBounds: jest.fn(),
    getBounds: jest.fn(() => ({ x: 0, y: 0, width: 1200, height: 800 })),
    getVisible: jest.fn(() => true),
  };
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
      closed: false,
    });
    expect(nativeWindow.__freedomShellWindow.getChromeWebContents()).toBe(chromeView.webContents);

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
});
