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

  test('hardens local package windows and never enables package-owned webviews in v0', () => {
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
});
