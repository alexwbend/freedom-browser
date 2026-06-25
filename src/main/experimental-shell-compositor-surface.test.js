const { EventEmitter } = require('events');
const {
  closeExperimentalShellCompositorSurface,
  getExperimentalShellCompositorSurfaceDebugState,
  getTestSurfaceBounds,
  isExperimentalSurfaceSupported,
  openExperimentalShellCompositorSurface,
} = require('./experimental-shell-compositor-surface');

const ORIGINAL_FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR =
  process.env.FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR;

function restoreExperimentEnv() {
  if (ORIGINAL_FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR === undefined) {
    delete process.env.FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR;
  } else {
    process.env.FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR =
      ORIGINAL_FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR;
  }
}

function makeOwnerWindow(options = {}) {
  const emitter = new EventEmitter();
  let size = options.size || [1200, 800];
  const contentView = {
    addChildView: jest.fn(),
    removeChildView: jest.fn(),
  };
  return Object.assign(emitter, {
    id: options.id || 7,
    getContentSize: jest.fn(() => size),
    getContentView: jest.fn(() => contentView),
    setContentSizeForTest(nextSize) {
      size = nextSize;
    },
    contentView,
  });
}

function makeView(options = {}) {
  const bounds = [];
  const webContents = {
    id: options.webContentsId || 99,
    isDestroyed: jest.fn(() => false),
    close: jest.fn(),
    getURL: jest.fn(() => options.url || 'file:///test-surface.html'),
    loadFile: jest.fn(() => Promise.resolve()),
  };
  return {
    bounds,
    webContents,
    setBounds: jest.fn((nextBounds) => bounds.push(nextBounds)),
    getVisible: jest.fn(() => true),
  };
}

afterEach(() => {
  closeExperimentalShellCompositorSurface();
  restoreExperimentEnv();
  jest.restoreAllMocks();
});

test('keeps the test surface unsupported unless the compositor experiment is enabled', () => {
  expect(isExperimentalSurfaceSupported('testSurface')).toBe(false);

  process.env.FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR = '1';

  expect(isExperimentalSurfaceSupported('testSurface')).toBe(true);
  expect(isExperimentalSurfaceSupported('wallet')).toBe(false);
});

test('computes right-drawer bounds from the owner window content size', () => {
  const ownerWindow = makeOwnerWindow({ size: [1200, 800] });

  expect(getTestSurfaceBounds(ownerWindow)).toEqual({
    x: 840,
    y: 0,
    width: 360,
    height: 800,
  });
});

test('opens a main-owned WebContentsView surface and updates bounds on resize', async () => {
  process.env.FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR = '1';
  const ownerWindow = makeOwnerWindow({ id: 8, size: [1200, 800] });
  const view = makeView({ webContentsId: 101 });

  await expect(
    openExperimentalShellCompositorSurface({
      ownerWindow,
      createView: () => view,
      entryPath: '/tmp/test-surface.html',
    })
  ).resolves.toMatchObject({
    ok: true,
    surface: 'testSurface',
    owner: 'shell',
    trusted: true,
    mode: 'shell-owned-webcontents-view',
    bounds: { x: 840, y: 0, width: 360, height: 800 },
    webContentsId: 101,
  });

  expect(ownerWindow.contentView.addChildView).toHaveBeenCalledWith(view);
  expect(view.webContents.loadFile).toHaveBeenCalledWith('/tmp/test-surface.html');
  expect(view.setBounds).toHaveBeenLastCalledWith({
    x: 840,
    y: 0,
    width: 360,
    height: 800,
  });

  ownerWindow.setContentSizeForTest([1000, 700]);
  ownerWindow.emit('resize');

  expect(view.setBounds).toHaveBeenLastCalledWith({
    x: 640,
    y: 0,
    width: 360,
    height: 700,
  });
  expect(getExperimentalShellCompositorSurfaceDebugState()).toEqual([
    expect.objectContaining({
      surface: 'testSurface',
      ownerWindowId: 8,
      webContentsId: 101,
      bounds: { x: 640, y: 0, width: 360, height: 700 },
      visible: true,
      closed: false,
    }),
  ]);
});

test('closes the test surface without notifying caller state for explicit close', async () => {
  process.env.FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR = '1';
  const ownerWindow = makeOwnerWindow({ id: 9 });
  const view = makeView();
  const onClosed = jest.fn();

  await openExperimentalShellCompositorSurface({
    ownerWindow,
    createView: () => view,
    entryPath: '/tmp/test-surface.html',
    onClosed,
  });
  const result = closeExperimentalShellCompositorSurface(ownerWindow);

  expect(result).toMatchObject({
    ok: true,
    surface: 'testSurface',
    mode: 'shell-owned-webcontents-view',
  });
  expect(ownerWindow.contentView.removeChildView).toHaveBeenCalledWith(view);
  expect(view.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
  expect(onClosed).not.toHaveBeenCalled();
  expect(getExperimentalShellCompositorSurfaceDebugState()).toEqual([]);
});

test('notifies caller state when the owner window closes', async () => {
  process.env.FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR = '1';
  const ownerWindow = makeOwnerWindow({ id: 10 });
  const view = makeView();
  const onClosed = jest.fn();

  await openExperimentalShellCompositorSurface({
    ownerWindow,
    createView: () => view,
    entryPath: '/tmp/test-surface.html',
    onClosed,
  });

  ownerWindow.emit('closed');

  expect(ownerWindow.contentView.removeChildView).toHaveBeenCalledWith(view);
  expect(onClosed).toHaveBeenCalledTimes(1);
  expect(getExperimentalShellCompositorSurfaceDebugState()).toEqual([]);
});
