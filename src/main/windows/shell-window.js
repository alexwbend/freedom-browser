const { EventEmitter } = require('events');
const IPC = require('../../shared/ipc-channels');

const SHELL_WINDOW_COMPOSITOR_MODE = 'webcontents-view-compositor';
const SHELL_WINDOW_LEGACY_MODE = 'browser-window-webcontents';
const DEFAULT_SURFACE_WIDTH = 520;
const MIN_SURFACE_WIDTH = 360;
const SURFACE_LAYOUT_MODE_DOCK = 'dock';
const SURFACE_LAYOUT_MODE_OVERLAY = 'overlay';
const DEFAULT_SURFACE_LAYOUT_MODE = SURFACE_LAYOUT_MODE_DOCK;
const COMPOSITOR_PANEL_GAP = 4;
const COMPOSITOR_PANEL_RADIUS = 12;
const COMPOSITOR_RAIL_WIDTH = 44;
const COMPOSITOR_VIEW_TRANSPARENT_BACKGROUND_COLOR = '#00000000';
const COMPOSITOR_ANIMATION_DURATION_MS = 180;
const COMPOSITOR_ANIMATION_FRAME_MS = 16;
const DEFAULT_SURFACE_RAIL_SURFACE = 'wallet';
const SHELL_CANVAS_THEME_DARK = 'dark';
const SHELL_CANVAS_THEME_LIGHT = 'light';
const COMPOSITOR_CANVAS_COLORS = Object.freeze({
  [SHELL_CANVAS_THEME_DARK]: '#4b524b',
  [SHELL_CANVAS_THEME_LIGHT]: '#b6afa1',
});
const DEFAULT_SHELL_THEME = Object.freeze({
  mode: 'system',
  effective: 'light',
});

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

function normalizeAnimationDurationMs(durationMs, fallback = COMPOSITOR_ANIMATION_DURATION_MS) {
  if (Number.isFinite(durationMs) && durationMs >= 0) {
    return durationMs;
  }
  return fallback;
}

function normalizeAnimationFrameMs(frameMs, fallback = COMPOSITOR_ANIMATION_FRAME_MS) {
  if (Number.isFinite(frameMs) && frameMs > 0) {
    return frameMs;
  }
  return fallback;
}

function normalizeSurfaceLayoutMode(layoutMode) {
  if (layoutMode === SURFACE_LAYOUT_MODE_OVERLAY) {
    return SURFACE_LAYOUT_MODE_OVERLAY;
  }
  return DEFAULT_SURFACE_LAYOUT_MODE;
}

function getCanvasThemeForShellTheme(_theme = DEFAULT_SHELL_THEME) {
  return SHELL_CANVAS_THEME_DARK;
}

function getCanvasBackgroundColor(canvasTheme = SHELL_CANVAS_THEME_DARK) {
  return COMPOSITOR_CANVAS_COLORS[canvasTheme] || COMPOSITOR_CANVAS_COLORS.dark;
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

function getHiddenRightDrawerBoundsForSize(
  { width, height },
  preferredWidth = DEFAULT_SURFACE_WIDTH,
  minWidth = MIN_SURFACE_WIDTH
) {
  const rootBounds = getCompositorRootBounds({ width, height });
  const surfaceWidth = getSurfaceWidth(rootBounds.width, preferredWidth, minWidth);
  return {
    x: rootBounds.x + rootBounds.width,
    y: rootBounds.y,
    width: surfaceWidth,
    height: rootBounds.height,
  };
}

function getOverlaySurfaceWidthPreferences(record) {
  if (record?.layoutMode !== SURFACE_LAYOUT_MODE_OVERLAY) {
    return {
      width: record?.width ?? DEFAULT_SURFACE_WIDTH,
      minWidth: record?.minWidth ?? MIN_SURFACE_WIDTH,
    };
  }
  return {
    width: (record.width ?? DEFAULT_SURFACE_WIDTH) + COMPOSITOR_PANEL_GAP,
    minWidth: (record.minWidth ?? MIN_SURFACE_WIDTH) + COMPOSITOR_PANEL_GAP,
  };
}

function isDockedSurfaceRecord(record) {
  return (
    record &&
    !record.closed &&
    record.visible &&
    !record.closing &&
    record.layoutMode === SURFACE_LAYOUT_MODE_DOCK
  );
}

function getCompositorTileLayout(
  size,
  surfaceRecords = [],
  { railWidth = 0 } = {}
) {
  const rootBounds = getCompositorRootBounds(size);
  const normalizedRailWidth = Math.min(
    Math.max(0, railWidth),
    Math.max(0, rootBounds.width)
  );
  const railBounds = normalizedRailWidth > 0
    ? {
        x: rootBounds.x + Math.max(0, rootBounds.width - normalizedRailWidth),
        y: rootBounds.y,
        width: normalizedRailWidth,
        height: rootBounds.height,
      }
    : null;
  const dockedRecords = surfaceRecords.filter(isDockedSurfaceRecord);
  const surfaceBoundsByRecord = new Map();
  const hasDockedTiles = dockedRecords.length > 0;
  let nextRightEdge = railBounds
    ? railBounds.x - (hasDockedTiles ? 0 : COMPOSITOR_PANEL_GAP)
    : rootBounds.x + rootBounds.width;
  nextRightEdge = Math.max(rootBounds.x, nextRightEdge);

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
    railBounds,
    chromeBounds: {
      x: rootBounds.x,
      y: rootBounds.y,
      width: Math.max(0, nextRightEdge - rootBounds.x),
      height: rootBounds.height,
    },
    surfaceBoundsByRecord,
    hasDockedTiles,
  };
}

function getRightDrawerBounds(window, preferredWidth = DEFAULT_SURFACE_WIDTH, minWidth = MIN_SURFACE_WIDTH) {
  return getRightDrawerBoundsForSize(getWindowContentSize(window), preferredWidth, minWidth);
}

function cloneBounds(bounds) {
  if (!bounds) {
    return null;
  }
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function getCurrentViewBounds(view, fallbackBounds) {
  if (typeof view?.getBounds === 'function') {
    try {
      const bounds = view.getBounds();
      if (bounds) {
        return cloneBounds(bounds);
      }
    } catch {
      // Fall back to the last shell-owned bounds snapshot.
    }
  }
  return cloneBounds(fallbackBounds);
}

function easeOutCubic(progress) {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - Math.pow(1 - clamped, 3);
}

function interpolateNumber(from, to, progress) {
  return Math.round(from + (to - from) * progress);
}

function interpolateBounds(fromBounds, toBounds, progress) {
  return {
    x: interpolateNumber(fromBounds.x, toBounds.x, progress),
    y: interpolateNumber(fromBounds.y, toBounds.y, progress),
    width: interpolateNumber(fromBounds.width, toBounds.width, progress),
    height: interpolateNumber(fromBounds.height, toBounds.height, progress),
  };
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

function createCanvasPaneState({ id, bounds, radius }) {
  if (!bounds) {
    return null;
  }
  return {
    id,
    bounds: cloneBounds(bounds),
    radius: Math.max(0, radius || 0),
  };
}

class ShellWindow {
  constructor({
    nativeWindow,
    chromePackage,
    useChromeView = false,
    createCanvasView = null,
    createSurfaceRailView = null,
    shellTheme = DEFAULT_SHELL_THEME,
    animationDurationMs = COMPOSITOR_ANIMATION_DURATION_MS,
    animationFrameMs = COMPOSITOR_ANIMATION_FRAME_MS,
  } = {}) {
    if (!nativeWindow) {
      throw new Error('ShellWindow requires a nativeWindow');
    }

    this.nativeWindow = nativeWindow;
    this.chromePackage = chromePackage || null;
    this.canvasView = null;
    this.chromeView = null;
    this.surfaceRailView = null;
    this.chromeWebContents = useChromeView ? null : nativeWindow.webContents || null;
    this.chromeLoadTarget = useChromeView ? null : nativeWindow;
    this.mode = useChromeView ? SHELL_WINDOW_COMPOSITOR_MODE : SHELL_WINDOW_LEGACY_MODE;
    this.closed = false;
    this.updateChromeBounds = null;
    this.canvasBounds = null;
    this.chromeBounds = null;
    this.chromeBorderRadius = 0;
    this.surfaceRailBounds = null;
    this.surfaceRailState = {
      activeSurface: null,
      lastActiveSurface: DEFAULT_SURFACE_RAIL_SURFACE,
      surfaces: new Map([[DEFAULT_SURFACE_RAIL_SURFACE, false]]),
    };
    this.handleChromeContentsDestroyed = null;
    this.handleCanvasContentsDestroyed = null;
    this.handleCanvasIpcMessage = null;
    this.handleCanvasReady = null;
    this.handleSurfaceRailContentsDestroyed = null;
    this.handleSurfaceRailReady = null;
    this.surfaceWindows = new Map();
    this.layoutAnimation = null;
    this.shellTheme = shellTheme || DEFAULT_SHELL_THEME;
    this.canvasTheme = getCanvasThemeForShellTheme(this.shellTheme);
    this.canvasBackgroundColor = getCanvasBackgroundColor(this.canvasTheme);
    this.browserAppState = {
      status: useChromeView ? 'idle' : 'running',
      error: null,
    };
    this.animationDurationMs = normalizeAnimationDurationMs(animationDurationMs);
    this.animationFrameMs = normalizeAnimationFrameMs(animationFrameMs);

    if (useChromeView) {
      if (typeof createCanvasView === 'function') {
        this.attachCanvasView(createCanvasView(chromePackage));
      }
      if (typeof createSurfaceRailView === 'function') {
        this.attachSurfaceRailView(createSurfaceRailView(chromePackage));
      }
      this.applyCanvasTheme();
      this.updateCompositorLayout();
    }
    this.installDebugHook();
  }

  attachCanvasView(canvasView) {
    if (!canvasView?.webContents) {
      throw new Error('ShellWindow canvas view must expose webContents');
    }
    this.canvasView = canvasView;
    setViewBackgroundColor(canvasView, COMPOSITOR_VIEW_TRANSPARENT_BACKGROUND_COLOR);
    setViewBorderRadius(canvasView, 0);
    this.handleCanvasContentsDestroyed = () => {
      this.canvasView = null;
      this.canvasBounds = null;
      this.handleCanvasContentsDestroyed = null;
      this.handleCanvasIpcMessage = null;
      this.handleCanvasReady = null;
    };
    this.handleCanvasReady = () => {
      this.sendCanvasState();
    };
    this.handleCanvasIpcMessage = (_event, channel) => {
      if (channel === IPC.SHELL_CANVAS_READY) {
        this.sendCanvasState();
      }
    };
    this.nativeWindow.getContentView().addChildView(canvasView);
    canvasView.webContents.once?.('destroyed', this.handleCanvasContentsDestroyed);
    canvasView.webContents.on?.('ipc-message', this.handleCanvasIpcMessage);
    canvasView.webContents.on?.('dom-ready', this.handleCanvasReady);
    canvasView.webContents.on?.('did-finish-load', this.handleCanvasReady);
  }

  attachChromeView(chromeView) {
    if (!chromeView?.webContents) {
      throw new Error('ShellWindow chrome view must expose webContents');
    }
    if (this.chromeView && this.chromeView.webContents?.isDestroyed?.() !== true) {
      throw new Error('ShellWindow chrome view is already attached');
    }
    this.chromeView = chromeView;
    this.chromeWebContents = chromeView.webContents;
    this.chromeLoadTarget = chromeView.webContents;
    this.mode = SHELL_WINDOW_COMPOSITOR_MODE;
    this.setBrowserAppState({
      status: 'launching',
      error: null,
    });
    this.applyCanvasTheme();
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
    this.raiseTrustedSurfaceViews();
    this.raiseSurfaceRailView();
    this.updateChromeBounds();
    this.nativeWindow.on?.('resize', this.updateChromeBounds);
    this.nativeWindow.on?.('resized', this.updateChromeBounds);
    this.nativeWindow.on?.('enter-full-screen', this.updateChromeBounds);
    this.nativeWindow.on?.('leave-full-screen', this.updateChromeBounds);
    chromeView.webContents.once?.('destroyed', this.handleChromeContentsDestroyed);
  }

  raiseTrustedSurfaceViews() {
    if (this.closed || this.nativeWindow.isDestroyed?.()) {
      return;
    }
    const contentView = this.nativeWindow.getContentView?.();
    if (!contentView) {
      return;
    }
    this.surfaceWindows.forEach((record) => {
      try {
        contentView.removeChildView?.(record.view);
        contentView.addChildView?.(record.view);
      } catch {
        // View reordering is cosmetic; layout remains correct without it.
      }
    });
  }

  attachSurfaceRailView(surfaceRailView) {
    if (!surfaceRailView?.webContents) {
      throw new Error('ShellWindow surface rail view must expose webContents');
    }
    this.surfaceRailView = surfaceRailView;
    setViewBackgroundColor(surfaceRailView, COMPOSITOR_VIEW_TRANSPARENT_BACKGROUND_COLOR);
    setViewBorderRadius(surfaceRailView, 0);
    this.handleSurfaceRailContentsDestroyed = () => {
      this.surfaceRailView = null;
      this.surfaceRailBounds = null;
      if (!this.closed) {
        this.updateCompositorLayout();
      }
    };
    this.handleSurfaceRailReady = () => {
      this.sendSurfaceRailState();
    };
    this.nativeWindow.getContentView().addChildView(surfaceRailView);
    surfaceRailView.webContents.once?.('destroyed', this.handleSurfaceRailContentsDestroyed);
    surfaceRailView.webContents.on?.('dom-ready', this.handleSurfaceRailReady);
    surfaceRailView.webContents.on?.('did-finish-load', this.handleSurfaceRailReady);
    this.updateCompositorLayout();
  }

  installDebugHook() {
    this.nativeWindow.__freedomShellWindow = {
      getDebugState: () => this.getDebugState(),
      getCanvasWebContents: () => this.canvasView?.webContents || null,
      getChromeWebContents: () => this.chromeWebContents,
      getSurfaceRailWebContents: () => this.surfaceRailView?.webContents || null,
      getSurfaceRailState: () => this.getSurfaceRailState(),
      getCanvasState: () => this.getCanvasState(),
      setShellTheme: (theme) => this.setShellTheme(theme),
      setBrowserAppState: (state) => this.setBrowserAppState(state),
      updateSurfaceRailState: (state) => this.updateSurfaceRailState(state),
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

  removeCanvasContentsListeners() {
    if (!this.canvasView) {
      return;
    }
    if (this.handleCanvasContentsDestroyed) {
      removeContentsListener(
        this.canvasView.webContents,
        'destroyed',
        this.handleCanvasContentsDestroyed
      );
      this.handleCanvasContentsDestroyed = null;
    }
    if (this.handleCanvasIpcMessage) {
      removeContentsListener(
        this.canvasView.webContents,
        'ipc-message',
        this.handleCanvasIpcMessage
      );
      this.handleCanvasIpcMessage = null;
    }
    if (this.handleCanvasReady) {
      removeContentsListener(this.canvasView.webContents, 'dom-ready', this.handleCanvasReady);
      removeContentsListener(this.canvasView.webContents, 'did-finish-load', this.handleCanvasReady);
      this.handleCanvasReady = null;
    }
  }

  removeSurfaceRailContentsListeners() {
    if (!this.surfaceRailView) {
      return;
    }
    if (this.handleSurfaceRailContentsDestroyed) {
      removeContentsListener(
        this.surfaceRailView.webContents,
        'destroyed',
        this.handleSurfaceRailContentsDestroyed
      );
      this.handleSurfaceRailContentsDestroyed = null;
    }
    if (this.handleSurfaceRailReady) {
      removeContentsListener(this.surfaceRailView.webContents, 'dom-ready', this.handleSurfaceRailReady);
      removeContentsListener(
        this.surfaceRailView.webContents,
        'did-finish-load',
        this.handleSurfaceRailReady
      );
      this.handleSurfaceRailReady = null;
    }
  }

  getChromeWebContents() {
    return this.chromeWebContents;
  }

  getSurfaceRailState() {
    return {
      activeSurface: this.surfaceRailState.activeSurface,
      lastActiveSurface: this.surfaceRailState.lastActiveSurface,
      canvasTheme: this.canvasTheme,
      surfaces: [...this.surfaceRailState.surfaces.entries()].map(([surface, open]) => ({
        surface,
        open,
      })),
    };
  }

  getBrowserAppState() {
    return {
      status: this.browserAppState.status,
      error: this.browserAppState.error,
    };
  }

  setBrowserAppState(state = {}) {
    if (typeof state.status === 'string') {
      this.browserAppState.status = state.status;
    }
    if (Object.prototype.hasOwnProperty.call(state, 'error')) {
      this.browserAppState.error =
        typeof state.error === 'string' && state.error ? state.error : null;
    }
    this.sendCanvasState();
    return this.getBrowserAppState();
  }

  getCanvasState() {
    const panes = [];
    const chromePane = createCanvasPaneState({
      id: 'chrome',
      bounds: this.chromeBounds,
      radius: this.chromeBorderRadius,
    });
    if (chromePane) {
      panes.push(chromePane);
    }
    return {
      canvasTheme: this.canvasTheme,
      backgroundColor: this.canvasBackgroundColor,
      panes,
      launcher: {
        visible: this.mode === SHELL_WINDOW_COMPOSITOR_MODE && !this.chromeView,
        activeApp: this.chromeView ? 'browser' : null,
        apps: [
          {
            id: 'browser',
            name: 'Browser',
          },
        ],
        browser: this.getBrowserAppState(),
      },
    };
  }

  sendCanvasState() {
    if (!this.canvasView || this.canvasView.webContents.isDestroyed?.()) {
      return;
    }
    this.canvasView.webContents.send?.(
      IPC.SHELL_CANVAS_STATE,
      this.getCanvasState()
    );
  }

  applyCanvasTheme() {
    this.canvasBackgroundColor = getCanvasBackgroundColor(this.canvasTheme);
    setViewBackgroundColor(this.nativeWindow.getContentView?.(), this.canvasBackgroundColor);
    this.sendCanvasState();
  }

  setShellTheme(theme = DEFAULT_SHELL_THEME) {
    this.shellTheme = theme || DEFAULT_SHELL_THEME;
    const nextCanvasTheme = getCanvasThemeForShellTheme(this.shellTheme);
    if (this.canvasTheme === nextCanvasTheme) {
      return this.getDebugState().layout.canvasTheme;
    }
    this.canvasTheme = nextCanvasTheme;
    this.applyCanvasTheme();
    this.sendSurfaceRailState();
    return this.canvasTheme;
  }

  sendSurfaceRailState() {
    if (!this.surfaceRailView || this.surfaceRailView.webContents.isDestroyed?.()) {
      return;
    }
    this.surfaceRailView.webContents.send?.(
      IPC.SHELL_SURFACE_RAIL_STATE,
      this.getSurfaceRailState()
    );
  }

  updateSurfaceRailState(state = {}) {
    const surface = typeof state.surface === 'string' ? state.surface : null;
    const hasOpenState = typeof state.open === 'boolean';
    if (surface && hasOpenState) {
      this.surfaceRailState.surfaces.set(surface, state.open);
      if (state.open) {
        this.surfaceRailState.activeSurface = surface;
        this.surfaceRailState.lastActiveSurface = surface;
      } else if (this.surfaceRailState.activeSurface === surface) {
        const nextActiveSurface = [...this.surfaceRailState.surfaces.entries()]
          .find(([_surface, open]) => open === true)?.[0] || null;
        this.surfaceRailState.activeSurface = nextActiveSurface;
      }
    }
    if (typeof state.activeSurface === 'string' || state.activeSurface === null) {
      this.surfaceRailState.activeSurface = state.activeSurface;
    }
    if (typeof state.lastActiveSurface === 'string') {
      this.surfaceRailState.lastActiveSurface = state.lastActiveSurface;
    }
    this.sendSurfaceRailState();
    return this.getSurfaceRailState();
  }

  updateSurfaceWindowBounds(_recordToUpdate = null) {
    this.updateCompositorLayout();
  }

  getHiddenSurfaceBounds(record, size = getWindowContentSize(this.nativeWindow)) {
    const widthPreferences = getOverlaySurfaceWidthPreferences(record);
    return getHiddenRightDrawerBoundsForSize(
      size,
      widthPreferences.width,
      widthPreferences.minWidth
    );
  }

  getSurfaceTargetBounds(record, tileLayout, size) {
    const widthPreferences = getOverlaySurfaceWidthPreferences(record);
    const dockedBounds = tileLayout.surfaceBoundsByRecord.get(record);
    if (dockedBounds) {
      return dockedBounds;
    }
    const rootBounds = tileLayout.rootBounds || getCompositorRootBounds(size);
    const rightEdge = tileLayout.railBounds
      ? tileLayout.railBounds.x
      : rootBounds.x + rootBounds.width;
    const surfaceWidth = getSurfaceWidth(rootBounds.width, widthPreferences.width, widthPreferences.minWidth);
    return {
      x: Math.max(rootBounds.x, rightEdge - surfaceWidth),
      y: rootBounds.y,
      width: surfaceWidth,
      height: rootBounds.height,
    };
  }

  setRecordBounds(record, bounds) {
    record.view.setBounds(bounds);
    record.bounds = bounds;
  }

  raiseSurfaceRailView() {
    if (!this.surfaceRailView || this.closed || this.nativeWindow.isDestroyed?.()) {
      return;
    }
    const contentView = this.nativeWindow.getContentView?.();
    if (!contentView) {
      return;
    }
    try {
      contentView.removeChildView?.(this.surfaceRailView);
      contentView.addChildView?.(this.surfaceRailView);
    } catch {
      // View reordering is cosmetic; layout remains correct without it.
    }
  }

  cancelLayoutAnimation({ finish = false } = {}) {
    if (!this.layoutAnimation) {
      return;
    }
    const animation = this.layoutAnimation;
    this.layoutAnimation = null;
    clearTimeout(animation.timer);
    if (finish) {
      animation.apply(1);
      animation.onComplete?.();
    }
  }

  setCompositorBoundsImmediately(entries) {
    entries.forEach((entry) => {
      entry.apply(entry.to);
    });
  }

  animateCompositorBounds(entries, { onComplete = null, onFrame = null } = {}) {
    const durationMs = this.animationDurationMs;
    if (durationMs <= 0 || entries.length === 0) {
      this.setCompositorBoundsImmediately(entries);
      onFrame?.();
      onComplete?.();
      return;
    }

    this.cancelLayoutAnimation({ finish: true });

    const startTime = Date.now();
    const animation = {
      timer: null,
      onComplete,
      apply: (progress) => {
        const easedProgress = easeOutCubic(progress);
        entries.forEach((entry) => {
          entry.apply(interpolateBounds(entry.from, entry.to, easedProgress));
        });
        onFrame?.();
      },
    };
    this.layoutAnimation = animation;
    animation.apply(0);

    const tick = () => {
      if (this.layoutAnimation !== animation) {
        return;
      }
      const progress = (Date.now() - startTime) / durationMs;
      if (progress >= 1) {
        this.layoutAnimation = null;
        animation.apply(1);
        onComplete?.();
        return;
      }
      animation.apply(progress);
      animation.timer = setTimeout(tick, this.animationFrameMs);
    };
    animation.timer = setTimeout(tick, this.animationFrameMs);
  }

  updateCompositorLayout({
    recordsToUpdate = null,
    animate = false,
    enteringRecords = [],
    exitingRecords = [],
    onComplete = null,
  } = {}) {
    if (this.closed || this.nativeWindow.isDestroyed?.()) {
      return;
    }
    const size = getWindowContentSize(this.nativeWindow);
    const allRecords = [...this.surfaceWindows.values()];
    const tileLayout = getCompositorTileLayout(size, allRecords, {
      railWidth: this.surfaceRailView ? COMPOSITOR_RAIL_WIDTH : 0,
    });
    const entries = [];
    if (this.canvasView) {
      entries.push({
        from: getCurrentViewBounds(this.canvasView, this.canvasBounds || tileLayout.rootBounds),
        to: tileLayout.rootBounds,
        apply: (bounds) => {
          this.canvasView.setBounds(bounds);
          this.canvasBounds = bounds;
        },
      });
    }
    if (this.chromeView) {
      entries.push({
        from: getCurrentViewBounds(this.chromeView, this.chromeBounds || tileLayout.chromeBounds),
        to: tileLayout.chromeBounds,
        apply: (bounds) => {
          this.chromeView.setBounds(bounds);
          this.chromeBounds = bounds;
        },
      });
      this.chromeBorderRadius =
        tileLayout.hasDockedTiles || tileLayout.railBounds ? COMPOSITOR_PANEL_RADIUS : 0;
      setViewBorderRadius(
        this.chromeView,
        this.chromeBorderRadius
      );
    }
    if (this.surfaceRailView && tileLayout.railBounds) {
      entries.push({
        from: getCurrentViewBounds(
          this.surfaceRailView,
          this.surfaceRailBounds || tileLayout.railBounds
        ),
        to: tileLayout.railBounds,
        apply: (bounds) => {
          this.surfaceRailView.setBounds(bounds);
          this.surfaceRailBounds = bounds;
        },
      });
      setViewBorderRadius(this.surfaceRailView, 0);
    }
    const records = recordsToUpdate || allRecords;
    records.forEach((record) => {
      if (!record || record.closed) {
        return;
      }
      const isEntering = enteringRecords.includes(record);
      const isExiting = exitingRecords.includes(record);
      const hiddenBounds = this.getHiddenSurfaceBounds(record, size);
      const targetBounds = isExiting
        ? hiddenBounds
        : this.getSurfaceTargetBounds(record, tileLayout, size);
      const currentBounds = isEntering
        ? hiddenBounds
        : getCurrentViewBounds(record.view, record.bounds || targetBounds);
      entries.push({
        from: currentBounds,
        to: targetBounds,
        apply: (bounds) => this.setRecordBounds(record, bounds),
      });
      setViewBorderRadius(record.view, 0);
    });
    if (animate) {
      this.animateCompositorBounds(entries, {
        onFrame: () => this.sendCanvasState(),
        onComplete,
      });
      return;
    }
    this.cancelLayoutAnimation({ finish: false });
    this.setCompositorBoundsImmediately(entries);
    this.sendCanvasState();
    onComplete?.();
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
      visible: false,
      closing: false,
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
    this.raiseSurfaceRailView();
    this.surfaceWindows.set(surface, record);
    record.bounds = this.getHiddenSurfaceBounds(record);
    record.view.setBounds(record.bounds);
    record.view.setVisible?.(false);
    setViewBackgroundColor(record.view, COMPOSITOR_VIEW_TRANSPARENT_BACKGROUND_COLOR);
    setViewBorderRadius(record.view, 0);
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
        if (record.closed || record.closing) {
          return;
        }
        const wasVisible = record.visible;
        record.visible = true;
        record.view.setVisible?.(true);
        this.updateCompositorLayout({
          animate: !wasVisible,
          enteringRecords: wasVisible ? [] : [record],
        });
        record.handleReady?.();
      },
      focus: () => {
        record.view.webContents.focus?.();
      },
      getLayoutMode: () => record.layoutMode,
      setLayoutMode: (layoutMode) => {
        if (record.closed || record.closing) {
          return record.layoutMode;
        }
        const nextLayoutMode = normalizeSurfaceLayoutMode(layoutMode);
        if (record.layoutMode === nextLayoutMode) {
          return record.layoutMode;
        }
        record.layoutMode = nextLayoutMode;
        this.updateCompositorLayout({ animate: record.visible });
        return record.layoutMode;
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
    this.disposeTrustedSurfaceWindow(surface, {
      notifyClosed: true,
      closeWebContents: true,
      animate: true,
    });
  }

  removeTrustedSurfaceListeners(record) {
    removeContentsListener(record.view.webContents, 'destroyed', record.handleDestroyed);
    removeContentsListener(record.view.webContents, 'dom-ready', record.handleReady);
    removeContentsListener(record.view.webContents, 'did-finish-load', record.handleReady);
  }

  finalizeTrustedSurfaceWindow(
    record,
    { notifyClosed = true, closeWebContents = true } = {}
  ) {
    if (!record || record.closed) {
      return;
    }
    record.closed = true;
    record.visible = false;
    record.closing = false;
    this.removeTrustedSurfaceListeners(record);

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

    this.surfaceWindows.delete(record.surface);
    if (notifyClosed) {
      record.emitter.emit('closed');
    }
    record.emitter.removeAllListeners();
  }

  disposeTrustedSurfaceWindow(
    surface,
    { notifyClosed = true, closeWebContents = true, animate = false } = {}
  ) {
    const record = this.surfaceWindows.get(surface);
    if (!record || record.closed || record.closing) {
      return;
    }

    const shouldAnimate =
      animate &&
      record.visible &&
      !this.closed &&
      !this.nativeWindow.isDestroyed?.() &&
      this.animationDurationMs > 0;
    if (!shouldAnimate) {
      this.finalizeTrustedSurfaceWindow(record, { notifyClosed, closeWebContents });
      if (!this.closed) {
        this.updateCompositorLayout();
      }
      return;
    }

    this.removeTrustedSurfaceListeners(record);
    record.visible = false;
    record.closing = true;
    this.updateCompositorLayout({
      animate: true,
      exitingRecords: [record],
      onComplete: () => {
        this.finalizeTrustedSurfaceWindow(record, { notifyClosed, closeWebContents });
      },
    });
  }

  cleanup() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.cancelLayoutAnimation({ finish: false });
    [...this.surfaceWindows.keys()].forEach((surface) => {
      this.disposeTrustedSurfaceWindow(surface, {
        notifyClosed: true,
        closeWebContents: true,
      });
    });
    this.removeChromeViewListeners();
    this.removeChromeContentsListeners();
    this.removeCanvasContentsListeners();
    this.removeSurfaceRailContentsListeners();
    delete this.nativeWindow.__freedomShellWindow;

    if (this.surfaceRailView) {
      try {
        this.nativeWindow.getContentView?.().removeChildView(this.surfaceRailView);
      } catch {
        // The native host may already be destroyed during app shutdown.
      }
      try {
        if (!this.surfaceRailView.webContents.isDestroyed?.()) {
          this.surfaceRailView.webContents.close({ waitForBeforeUnload: false });
        }
      } catch {
        // The rail WebContents may already be gone.
      }
      this.surfaceRailView = null;
      this.surfaceRailBounds = null;
    }

    if (this.canvasView) {
      try {
        this.nativeWindow.getContentView?.().removeChildView(this.canvasView);
      } catch {
        // The native host may already be destroyed during app shutdown.
      }
      try {
        if (!this.canvasView.webContents.isDestroyed?.()) {
          this.canvasView.webContents.close({ waitForBeforeUnload: false });
        }
      } catch {
        // The shell canvas WebContents may already be gone.
      }
      this.canvasView = null;
      this.canvasBounds = null;
    }

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
          : this.chromeBounds,
      chromeVisible:
        this.chromeView && typeof this.chromeView.getVisible === 'function'
          ? this.chromeView.getVisible()
          : undefined,
      canvas: this.canvasView
        ? {
            webContentsId: this.canvasView.webContents?.id ?? null,
            url:
              typeof this.canvasView.webContents?.getURL === 'function'
                ? this.canvasView.webContents.getURL()
                : '',
            bounds:
              typeof this.canvasView.getBounds === 'function'
                ? this.canvasView.getBounds()
                : this.canvasBounds,
            state: this.getCanvasState(),
          }
        : null,
      surfaceRail: this.surfaceRailView
        ? {
            webContentsId: this.surfaceRailView.webContents?.id ?? null,
            url:
              typeof this.surfaceRailView.webContents?.getURL === 'function'
                ? this.surfaceRailView.webContents.getURL()
                : '',
            bounds:
              typeof this.surfaceRailView.getBounds === 'function'
                ? this.surfaceRailView.getBounds()
                : this.surfaceRailBounds,
            visible:
              typeof this.surfaceRailView.getVisible === 'function'
                ? this.surfaceRailView.getVisible()
                : true,
            state: this.getSurfaceRailState(),
          }
        : null,
      hostWebContentsId: this.nativeWindow.webContents?.id ?? null,
      layout: {
        outerMargin: 0,
        gap: COMPOSITOR_PANEL_GAP,
        radius: COMPOSITOR_PANEL_RADIUS,
        railWidth: this.surfaceRailView ? COMPOSITOR_RAIL_WIDTH : 0,
        animationDurationMs: this.animationDurationMs,
        animating: Boolean(this.layoutAnimation),
        canvasTheme: this.canvasTheme,
        backgroundColor: this.canvasBackgroundColor,
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
          record.visible &&
          (typeof record.view.getVisible !== 'function' || record.view.getVisible()),
        closing: record.closing,
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
  COMPOSITOR_RAIL_WIDTH,
  getCanvasBackgroundColor,
  getCanvasThemeForShellTheme,
  ShellWindow,
  createShellWindow,
  getRightDrawerBounds,
  getCompositorHostWebPreferences,
  shouldUseShellWindowCompositor,
};
