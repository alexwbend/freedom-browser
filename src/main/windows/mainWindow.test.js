const path = require('path');
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
