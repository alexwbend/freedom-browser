const log = require('../logger');
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  BUNDLED_CHROME_PACKAGE,
  selectChromePackage,
  setActiveChromePackage,
  validateLocalChromePackage,
} = require('../chrome-package');
const { getChromePackageEntryUrl } = require('../chrome-package-protocol');
const {
  getChromePackageStoreRoot,
  rollbackChromePackageStore,
} = require('../chrome-package-store');
const {
  emitShellEventToPackageWebContents,
  onPackageReady,
  registerPackageWebContents,
  setSurfaceOpenForPackageWebContents,
} = require('../shell-api');
const trustedWalletSurface = require('../trusted-wallet-surface');
const settingsStore = require('../settings-store');
const { SHELL_API_EVENTS } = require('../../shared/shell-api-policy');
const {
  createShellWindow,
  getCompositorHostWebPreferences,
  shouldUseShellWindowCompositor,
} = require('./shell-window');
const IPC = require('../../shared/ipc-channels');

let currentWindowTitle = 'Freedom';

// Track all main browser windows we create
const mainWindows = new Set();
let surfaceRailIpcRegistered = false;
let shellCanvasIpcRegistered = false;

// Get the app icon path (works in both dev and packaged)
function getIconPath() {
  let iconPath;
  if (app.isPackaged) {
    iconPath = path.join(process.resourcesPath, 'assets', 'icon.png');
  } else {
    iconPath = path.join(__dirname, '..', '..', '..', 'assets', 'icon.png');
  }

  // Log icon path for debugging
  const exists = fs.existsSync(iconPath);
  log.info(`[icon] Path: ${iconPath}, exists: ${exists}`);

  return iconPath;
}

function loadChromeEntry(window, chromePackage, initialUrl) {
  const packageUrl = getChromePackageEntryUrl(chromePackage);
  if (packageUrl) {
    return window.loadURL(packageUrl);
  }

  if (chromePackage.kind === 'bundled' && initialUrl) {
    return window.loadFile(chromePackage.entryPath, { query: { initialUrl } });
  }

  return window.loadFile(chromePackage.entryPath);
}

function createBundledFallbackPackage(fallback) {
  return {
    ...BUNDLED_CHROME_PACKAGE,
    fallback,
  };
}

function getPackageReadyTimeoutMs() {
  const configured = Number(process.env.FREEDOM_CHROME_PACKAGE_READY_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return 5000;
}

function getPackageGuestPreloadPath() {
  return path.join(__dirname, '..', 'webview-preload.js');
}

function getSurfaceRailPreloadPath() {
  return path.join(__dirname, '..', 'surface-rail-preload.js');
}

function getSurfaceRailHtmlPath() {
  return path.join(__dirname, '..', 'surface-rail.html');
}

function getShellCanvasPreloadPath() {
  return path.join(__dirname, '..', 'shell-canvas-preload.js');
}

function getShellCanvasHtmlPath() {
  return path.join(__dirname, '..', 'shell-canvas.html');
}

function packageAllowsGuestWebviews(chromePackage) {
  return (
    chromePackage.kind === 'local-package' &&
    (chromePackage.guestContent?.webviews === true ||
      chromePackage.webviews === true ||
      chromePackage.transitionalWebviews === true)
  );
}

function getChromeWindowWebPreferences(chromePackage) {
  const isLocalPackage = chromePackage.kind === 'local-package';
  return {
    preload: chromePackage.preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: isLocalPackage
      ? packageAllowsGuestWebviews(chromePackage)
      : chromePackage.webviewTag === true,
    enableRemoteModule: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
  };
}

function createChromeCompositorView(chromePackage) {
  return new WebContentsView({
    webPreferences: getChromeWindowWebPreferences(chromePackage),
  });
}

function getShellCanvasWebPreferences() {
  return {
    preload: getShellCanvasPreloadPath(),
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
  };
}

function createShellCanvasView() {
  const view = new WebContentsView({
    webPreferences: getShellCanvasWebPreferences(),
  });
  view.webContents.loadFile(getShellCanvasHtmlPath()).catch((error) => {
    log.warn('[shell-canvas] failed to load shell canvas', {
      message: error?.message || String(error),
    });
  });
  return view;
}

function getSurfaceRailWebPreferences() {
  return {
    preload: getSurfaceRailPreloadPath(),
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
  };
}

function createSurfaceRailView() {
  const view = new WebContentsView({
    webPreferences: getSurfaceRailWebPreferences(),
  });
  view.webContents.loadFile(getSurfaceRailHtmlPath()).catch((error) => {
    log.warn('[surface-rail] failed to load shell rail', {
      message: error?.message || String(error),
    });
  });
  return view;
}

function enforcePackageGuestWebPreferences(webPreferences = {}) {
  Object.assign(webPreferences, {
    preload: getPackageGuestPreloadPath(),
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
  return webPreferences;
}

function sanitizePackageGuestWebviewParams(params = {}) {
  if (!params || typeof params !== 'object') {
    return {};
  }

  delete params.preload;
  delete params.preloadURL;
  delete params.webpreferences;
  delete params.webPreferences;
  delete params.nodeintegration;
  delete params.nodeIntegration;
  delete params.nodeintegrationinsubframes;
  delete params.nodeIntegrationInSubFrames;
  delete params.disablewebsecurity;
  delete params.disableWebSecurity;
  delete params.allowpopups;
  delete params.allowPopups;
  return params;
}

function getPackageWebContents(target) {
  if (!target) {
    return null;
  }
  if (typeof target.on === 'function') {
    return target;
  }
  return target.webContents || null;
}

function registerPackageWebviewSecurity(target, chromePackage) {
  if (!packageAllowsGuestWebviews(chromePackage)) {
    return () => {};
  }

  const webContents = getPackageWebContents(target);
  if (!webContents) {
    return () => {};
  }
  const handler = (_event, webPreferences, params) => {
    sanitizePackageGuestWebviewParams(params);
    enforcePackageGuestWebPreferences(webPreferences);
  };
  webContents.on('will-attach-webview', handler);
  return () => {
    if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
      return;
    }
    webContents.removeListener?.('will-attach-webview', handler);
  };
}

function findShellWindowForSurfaceRailSender(sender) {
  for (const window of mainWindows) {
    if (!window || window.isDestroyed?.()) {
      continue;
    }
    const shellWindow = window.__freedomShellWindow || null;
    if (shellWindow?.getSurfaceRailWebContents?.() === sender) {
      return { window, shellWindow };
    }
  }
  return null;
}

function findShellWindowForCanvasSender(sender) {
  for (const window of mainWindows) {
    if (!window || window.isDestroyed?.()) {
      continue;
    }
    const shellWindow = window.__freedomShellWindow || null;
    if (shellWindow?.getCanvasWebContents?.() === sender) {
      return { window, shellWindow };
    }
  }
  return null;
}

function normalizeRailSurface(surface) {
  return surface === 'wallet' ? surface : null;
}

async function captureBrowserAppSnapshot(shellWindow) {
  const webContents = shellWindow?.getChromeWebContents?.() || null;
  if (!webContents || webContents.isDestroyed?.()) {
    return null;
  }
  if (typeof webContents.capturePage !== 'function') {
    return null;
  }
  try {
    const image = await webContents.capturePage();
    const thumbnail =
      image && typeof image.resize === 'function'
        ? image.resize({ width: 360 })
        : image;
    if (thumbnail && typeof thumbnail.toDataURL === 'function') {
      return thumbnail.toDataURL();
    }
  } catch (error) {
    log.warn('[shell-apps] failed to capture browser app snapshot', {
      message: error?.message || String(error),
    });
  }
  return null;
}

async function showShellAppLauncher(shellWindow) {
  const snapshotDataUrl = await captureBrowserAppSnapshot(shellWindow);
  const canvasState = shellWindow.showAppLauncher?.({
    snapshotDataUrl,
  }) || null;
  return {
    ok: true,
    app: 'launcher',
    canvasState,
  };
}

async function setSurfaceOpenForShellRail(shellWindow, window, surface, open) {
  if (surface !== 'wallet') {
    return {
      ok: false,
      surface,
      owner: 'shell',
      trusted: true,
      error: {
        code: 'SURFACE_RAIL_SURFACE_UNSUPPORTED',
        message: 'Unsupported shell surface',
      },
    };
  }

  const result = open
    ? await trustedWalletSurface.openTrustedWalletSurface({
        ownerWindow: window,
        caller: {
          packageId: 'freedom.shell.surface-rail',
          name: 'Freedom Shell',
          source: 'shell',
        },
        onClosed: () => {
          shellWindow.updateSurfaceRailState?.({ surface, open: false });
        },
      })
    : trustedWalletSurface.closeTrustedWalletSurface();

  if (result?.ok === true) {
    shellWindow.updateSurfaceRailState?.({ surface, open });
  }

  return {
    ...result,
    open: result?.ok === true ? open : false,
  };
}

async function handleSurfaceRailCommand(event, request = {}) {
  const match = findShellWindowForSurfaceRailSender(event?.sender || null);
  if (!match) {
    return {
      ok: false,
      error: {
        code: 'SURFACE_RAIL_UNAUTHORIZED',
        message: 'Surface rail command came from an unauthorized sender',
      },
    };
  }

  const { window, shellWindow } = match;
  const command = typeof request?.command === 'string' ? request.command : '';
  const currentRailState = shellWindow.getSurfaceRailState?.() || {};
  if (command === 'sync-state') {
    return {
      ok: true,
      railState: currentRailState,
    };
  }

  if (command === 'show-launcher') {
    const state = await showShellAppLauncher(shellWindow);
    return {
      ...state,
      railState: shellWindow.getSurfaceRailState?.() || currentRailState,
    };
  }

  let surface = null;
  let open = true;
  if (command === 'toggle-last-surface') {
    surface = normalizeRailSurface(
      currentRailState.activeSurface || currentRailState.lastActiveSurface || 'wallet'
    );
    open = !currentRailState.activeSurface;
  } else if (command === 'open-surface') {
    surface = normalizeRailSurface(request?.payload?.surface);
    open = true;
  }

  if (!surface) {
    return {
      ok: false,
      railState: currentRailState,
      error: {
        code: 'SURFACE_RAIL_COMMAND_UNSUPPORTED',
        message: 'Unsupported surface rail command',
      },
    };
  }

  const chromeWebContents = shellWindow.getChromeWebContents?.() || null;
  const state = chromeWebContents
    ? await setSurfaceOpenForPackageWebContents(
        chromeWebContents,
        { surface },
        open,
        { ownerWindow: window }
      )
    : await setSurfaceOpenForShellRail(shellWindow, window, surface, open);
  return {
    ...state,
    railState: shellWindow.getSurfaceRailState?.() || currentRailState,
  };
}

async function handleShellCanvasCommand(event, request = {}) {
  const match = findShellWindowForCanvasSender(event?.sender || null);
  if (!match) {
    return {
      ok: false,
      error: {
        code: 'SHELL_CANVAS_UNAUTHORIZED',
        message: 'Shell canvas command came from an unauthorized sender',
      },
    };
  }

  const { window, shellWindow } = match;
  const command = typeof request?.command === 'string' ? request.command : '';
  if (command === 'sync-state') {
    return {
      ok: true,
      canvasState: shellWindow.getCanvasState?.() || null,
    };
  }

  if (command === 'activate-app') {
    const appId = typeof request?.payload?.app === 'string' ? request.payload.app : '';
    if (appId !== 'browser') {
      return {
        ok: false,
        error: {
          code: 'SHELL_APP_UNSUPPORTED',
          message: 'Unsupported shell app',
        },
      };
    }
    return {
      ok: true,
      app: appId,
      canvasState: shellWindow.restoreBrowserApp?.(appId) || null,
    };
  }

  if (command !== 'launch-app') {
    return {
      ok: false,
      error: {
        code: 'SHELL_CANVAS_COMMAND_UNSUPPORTED',
        message: 'Unsupported shell canvas command',
      },
    };
  }

  const appId = typeof request?.payload?.app === 'string' ? request.payload.app : '';
  if (appId !== 'browser') {
    return {
      ok: false,
      error: {
        code: 'SHELL_APP_UNSUPPORTED',
        message: 'Unsupported shell app',
      },
    };
  }

  if (typeof window.__freedomLaunchShellApp !== 'function') {
    return {
      ok: false,
      error: {
        code: 'SHELL_APP_LAUNCH_UNAVAILABLE',
        message: 'Shell app launcher is unavailable',
      },
    };
  }

  return window.__freedomLaunchShellApp(appId);
}

function ensureSurfaceRailIpcRegistered() {
  if (surfaceRailIpcRegistered) {
    return;
  }
  ipcMain.handle(IPC.SHELL_SURFACE_RAIL_COMMAND, handleSurfaceRailCommand);
  surfaceRailIpcRegistered = true;
}

function ensureShellCanvasIpcRegistered() {
  if (shellCanvasIpcRegistered) {
    return;
  }
  ipcMain.handle(IPC.SHELL_CANVAS_COMMAND, handleShellCanvasCommand);
  shellCanvasIpcRegistered = true;
}

function createMainWindow(initialUrl = null, options = {}) {
  ensureSurfaceRailIpcRegistered();
  ensureShellCanvasIpcRegistered();
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  // Linux only: tab strip doubles as the titlebar unless the user opted out.
  // `frame` can't change on a live window, so this is read once at creation.
  const linuxFrameless = isLinux && settingsStore.loadSettings().tabsInTitlebar !== false;
  const packageStoreRoot =
    options.packageStoreRoot || getChromePackageStoreRoot({ userDataDir: app.getPath('userData') });
  const chromePackage =
    options.chromePackage ||
    selectChromePackage({
      logger: log,
      storeRoot: packageStoreRoot,
    });
  setActiveChromePackage(chromePackage);

  // Headless E2E: keep the window hidden so a local test run doesn't pop a
  // window or steal focus. The renderer still loads and is fully driveable via
  // Playwright (DOM/JS), it just never paints to screen.
  const hideWindow = process.env.FREEDOM_TEST_HIDE_WINDOW === '1';

  const useShellCompositor = shouldUseShellWindowCompositor(chromePackage);
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Freedom',
    show: !hideWindow,
    backgroundColor: '#1f2020',
    // Set icon for Linux/Windows (macOS uses the app bundle icon)
    // Also hide the menu bar on Windows/Linux
    ...(!isMac && {
      icon: getIconPath(),
      autoHideMenuBar: true,
    }),
    // macOS: use hidden inset title bar with custom traffic light position
    ...(isMac && {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
    }),
    // Linux: drop the OS frame so the in-app tab strip is the titlebar
    ...(linuxFrameless && { frame: false }),
    webPreferences: useShellCompositor
      ? getCompositorHostWebPreferences()
      : getChromeWindowWebPreferences(chromePackage),
  });

  // Track this window
  mainWindows.add(window);

  const shellWindow = createShellWindow({
    nativeWindow: window,
    chromePackage,
    useChromeView: useShellCompositor,
    createCanvasView: createShellCanvasView,
    createSurfaceRailView,
    shellTheme: settingsStore.getShellTheme(),
  });
  let chromeWebContents = shellWindow.chromeWebContents;
  let chromeLoadTarget = shellWindow.chromeLoadTarget;

  let recoveredFromPackageLoadFailure = false;
  let browserAppLaunching = false;
  let cleanupShellThemeUpdates = () => {};
  let cleanupPackageReadyWait = () => {};
  let cleanupPackageCaller = () => {};
  let cleanupPackageWebviewSecurity = () => {};
  let cleanupChromeLifecycleListeners = () => {};
  const cleanupChromeRuntime = () => {
    cleanupPackageReadyWait();
    cleanupPackageCaller();
    cleanupPackageWebviewSecurity();
    cleanupChromeLifecycleListeners();
    cleanupPackageReadyWait = () => {};
    cleanupPackageCaller = () => {};
    cleanupPackageWebviewSecurity = () => {};
    cleanupChromeLifecycleListeners = () => {};
  };
  if (useShellCompositor) {
    cleanupShellThemeUpdates = settingsStore.onSettingsUpdated((settings) => {
      shellWindow.setShellTheme(settings.shellTheme || settingsStore.getShellTheme(settings));
    });
  }
  const tryPackageRollback = (details = {}) => {
    if (
      chromePackage.kind !== 'local-package' ||
      chromePackage.source !== 'store' ||
      options.packageRecoveryAttempted === true
    ) {
      return null;
    }

    const rollbackResult = rollbackChromePackageStore({
      storeRoot: packageStoreRoot,
      validatePackage: validateLocalChromePackage,
    });
    if (!rollbackResult.ok) {
      log.warn('[chrome-package] package rollback unavailable', {
        code: rollbackResult.error.code,
        message: rollbackResult.error.message,
      });
      return null;
    }

    log.warn('[chrome-package] rolling back cached chrome package after package failure', {
      failedPackageId: chromePackage.packageId,
      failedVersion: chromePackage.version,
      rollbackPackageId: rollbackResult.chromePackage.packageId,
      rollbackVersion: rollbackResult.chromePackage.version,
      reason: details.code || details.message || 'PACKAGE_FAILURE',
    });
    return createMainWindow(initialUrl, {
      chromePackage: rollbackResult.chromePackage,
      packageRecoveryAttempted: true,
      packageStoreRoot,
    });
  };
  const recoverFromPackageLoadFailure = (details = {}) => {
    if (chromePackage.kind !== 'local-package' || recoveredFromPackageLoadFailure) {
      return null;
    }
    recoveredFromPackageLoadFailure = true;
    cleanupChromeRuntime();
    cleanupShellThemeUpdates();
    shellWindow.cleanup();
    const rollbackWindow = tryPackageRollback(details);
    if (rollbackWindow) {
      if (!window.isDestroyed()) {
        window.destroy();
      }
      return rollbackWindow;
    }

    const fallback = {
      requestedDir: chromePackage.packageRoot,
      error: {
        code: details.code || 'ENTRY_LOAD_FAILED',
        message: details.message || details.errorDescription || 'Chrome package entry failed to load',
        url: details.url || details.validatedURL || '',
      },
    };
    log.warn('[chrome-package] falling back to bundled chrome after package failure', fallback.error);
    const replacement = createMainWindow(initialUrl, {
      chromePackage: createBundledFallbackPackage(fallback),
    });
    if (!window.isDestroyed()) {
      window.destroy();
    }
    return replacement;
  };

  const registerChromeLifecycleListeners = (webContents) => {
    if (!webContents) {
      return () => {};
    }
    const handleFailLoad = (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    ) => {
      if (isMainFrame === false) {
        return;
      }
      recoverFromPackageLoadFailure({
        message: `${errorCode}: ${errorDescription}`,
        validatedURL,
      });
    };
    const handleRenderProcessGone = (_event, details) => {
      log.error('[render-process-gone]', details);
      recoverFromPackageLoadFailure({
        code: 'PACKAGE_RENDERER_GONE',
        message: `Chrome package renderer exited: ${details?.reason || 'unknown'}`,
      });
    };
    const handleUnresponsive = () => {
      log.warn('[webcontents] renderer became unresponsive');
    };
    const handleResponsive = () => {
      console.info('[webcontents] renderer responsive again');
    };

    webContents.on('did-fail-load', handleFailLoad);
    webContents.on('render-process-gone', handleRenderProcessGone);
    webContents.on('unresponsive', handleUnresponsive);
    webContents.on('responsive', handleResponsive);

    return () => {
      if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
        return;
      }
      webContents.removeListener?.('did-fail-load', handleFailLoad);
      webContents.removeListener?.('render-process-gone', handleRenderProcessGone);
      webContents.removeListener?.('unresponsive', handleUnresponsive);
      webContents.removeListener?.('responsive', handleResponsive);
    };
  };

  const startPackageReadyWait = (webContents) => {
    if (chromePackage.kind !== 'local-package') {
      return;
    }
    cleanupPackageCaller = registerPackageWebContents(webContents, chromePackage);
    const readyTimeout = setTimeout(() => {
      recoverFromPackageLoadFailure({
        code: 'PACKAGE_READY_TIMEOUT',
        message: 'Chrome package did not signal readiness',
      });
    }, getPackageReadyTimeoutMs());

    const disposePackageReady = onPackageReady(({ sender }) => {
      if (sender !== webContents) {
        return;
      }
      cleanupPackageReadyWait();
      browserAppLaunching = false;
      shellWindow.setBrowserAppState?.({
        status: 'running',
        error: null,
      });
      log.info('[chrome-package] local package signaled readiness', {
        packageId: chromePackage.packageId,
      });
    });

    cleanupPackageReadyWait = () => {
      clearTimeout(readyTimeout);
      disposePackageReady();
      cleanupPackageReadyWait = () => {};
    };
  };

  const registerChromeRuntime = (webContents) => {
    cleanupChromeRuntime();
    cleanupPackageWebviewSecurity = registerPackageWebviewSecurity(webContents, chromePackage);
    cleanupChromeLifecycleListeners = registerChromeLifecycleListeners(webContents);
    startPackageReadyWait(webContents);
  };

  const launchBrowserApp = async () => {
    if (!useShellCompositor) {
      return {
        ok: true,
        app: 'browser',
        alreadyRunning: true,
      };
    }

    const existingChrome = shellWindow.getChromeWebContents?.() || chromeWebContents;
    if (existingChrome && !existingChrome.isDestroyed?.()) {
      shellWindow.restoreBrowserApp?.('browser');
      return {
        ok: true,
        app: 'browser',
        alreadyRunning: true,
      };
    }
    if (browserAppLaunching) {
      return {
        ok: true,
        app: 'browser',
        launching: true,
      };
    }

    browserAppLaunching = true;
    shellWindow.setBrowserAppState?.({
      status: 'launching',
      error: null,
    });

    try {
      const chromeView = createChromeCompositorView(chromePackage);
      shellWindow.attachChromeView(chromeView);
      chromeWebContents = shellWindow.chromeWebContents;
      chromeLoadTarget = shellWindow.chromeLoadTarget;
      registerChromeRuntime(chromeWebContents);
      const loadPromise = loadChromeEntry(chromeLoadTarget, chromePackage, initialUrl);
      if (loadPromise && typeof loadPromise.then === 'function') {
        await loadPromise;
      }
      return {
        ok: true,
        app: 'browser',
        status: 'launching',
      };
    } catch (error) {
      browserAppLaunching = false;
      const message = error?.message || String(error);
      shellWindow.setBrowserAppState?.({
        status: 'failed',
        error: message,
      });
      recoverFromPackageLoadFailure({ message });
      return {
        ok: false,
        app: 'browser',
        error: {
          code: 'SHELL_APP_LAUNCH_FAILED',
          message,
        },
      };
    }
  };

  window.__freedomLaunchShellApp = (appId) => {
    if (appId !== 'browser') {
      return {
        ok: false,
        error: {
          code: 'SHELL_APP_UNSUPPORTED',
          message: 'Unsupported shell app',
        },
      };
    }
    return launchBrowserApp();
  };

  window.on('ready-to-show', () => {
    window.setTitle(currentWindowTitle);
  });

  window.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle(currentWindowTitle);
  });

  window.on('closed', () => {
    cleanupChromeRuntime();
    cleanupShellThemeUpdates();
    shellWindow.cleanup();
    delete window.__freedomLaunchShellApp;
    mainWindows.delete(window);
  });


  // Close renderer menus when window loses focus (e.g., clicking system menu)
  window.on('blur', () => {
    const currentChromeWebContents = shellWindow.getChromeWebContents?.() || chromeWebContents;
    if (!currentChromeWebContents || currentChromeWebContents.isDestroyed?.()) {
      return;
    }
    const delivery = emitShellEventToPackageWebContents(
      currentChromeWebContents,
      SHELL_API_EVENTS.CHROME_CLOSE_MENUS_REQUESTED
    );
    if (delivery.reason === 'not-package') {
      currentChromeWebContents.send('menus:close');
    }
  });

  if (useShellCompositor) {
    if (initialUrl) {
      launchBrowserApp().catch((error) => {
        recoverFromPackageLoadFailure({ message: error?.message || String(error) });
      });
    }
  } else {
    registerChromeRuntime(chromeWebContents);
    const loadPromise = loadChromeEntry(chromeLoadTarget, chromePackage, initialUrl);
    if (loadPromise && typeof loadPromise.catch === 'function') {
      loadPromise.catch((error) => {
        recoverFromPackageLoadFailure({ message: error?.message || String(error) });
      });
    }
  }

  return window;
}

function focusBrowserWindow(window) {
  if (!window || window.isDestroyed()) {
    return false;
  }

  if (window.isMinimized()) {
    window.restore();
  }
  if (!window.isVisible()) {
    window.show();
  }

  try {
    if (process.platform === 'darwin' && app.focus) {
      app.focus({ steal: true });
    }
  } catch {
    // Best-effort only; BrowserWindow.focus() below is the real fallback.
  }

  window.focus();
  return true;
}

function focusOrCreateMainWindow(initialUrl = null) {
  let window = [...mainWindows].find((candidate) => !candidate.isDestroyed());
  if (!window) {
    window = createMainWindow(initialUrl);
  }
  focusBrowserWindow(window);
  return window;
}

function setWindowTitle(title) {
  currentWindowTitle = title;
}

function getWindowTitle() {
  return currentWindowTitle;
}

// Check if a window is one of our main browser windows
function isMainBrowserWindow(window) {
  return window && mainWindows.has(window);
}

// Get all main browser windows
function getMainWindows() {
  return [...mainWindows];
}

module.exports = {
  createMainWindow,
  enforcePackageGuestWebPreferences,
  getPackageGuestPreloadPath,
  registerPackageWebviewSecurity,
  sanitizePackageGuestWebviewParams,
  getChromeWindowWebPreferences,
  getShellCanvasPreloadPath,
  getShellCanvasWebPreferences,
  getSurfaceRailPreloadPath,
  getSurfaceRailWebPreferences,
  loadChromeEntry,
  focusOrCreateMainWindow,
  setWindowTitle,
  getWindowTitle,
  isMainBrowserWindow,
  getMainWindows,
};
