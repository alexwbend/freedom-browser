const log = require('../logger');
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  BUNDLED_CHROME_PACKAGE,
  selectChromePackage,
  setActiveChromePackage,
} = require('../chrome-package');

let currentWindowTitle = 'Freedom';

// Track all main browser windows we create
const mainWindows = new Set();

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

function createMainWindow(initialUrl = null, options = {}) {
  const isMac = process.platform === 'darwin';
  const chromePackage = options.chromePackage || selectChromePackage({ logger: log });
  setActiveChromePackage(chromePackage);

  // Headless E2E: keep the window hidden so a local test run doesn't pop a
  // window or steal focus. The renderer still loads and is fully driveable via
  // Playwright (DOM/JS), it just never paints to screen.
  const hideWindow = process.env.FREEDOM_TEST_HIDE_WINDOW === '1';

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
    webPreferences: {
      preload: chromePackage.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: chromePackage.webviewTag === true,
      enableRemoteModule: false,
    },
  });

  // Track this window
  mainWindows.add(window);

  let recoveredFromPackageLoadFailure = false;
  const recoverFromPackageLoadFailure = (details = {}) => {
    if (chromePackage.kind !== 'local-package' || recoveredFromPackageLoadFailure) {
      return null;
    }
    recoveredFromPackageLoadFailure = true;
    const fallback = {
      requestedDir: chromePackage.packageRoot,
      error: {
        code: 'ENTRY_LOAD_FAILED',
        message: details.message || details.errorDescription || 'Chrome package entry failed to load',
        url: details.url || details.validatedURL || '',
      },
    };
    log.warn('[chrome-package] falling back to bundled chrome after load failure', fallback.error);
    const replacement = createMainWindow(initialUrl, {
      chromePackage: createBundledFallbackPackage(fallback),
    });
    if (!window.isDestroyed()) {
      window.destroy();
    }
    return replacement;
  };

  // Load bundled chrome with optional initial URL. Local package chrome gets
  // only its manifest entry; persisted activation/launch parameters are out of
  // scope for the dev-only v0 runtime.
  const loadPromise = loadChromeEntry(window, chromePackage, initialUrl);
  if (loadPromise && typeof loadPromise.catch === 'function') {
    loadPromise.catch((error) => {
      recoverFromPackageLoadFailure({ message: error?.message || String(error) });
    });
  }

  window.on('ready-to-show', () => {
    window.setTitle(currentWindowTitle);
  });

  window.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle(currentWindowTitle);
  });

  window.on('closed', () => {
    mainWindows.delete(window);
  });


  // Close renderer menus when window loses focus (e.g., clicking system menu)
  window.on('blur', () => {
    window.webContents.send('menus:close');
  });

  const wc = window.webContents;
  if (wc) {
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame === false) {
        return;
      }
      recoverFromPackageLoadFailure({
        message: `${errorCode}: ${errorDescription}`,
        validatedURL,
      });
    });
    wc.on('render-process-gone', (_event, details) => {
      log.error('[render-process-gone]', details);
    });
    wc.on('unresponsive', () => {
      log.warn('[webcontents] renderer became unresponsive');
    });
    wc.on('responsive', () => {
      console.info('[webcontents] renderer responsive again');
    });
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
  focusOrCreateMainWindow,
  setWindowTitle,
  getWindowTitle,
  isMainBrowserWindow,
  getMainWindows,
};
