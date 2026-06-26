const { EventEmitter } = require('events');

const SHELL_WINDOW_COMPOSITOR_MODE = 'webcontents-view-compositor';
const SHELL_WINDOW_LEGACY_MODE = 'browser-window-webcontents';
const DEFAULT_SURFACE_WIDTH = 520;
const MIN_SURFACE_WIDTH = 360;
const SURFACE_LAYOUT_MODE_DOCK = 'dock';
const SURFACE_LAYOUT_MODE_OVERLAY = 'overlay';
const DEFAULT_SURFACE_LAYOUT_MODE = SURFACE_LAYOUT_MODE_DOCK;

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

function getSurfaceWidth(windowWidth, preferredWidth = DEFAULT_SURFACE_WIDTH, minWidth = MIN_SURFACE_WIDTH) {
  return Math.min(
    Math.max(minWidth, preferredWidth),
    Math.max(0, windowWidth)
  );
}

function getChromeBoundsForSize({ width, height }, reservedRight = 0) {
  return {
    x: 0,
    y: 0,
    width: Math.max(0, width - reservedRight),
    height: Math.max(0, height),
  };
}

function setChromeViewBoundsForSize(size, view, reservedRight = 0) {
  const bounds = getChromeBoundsForSize(size, reservedRight);
  view.setBounds(bounds);
  return bounds;
}

function normalizeSurfaceLayoutMode(layoutMode) {
  if (layoutMode === SURFACE_LAYOUT_MODE_OVERLAY) {
    return SURFACE_LAYOUT_MODE_OVERLAY;
  }
  return DEFAULT_SURFACE_LAYOUT_MODE;
}

function getRightDrawerBoundsForSize(
  { width, height },
  preferredWidth = DEFAULT_SURFACE_WIDTH,
  minWidth = MIN_SURFACE_WIDTH
) {
  const surfaceWidth = getSurfaceWidth(width, preferredWidth, minWidth);
  const bounds = {
    x: Math.max(0, width - surfaceWidth),
    y: 0,
    width: surfaceWidth,
    height: Math.max(0, height),
  };
  return bounds;
}

function getRightDrawerBounds(window, preferredWidth = DEFAULT_SURFACE_WIDTH, minWidth = MIN_SURFACE_WIDTH) {
  return getRightDrawerBoundsForSize(getWindowContentSize(window), preferredWidth, minWidth);
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
    this.chromeBounds = null;
    this.handleChromeContentsDestroyed = null;
    this.surfaceWindows = new Map();

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
    this.updateChromeBounds = () => {
      this.updateCompositorLayout();
    };
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
      canHostTrustedSurfaceWindows: () => this.mode === SHELL_WINDOW_COMPOSITOR_MODE,
      createTrustedSurfaceWindow: (options) => this.createTrustedSurfaceWindow(options),
      closeTrustedSurfaceWindow: (surface) => this.closeTrustedSurfaceWindow(surface),
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

  updateSurfaceWindowBounds(recordToUpdate = null) {
    this.updateCompositorLayout(recordToUpdate);
  }

  getDockedSurfaceInset(windowWidth) {
    return [...this.surfaceWindows.values()].reduce((maxWidth, record) => {
      if (
        !record ||
        record.closed ||
        record.layoutMode !== SURFACE_LAYOUT_MODE_DOCK
      ) {
        return maxWidth;
      }
      return Math.max(maxWidth, getSurfaceWidth(windowWidth, record.width, record.minWidth));
    }, 0);
  }

  updateCompositorLayout(recordToUpdate = null) {
    if (this.closed || this.nativeWindow.isDestroyed?.()) {
      return;
    }
    const size = getWindowContentSize(this.nativeWindow);
    const dockedInset = this.getDockedSurfaceInset(size.width);
    if (this.chromeView) {
      this.chromeBounds = setChromeViewBoundsForSize(size, this.chromeView, dockedInset);
    }
    const records = recordToUpdate ? [recordToUpdate] : [...this.surfaceWindows.values()];
    records.forEach((record) => {
      if (!record || record.closed) {
        return;
      }
      const bounds = getRightDrawerBoundsForSize(size, record.width, record.minWidth);
      record.view.setBounds(bounds);
      record.bounds = bounds;
    });
  }

  createTrustedSurfaceWindow({
    surface,
    createView,
    width = DEFAULT_SURFACE_WIDTH,
    minWidth = MIN_SURFACE_WIDTH,
    layoutMode = DEFAULT_SURFACE_LAYOUT_MODE,
  } = {}) {
    if (!surface || typeof surface !== 'string') {
      throw new Error('ShellWindow trusted surface requires a surface name');
    }
    if (typeof createView !== 'function') {
      throw new Error('ShellWindow trusted surface requires createView');
    }
    const existing = this.surfaceWindows.get(surface);
    if (existing && !existing.closed) {
      return existing.facade;
    }

    const view = createView();
    if (!view?.webContents) {
      throw new Error('ShellWindow trusted surface view must expose webContents');
    }

    const emitter = new EventEmitter();
    const record = {
      surface,
      view,
      width,
      minWidth,
      layoutMode: normalizeSurfaceLayoutMode(layoutMode),
      bounds: null,
      closed: false,
      emitter,
      facade: null,
      handleDestroyed: null,
      handleReady: null,
      readyEmitted: false,
    };
    record.facade = this.createTrustedSurfaceFacade(record);
    record.handleDestroyed = () => {
      this.disposeTrustedSurfaceWindow(surface, { notifyClosed: true, closeWebContents: false });
    };
    record.handleReady = () => {
      if (record.readyEmitted || record.closed) {
        return;
      }
      record.readyEmitted = true;
      emitter.emit('ready-to-show');
    };

    this.nativeWindow.getContentView().addChildView(view);
    this.surfaceWindows.set(surface, record);
    this.updateSurfaceWindowBounds(record);
    view.webContents.once?.('destroyed', record.handleDestroyed);
    view.webContents.once?.('dom-ready', record.handleReady);
    view.webContents.once?.('did-finish-load', record.handleReady);
    return record.facade;
  }

  createTrustedSurfaceFacade(record) {
    const facade = {
      get webContents() {
        return record.view.webContents;
      },
      getNativeOwnerWindow: () => this.nativeWindow,
      isDestroyed: () =>
        record.closed || record.view.webContents.isDestroyed?.() === true,
      show: () => {
        record.view.setVisible?.(true);
        this.updateSurfaceWindowBounds(record);
        record.handleReady?.();
      },
      focus: () => {
        record.view.webContents.focus?.();
      },
      close: () => this.closeTrustedSurfaceWindow(record.surface),
      loadFile: (...args) => record.view.webContents.loadFile(...args),
      once: (eventName, listener) => {
        record.emitter.once(eventName, listener);
        return facade;
      },
      on: (eventName, listener) => {
        record.emitter.on(eventName, listener);
        return facade;
      },
    };
    return facade;
  }

  closeTrustedSurfaceWindow(surface) {
    const record = this.surfaceWindows.get(surface);
    if (!record || record.closed) {
      return;
    }
    this.disposeTrustedSurfaceWindow(surface, { notifyClosed: true, closeWebContents: true });
  }

  disposeTrustedSurfaceWindow(
    surface,
    { notifyClosed = true, closeWebContents = true } = {}
  ) {
    const record = this.surfaceWindows.get(surface);
    if (!record || record.closed) {
      return;
    }
    record.closed = true;
    removeContentsListener(record.view.webContents, 'destroyed', record.handleDestroyed);
    removeContentsListener(record.view.webContents, 'dom-ready', record.handleReady);
    removeContentsListener(record.view.webContents, 'did-finish-load', record.handleReady);

    try {
      this.nativeWindow.getContentView?.().removeChildView(record.view);
    } catch {
      // The native host may already be destroyed during app shutdown.
    }
    if (closeWebContents) {
      try {
        if (!record.view.webContents.isDestroyed?.()) {
          record.view.webContents.close({ waitForBeforeUnload: false });
        }
      } catch {
        // The trusted surface WebContents may already be gone.
      }
    }

    this.surfaceWindows.delete(surface);
    this.updateCompositorLayout();
    if (notifyClosed) {
      record.emitter.emit('closed');
    }
    record.emitter.removeAllListeners();
  }

  cleanup() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    [...this.surfaceWindows.keys()].forEach((surface) => {
      this.disposeTrustedSurfaceWindow(surface, {
        notifyClosed: true,
        closeWebContents: true,
      });
    });
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
        this.chromeBounds ||
        (this.chromeView && typeof this.chromeView.getBounds === 'function'
          ? this.chromeView.getBounds()
          : null),
      chromeVisible:
        this.chromeView && typeof this.chromeView.getVisible === 'function'
          ? this.chromeView.getVisible()
          : undefined,
      hostWebContentsId: this.nativeWindow.webContents?.id ?? null,
      closed: this.closed,
      surfaces: [...this.surfaceWindows.values()].map((record) => ({
        surface: record.surface,
        layoutMode: record.layoutMode,
        webContentsId: record.view.webContents?.id ?? null,
        url:
          typeof record.view.webContents?.getURL === 'function'
            ? record.view.webContents.getURL()
            : '',
        bounds: record.bounds,
        visible:
          typeof record.view.getVisible === 'function'
            ? record.view.getVisible()
            : undefined,
        closed: record.closed,
      })),
    };
  }
}

function createShellWindow(options) {
  return new ShellWindow(options);
}

module.exports = {
  SHELL_WINDOW_COMPOSITOR_MODE,
  SHELL_WINDOW_LEGACY_MODE,
  SURFACE_LAYOUT_MODE_DOCK,
  SURFACE_LAYOUT_MODE_OVERLAY,
  ShellWindow,
  createShellWindow,
  getRightDrawerBounds,
  getCompositorHostWebPreferences,
  shouldUseShellWindowCompositor,
};
