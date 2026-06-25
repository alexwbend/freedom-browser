const path = require('path');
const { EventEmitter } = require('events');
const { loadMainModule } = require('../../../test/helpers/main-process-test-utils');

function loadMainWindow() {
  return loadMainModule(require.resolve('./mainWindow'));
}

describe('mainWindow chrome package preferences', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps bundled chrome webview support while disabling broad renderer privileges', () => {
    const { mod } = loadMainWindow();

    expect(
      mod.getChromeWindowWebPreferences({
        kind: 'bundled',
        preloadPath: path.join('/app', 'preload.js'),
        webviewTag: true,
      })
    ).toMatchObject({
      preload: path.join('/app', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: true,
      enableRemoteModule: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    });
  });

  test('hardens local package windows and keeps package-owned webviews disabled by default', () => {
    const { mod } = loadMainWindow();

    expect(
      mod.getChromeWindowWebPreferences({
        kind: 'local-package',
        preloadPath: path.join('/app', 'package-preload.js'),
        webviewTag: true,
      })
    ).toMatchObject({
      preload: path.join('/app', 'package-preload.js'),
      contextIsolation: true,
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

  test('allows manifest-gated transitional webview support for local packages', () => {
    const { mod } = loadMainWindow();

    expect(
      mod.getChromeWindowWebPreferences({
        kind: 'local-package',
        preloadPath: path.join('/app', 'package-preload.js'),
        webviewTag: false,
        transitionalWebviews: true,
      })
    ).toMatchObject({
      preload: path.join('/app', 'package-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: true,
      enableRemoteModule: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    });
  });

  test('uses a hardened blank host for the experimental shell compositor', () => {
    const { mod } = loadMainWindow();

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

  test('enables the experimental shell compositor only for local packages with the flag', () => {
    const { mod } = loadMainWindow();

    expect(
      mod.shouldUseExperimentalShellCompositor(
        { kind: 'local-package' },
        { FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR: '1' }
      )
    ).toBe(true);
    expect(
      mod.shouldUseExperimentalShellCompositor(
        { kind: 'bundled' },
        { FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR: '1' }
      )
    ).toBe(false);
    expect(
      mod.shouldUseExperimentalShellCompositor(
        { kind: 'local-package' },
        { FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR: '0' }
      )
    ).toBe(false);
  });

  test('attaches package chrome as a full-window compositor view', () => {
    const { mod } = loadMainWindow();
    const window = Object.assign(new EventEmitter(), {
      webContents: { id: 1 },
      getContentSize: jest.fn(() => [1200, 800]),
      getContentView: jest.fn(() => ({
        addChildView: jest.fn(),
        removeChildView: jest.fn(),
      })),
    });
    const contentView = window.getContentView();
    window.getContentView = jest.fn(() => contentView);
    const chromeView = {
      webContents: {
        id: 2,
        isDestroyed: jest.fn(() => false),
        close: jest.fn(),
        getURL: jest.fn(() => 'file:///package/index.html'),
      },
      setBounds: jest.fn(),
      getBounds: jest.fn(() => ({ x: 0, y: 0, width: 1200, height: 800 })),
      getVisible: jest.fn(() => true),
    };

    const compositor = mod.attachChromeCompositorView(window, { kind: 'local-package' }, {
      createView: () => chromeView,
    });

    expect(compositor.webContents).toBe(chromeView.webContents);
    expect(contentView.addChildView).toHaveBeenCalledWith(chromeView);
    expect(chromeView.setBounds).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    });
    expect(window.__freedomExperimentalShellCompositor.getDebugState()).toMatchObject({
      mode: 'webcontents-view-compositor',
      chromeWebContentsId: 2,
      hostWebContentsId: 1,
      chromeBounds: { x: 0, y: 0, width: 1200, height: 800 },
      chromeVisible: true,
    });

    compositor.cleanup();

    expect(contentView.removeChildView).toHaveBeenCalledWith(chromeView);
    expect(chromeView.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    expect(window.__freedomExperimentalShellCompositor).toBeUndefined();
  });

  test('enforces shell-owned guest webview preferences for transitional package webviews', () => {
    const { mod } = loadMainWindow();
    const preferences = {
      preload: path.join('/package', 'guest-preload.js'),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      nodeIntegrationInSubFrames: true,
      enableRemoteModule: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
    };

    expect(mod.enforcePackageGuestWebPreferences(preferences)).toMatchObject({
      preload: mod.getPackageGuestPreloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      enableRemoteModule: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    });
    expect(path.basename(preferences.preload)).toBe('webview-preload.js');
  });

  test('strips package-supplied guest webview preference attributes', () => {
    const { mod } = loadMainWindow();
    const params = {
      src: 'https://example.com',
      preload: path.join('/package', 'guest-preload.js'),
      preloadURL: `file://${path.join('/package', 'guest-preload.js')}`,
      webpreferences: 'nodeIntegration=yes',
      webPreferences: 'nodeIntegration=yes',
      nodeintegration: 'on',
      nodeIntegration: true,
      nodeintegrationinsubframes: 'on',
      nodeIntegrationInSubFrames: true,
      disablewebsecurity: true,
      disableWebSecurity: true,
      allowpopups: true,
      allowPopups: true,
    };

    expect(mod.sanitizePackageGuestWebviewParams(params)).toEqual({
      src: 'https://example.com',
    });
  });

  test('cleans up package webview security after the BrowserWindow is destroyed', () => {
    const { mod } = loadMainWindow();
    const webContents = {
      isDestroyed: jest.fn(() => false),
      on: jest.fn(),
      removeListener: jest.fn(),
    };
    let destroyed = false;
    const window = {
      get webContents() {
        if (destroyed) {
          throw new TypeError('Object has been destroyed');
        }
        return webContents;
      },
    };

    const cleanup = mod.registerPackageWebviewSecurity(window, {
      kind: 'local-package',
      transitionalWebviews: true,
    });

    destroyed = true;
    expect(() => cleanup()).not.toThrow();
    expect(webContents.removeListener).toHaveBeenCalledWith(
      'will-attach-webview',
      expect.any(Function)
    );
  });

  test('skips package webview security cleanup when webContents is already destroyed', () => {
    const { mod } = loadMainWindow();
    const webContents = {
      isDestroyed: jest.fn(() => true),
      on: jest.fn(),
      removeListener: jest.fn(),
    };
    const cleanup = mod.registerPackageWebviewSecurity(
      { webContents },
      {
        kind: 'local-package',
        transitionalWebviews: true,
      }
    );

    cleanup();

    expect(webContents.removeListener).not.toHaveBeenCalled();
  });

  test('loads store-backed packages through the shell-owned package scheme', () => {
    const { mod } = loadMainWindow();
    const window = {
      loadURL: jest.fn(() => Promise.resolve()),
      loadFile: jest.fn(() => Promise.resolve()),
    };

    mod.loadChromeEntry(window, {
      kind: 'local-package',
      source: 'store',
      entry: 'index.html',
      entryPath: path.join('/store', 'index.html'),
    });

    expect(window.loadURL).toHaveBeenCalledWith('freedom-chrome://active/index.html');
    expect(window.loadFile).not.toHaveBeenCalled();
  });

  test('keeps direct local package development on the file load path', () => {
    const { mod } = loadMainWindow();
    const window = {
      loadURL: jest.fn(() => Promise.resolve()),
      loadFile: jest.fn(() => Promise.resolve()),
    };
    const entryPath = path.join('/package', 'index.html');

    mod.loadChromeEntry(window, {
      kind: 'local-package',
      source: 'local',
      entry: 'index.html',
      entryPath,
    });

    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.loadFile).toHaveBeenCalledWith(entryPath);
  });
});
