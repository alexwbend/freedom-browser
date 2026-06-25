const SHELL_WINDOW_COMPOSITOR_MODE = 'webcontents-view-compositor';
const SHELL_WINDOW_LEGACY_MODE = 'browser-window-webcontents';

function getCompositorHostWebPreferences() {
  return {
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

function shouldUseShellWindowCompositor(chromePackage) {
  return chromePackage?.kind === 'local-package';
}

function getWindowContentSize(window) {
  if (typeof window.getContentSize === 'function') {
    const [width, height] = window.getContentSize();
    return { width, height };
  }
  if (typeof window.getContentBounds === 'function') {
    const bounds = window.getContentBounds();
    return { width: bounds.width, height: bounds.height };
  }
  return { width: 0, height: 0 };
}

function setViewToWindowBounds(window, view) {
  const { width, height } = getWindowContentSize(window);
  const bounds = {
    x: 0,
    y: 0,
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
  view.setBounds(bounds);
  return bounds;
}

function removeWindowListener(window, eventName, listener) {
  if (typeof window.off === 'function') {
    window.off(eventName, listener);
  } else if (typeof window.removeListener === 'function') {
    window.removeListener(eventName, listener);
  }
}

function removeContentsListener(contents, eventName, listener) {
  if (typeof contents.off === 'function') {
    contents.off(eventName, listener);
  } else if (typeof contents.removeListener === 'function') {
    contents.removeListener(eventName, listener);
  }
}

class ShellWindow {
  constructor({
    nativeWindow,
    chromePackage,
    useChromeView = false,
    createChromeView = null,
  } = {}) {
    if (!nativeWindow) {
      throw new Error('ShellWindow requires a nativeWindow');
    }
    if (useChromeView && typeof createChromeView !== 'function') {
      throw new Error('ShellWindow compositor mode requires createChromeView');
    }

    this.nativeWindow = nativeWindow;
    this.chromePackage = chromePackage || null;
    this.chromeView = null;
    this.chromeWebContents = nativeWindow.webContents || null;
    this.chromeLoadTarget = nativeWindow;
    this.mode = SHELL_WINDOW_LEGACY_MODE;
    this.closed = false;
    this.updateChromeBounds = null;
    this.handleChromeContentsDestroyed = null;

    if (useChromeView) {
      this.attachChromeView(createChromeView(chromePackage));
    }
    this.installDebugHook();
  }

  attachChromeView(chromeView) {
    if (!chromeView?.webContents) {
      throw new Error('ShellWindow chrome view must expose webContents');
    }
    this.chromeView = chromeView;
    this.chromeWebContents = chromeView.webContents;
    this.chromeLoadTarget = chromeView.webContents;
    this.mode = SHELL_WINDOW_COMPOSITOR_MODE;
    this.updateChromeBounds = () => setViewToWindowBounds(this.nativeWindow, chromeView);
    this.handleChromeContentsDestroyed = () => {
      if (this.closed || this.nativeWindow.isDestroyed?.()) {
        return;
      }
      this.nativeWindow.close?.();
    };

    this.nativeWindow.getContentView().addChildView(chromeView);
    this.updateChromeBounds();
    this.nativeWindow.on?.('resize', this.updateChromeBounds);
    this.nativeWindow.on?.('resized', this.updateChromeBounds);
    this.nativeWindow.on?.('enter-full-screen', this.updateChromeBounds);
    this.nativeWindow.on?.('leave-full-screen', this.updateChromeBounds);
    chromeView.webContents.once?.('destroyed', this.handleChromeContentsDestroyed);
  }

  installDebugHook() {
    this.nativeWindow.__freedomShellWindow = {
      getDebugState: () => this.getDebugState(),
      getChromeWebContents: () => this.chromeWebContents,
    };
  }

  removeChromeViewListeners() {
    if (!this.updateChromeBounds) {
      return;
    }
    removeWindowListener(this.nativeWindow, 'resize', this.updateChromeBounds);
    removeWindowListener(this.nativeWindow, 'resized', this.updateChromeBounds);
    removeWindowListener(this.nativeWindow, 'enter-full-screen', this.updateChromeBounds);
    removeWindowListener(this.nativeWindow, 'leave-full-screen', this.updateChromeBounds);
    this.updateChromeBounds = null;
  }

  removeChromeContentsListeners() {
    if (!this.chromeView || !this.handleChromeContentsDestroyed) {
      return;
    }
    removeContentsListener(
      this.chromeView.webContents,
      'destroyed',
      this.handleChromeContentsDestroyed
    );
    this.handleChromeContentsDestroyed = null;
  }

  cleanup() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.removeChromeViewListeners();
    this.removeChromeContentsListeners();
    delete this.nativeWindow.__freedomShellWindow;

    if (!this.chromeView) {
      return;
    }
    try {
      this.nativeWindow.getContentView?.().removeChildView(this.chromeView);
    } catch {
      // The native host may already be destroyed during app shutdown.
    }
    try {
      if (!this.chromeView.webContents.isDestroyed?.()) {
        this.chromeView.webContents.close({ waitForBeforeUnload: false });
      }
    } catch {
      // The chrome WebContents may already be gone.
    }
  }

  getDebugState() {
    const chromeWebContents = this.chromeWebContents || null;
    return {
      mode: this.mode,
      packageId: this.chromePackage?.packageId || null,
      packageKind: this.chromePackage?.kind || null,
      chromeWebContentsId: chromeWebContents?.id ?? null,
      chromeUrl:
        typeof chromeWebContents?.getURL === 'function'
          ? chromeWebContents.getURL()
          : '',
      chromeBounds:
        this.chromeView && typeof this.chromeView.getBounds === 'function'
          ? this.chromeView.getBounds()
          : null,
      chromeVisible:
        this.chromeView && typeof this.chromeView.getVisible === 'function'
          ? this.chromeView.getVisible()
          : undefined,
      hostWebContentsId: this.nativeWindow.webContents?.id ?? null,
      closed: this.closed,
    };
  }
}

function createShellWindow(options) {
  return new ShellWindow(options);
}

module.exports = {
  SHELL_WINDOW_COMPOSITOR_MODE,
  SHELL_WINDOW_LEGACY_MODE,
  ShellWindow,
  createShellWindow,
  getCompositorHostWebPreferences,
  shouldUseShellWindowCompositor,
};
