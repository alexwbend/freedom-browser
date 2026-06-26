const { EventEmitter } = require('events');

const SHELL_WINDOW_COMPOSITOR_MODE = 'webcontents-view-compositor';
const SHELL_WINDOW_LEGACY_MODE = 'browser-window-webcontents';
const DEFAULT_SURFACE_WIDTH = 520;
const MIN_SURFACE_WIDTH = 360;
const SURFACE_LAYOUT_MODE_DOCK = 'dock';
const SURFACE_LAYOUT_MODE_OVERLAY = 'overlay';
const DEFAULT_SURFACE_LAYOUT_MODE = SURFACE_LAYOUT_MODE_DOCK;
const COMPOSITOR_PANEL_GAP = 8;
const COMPOSITOR_PANEL_RADIUS = 12;
const COMPOSITOR_BACKGROUND_COLOR = '#101010';

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

function getCompositorRootBounds({ width, height }) {
  return {
    x: 0,
    y: 0,
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
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
  const rootBounds = getCompositorRootBounds({ width, height });
  const surfaceWidth = getSurfaceWidth(rootBounds.width, preferredWidth, minWidth);
  const bounds = {
    x: rootBounds.x + Math.max(0, rootBounds.width - surfaceWidth),
    y: rootBounds.y,
    width: surfaceWidth,
    height: rootBounds.height,
  };
  return bounds;
}

function isDockedSurfaceRecord(record) {
  return (
    record &&
    !record.closed &&
    record.layoutMode === SURFACE_LAYOUT_MODE_DOCK
  );
}

function getCompositorTileLayout(size, surfaceRecords = []) {
  const rootBounds = getCompositorRootBounds(size);
  const dockedRecords = surfaceRecords.filter(isDockedSurfaceRecord);
  const surfaceBoundsByRecord = new Map();
  let nextRightEdge = rootBounds.x + rootBounds.width;

  // Tile docked right surfaces from the outside in. The root itself has no
  // padding; the compositor inserts gutters only between adjacent tiles.
  dockedRecords.forEach((record) => {
    const preferredSurfaceWidth = getSurfaceWidth(
      rootBounds.width,
      record.width,
      record.minWidth
    );
    const surfaceWidth = Math.min(preferredSurfaceWidth, Math.max(0, nextRightEdge));
    const x = Math.max(rootBounds.x, nextRightEdge - surfaceWidth);
    surfaceBoundsByRecord.set(record, {
      x,
      y: rootBounds.y,
      width: Math.max(0, nextRightEdge - x),
      height: rootBounds.height,
    });
    nextRightEdge = Math.max(rootBounds.x, x - COMPOSITOR_PANEL_GAP);
  });

  return {
    rootBounds,
    chromeBounds: {
      x: rootBounds.x,
      y: rootBounds.y,
      width: Math.max(0, nextRightEdge - rootBounds.x),
      height: rootBounds.height,
    },
    surfaceBoundsByRecord,
    hasDockedTiles: dockedRecords.length > 0,
  };
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

function setViewBackgroundColor(view, color) {
  if (typeof view?.setBackgroundColor !== 'function') {
    return;
  }
  try {
    view.setBackgroundColor(color);
  } catch {
    // Older or platform-specific native views may reject styling operations.
  }
}

function setViewBorderRadius(view, radius = COMPOSITOR_PANEL_RADIUS) {
  if (typeof view?.setBorderRadius !== 'function') {
    return;
  }
  try {
    view.setBorderRadius(radius);
  } catch {
    // Keep compositor layout functional even if the native view cannot clip.
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
    setViewBackgroundColor(this.nativeWindow.getContentView?.(), COMPOSITOR_BACKGROUND_COLOR);
    setViewBorderRadius(chromeView);
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

  updateCompositorLayout(recordToUpdate = null) {
    if (this.closed || this.nativeWindow.isDestroyed?.()) {
      return;
    }
    const size = getWindowContentSize(this.nativeWindow);
    const allRecords = [...this.surfaceWindows.values()];
    const tileLayout = getCompositorTileLayout(size, allRecords);
    if (this.chromeView) {
      this.chromeView.setBounds(tileLayout.chromeBounds);
      this.chromeBounds = tileLayout.chromeBounds;
      setViewBorderRadius(
        this.chromeView,
        tileLayout.hasDockedTiles ? COMPOSITOR_PANEL_RADIUS : 0
      );
    }
    const records = recordToUpdate ? [recordToUpdate] : allRecords;
    records.forEach((record) => {
      if (!record || record.closed) {
        return;
      }
      const bounds =
        tileLayout.surfaceBoundsByRecord.get(record) ||
        getRightDrawerBoundsForSize(size, record.width, record.minWidth);
      record.view.setBounds(bounds);
      setViewBorderRadius(record.view, COMPOSITOR_PANEL_RADIUS);
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
      layout: {
        outerMargin: 0,
        gap: COMPOSITOR_PANEL_GAP,
        radius: COMPOSITOR_PANEL_RADIUS,
        backgroundColor: COMPOSITOR_BACKGROUND_COLOR,
      },
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
