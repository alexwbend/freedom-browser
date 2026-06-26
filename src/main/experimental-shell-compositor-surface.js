const path = require('path');
const { WebContentsView } = require('electron');

const TEST_SURFACE_ID = 'testSurface';
const TEST_SURFACE_MODE = 'shell-owned-webcontents-view';
const TEST_SURFACE_WIDTH = 360;
const MIN_TEST_SURFACE_WIDTH = 280;
const activeTestSurfaces = new Map();

function isShellCompositorExperimentEnabled(env = process.env) {
  return env.FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR === '1';
}

function isExperimentalSurfaceSupported(surface, env = process.env) {
  return surface === TEST_SURFACE_ID && isShellCompositorExperimentEnabled(env);
}

function getTestSurfaceEntryPath() {
  return path.join(__dirname, 'experimental-shell-compositor-test-surface.html');
}

function getWindowKey(ownerWindow) {
  if (!ownerWindow) {
    return null;
  }
  if (ownerWindow.id !== undefined && ownerWindow.id !== null) {
    return `window:${ownerWindow.id}`;
  }
  return ownerWindow;
}

function getOwnerContentSize(ownerWindow) {
  if (typeof ownerWindow.getContentSize === 'function') {
    const [width, height] = ownerWindow.getContentSize();
    return { width, height };
  }
  if (typeof ownerWindow.getContentBounds === 'function') {
    const bounds = ownerWindow.getContentBounds();
    return { width: bounds.width, height: bounds.height };
  }
  return { width: 0, height: 0 };
}

function getTestSurfaceBounds(ownerWindow) {
  const { width, height } = getOwnerContentSize(ownerWindow);
  const railBounds = ownerWindow?.__freedomShellWindow?.getDebugState?.()?.surfaceRail?.bounds;
  const rightEdge =
    Number.isFinite(railBounds?.x) && railBounds.x >= 0
      ? Math.min(width, railBounds.x)
      : width;
  const surfaceWidth = Math.min(TEST_SURFACE_WIDTH, Math.max(MIN_TEST_SURFACE_WIDTH, width));
  return {
    x: Math.max(0, rightEdge - surfaceWidth),
    y: 0,
    width: surfaceWidth,
    height: Math.max(0, height),
  };
}

function removeWindowListener(ownerWindow, eventName, listener) {
  if (typeof ownerWindow.off === 'function') {
    ownerWindow.off(eventName, listener);
  } else if (typeof ownerWindow.removeListener === 'function') {
    ownerWindow.removeListener(eventName, listener);
  }
}

function updateTestSurfaceBounds(record) {
  if (!record || record.closed) {
    return null;
  }
  const bounds = getTestSurfaceBounds(record.ownerWindow);
  record.view.setBounds(bounds);
  record.bounds = bounds;
  return bounds;
}

function disposeTestSurface(record, notifyClosed = true) {
  if (!record || record.closed) {
    return;
  }
  record.closed = true;
  removeWindowListener(record.ownerWindow, 'resize', record.updateBounds);
  removeWindowListener(record.ownerWindow, 'resized', record.updateBounds);
  removeWindowListener(record.ownerWindow, 'enter-full-screen', record.updateBounds);
  removeWindowListener(record.ownerWindow, 'leave-full-screen', record.updateBounds);
  removeWindowListener(record.ownerWindow, 'closed', record.handleOwnerClosed);

  try {
    record.ownerWindow.getContentView?.().removeChildView(record.view);
  } catch {
    // The owner window may already be destroyed during shutdown.
  }

  try {
    if (!record.view.webContents.isDestroyed?.()) {
      record.view.webContents.close({ waitForBeforeUnload: false });
    }
  } catch {
    // The WebContents may already be gone.
  }

  activeTestSurfaces.delete(record.key);
  if (notifyClosed && typeof record.onClosed === 'function') {
    record.onClosed();
  }
}

function watchOwnerWindow(record) {
  record.updateBounds = () => updateTestSurfaceBounds(record);
  record.handleOwnerClosed = () => disposeTestSurface(record, true);

  record.ownerWindow.on?.('resize', record.updateBounds);
  record.ownerWindow.on?.('resized', record.updateBounds);
  record.ownerWindow.on?.('enter-full-screen', record.updateBounds);
  record.ownerWindow.on?.('leave-full-screen', record.updateBounds);
  record.ownerWindow.once?.('closed', record.handleOwnerClosed);
}

function createTestSurfaceView() {
  return new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      enableRemoteModule: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });
}

async function openExperimentalShellCompositorSurface({
  ownerWindow,
  onClosed,
  createView = createTestSurfaceView,
  entryPath = getTestSurfaceEntryPath(),
} = {}) {
  if (!isShellCompositorExperimentEnabled()) {
    return {
      ok: false,
      surface: TEST_SURFACE_ID,
      owner: 'shell',
      trusted: true,
      mode: TEST_SURFACE_MODE,
      error: {
        code: 'SHELL_COMPOSITOR_EXPERIMENT_DISABLED',
        message: 'Shell compositor experiment is disabled',
      },
    };
  }
  if (!ownerWindow || typeof ownerWindow.getContentView !== 'function') {
    return {
      ok: false,
      surface: TEST_SURFACE_ID,
      owner: 'shell',
      trusted: true,
      mode: TEST_SURFACE_MODE,
      error: {
        code: 'SHELL_COMPOSITOR_OWNER_WINDOW_UNAVAILABLE',
        message: 'Owner window is required for shell compositor surfaces',
      },
    };
  }

  const key = getWindowKey(ownerWindow);
  const existing = activeTestSurfaces.get(key);
  if (existing && !existing.closed) {
    existing.onClosed = onClosed;
    return {
      ok: true,
      surface: TEST_SURFACE_ID,
      owner: 'shell',
      trusted: true,
      mode: TEST_SURFACE_MODE,
      bounds: updateTestSurfaceBounds(existing),
      webContentsId: existing.view.webContents.id,
    };
  }

  const view = createView();
  const record = {
    key,
    ownerWindow,
    view,
    onClosed,
    bounds: null,
    closed: false,
    updateBounds: null,
    handleOwnerClosed: null,
  };

  try {
    ownerWindow.getContentView().addChildView(view);
    activeTestSurfaces.set(key, record);
    updateTestSurfaceBounds(record);
    watchOwnerWindow(record);
    await view.webContents.loadFile(entryPath);
  } catch (error) {
    disposeTestSurface(record, false);
    return {
      ok: false,
      surface: TEST_SURFACE_ID,
      owner: 'shell',
      trusted: true,
      mode: TEST_SURFACE_MODE,
      error: {
        code: 'SHELL_COMPOSITOR_SURFACE_OPEN_FAILED',
        message: error?.message || 'Failed to open shell compositor test surface',
      },
    };
  }

  return {
    ok: true,
    surface: TEST_SURFACE_ID,
    owner: 'shell',
    trusted: true,
    mode: TEST_SURFACE_MODE,
    bounds: record.bounds,
    webContentsId: view.webContents.id,
  };
}

function closeExperimentalShellCompositorSurface(ownerWindow = null) {
  if (ownerWindow) {
    const key = getWindowKey(ownerWindow);
    const record = activeTestSurfaces.get(key);
    if (record) {
      disposeTestSurface(record, false);
    }
    return {
      ok: true,
      surface: TEST_SURFACE_ID,
      owner: 'shell',
      trusted: true,
      mode: TEST_SURFACE_MODE,
    };
  }

  for (const record of [...activeTestSurfaces.values()]) {
    disposeTestSurface(record, false);
  }
  return {
    ok: true,
    surface: TEST_SURFACE_ID,
    owner: 'shell',
    trusted: true,
    mode: TEST_SURFACE_MODE,
  };
}

function getExperimentalShellCompositorSurfaceDebugState() {
  return [...activeTestSurfaces.values()].map((record) => ({
    surface: TEST_SURFACE_ID,
    ownerWindowId: record.ownerWindow?.id ?? null,
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
    closed: record.closed === true,
  }));
}

module.exports = {
  TEST_SURFACE_ID,
  TEST_SURFACE_MODE,
  closeExperimentalShellCompositorSurface,
  getExperimentalShellCompositorSurfaceDebugState,
  getTestSurfaceBounds,
  getTestSurfaceEntryPath,
  isExperimentalSurfaceSupported,
  isShellCompositorExperimentEnabled,
  openExperimentalShellCompositorSurface,
};
