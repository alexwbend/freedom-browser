const mockHandlers = new Map();
const mockWindows = [];
let mockNextLoadError = null;
let mockDialogResult = { canceled: false, filePaths: ['/tmp/publish.txt'] };

class MockBrowserWindow {
  constructor(options) {
    this.options = options;
    this.webContents = {
      id: mockWindows.length + 1,
      send: jest.fn(),
    };
    this.destroyed = false;
    this.events = new Map();
    this.show = jest.fn();
    this.focus = jest.fn();
    this.close = jest.fn(() => {
      if (this.destroyed) {
        return;
      }
      this.destroyed = true;
      const closed = this.events.get('closed');
      if (closed) {
        closed();
      }
    });
    this.loadFile = mockNextLoadError
      ? jest.fn().mockRejectedValue(mockNextLoadError)
      : jest.fn().mockResolvedValue(undefined);
    mockNextLoadError = null;
    mockWindows.push(this);
  }

  once(event, callback) {
    this.events.set(event, callback);
  }

  isDestroyed() {
    return this.destroyed;
  }
}

const mockWriteText = jest.fn();
const mockShowOpenDialog = jest.fn(() => Promise.resolve(mockDialogResult));
jest.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  clipboard: {
    writeText: (...args) => mockWriteText(...args),
  },
  dialog: {
    showOpenDialog: (...args) => mockShowOpenDialog(...args),
  },
  ipcMain: {
    handle: jest.fn((channel, handler) => {
      mockHandlers.set(channel, handler);
    }),
    removeHandler: jest.fn((channel) => {
      mockHandlers.delete(channel);
    }),
  },
}));

const mockExistsSync = jest.fn(() => true);
const mockStatSync = jest.fn(() => ({ isDirectory: () => true }));
jest.mock('fs', () => ({
  existsSync: (...args) => mockExistsSync(...args),
  statSync: (...args) => mockStatSync(...args),
}));

const mockAddEntry = jest.fn(() => ({ id: 7 }));
const mockUpdateEntry = jest.fn();
const mockGetEntries = jest.fn(() => [
  {
    id: 1,
    type: 'data',
    name: 'Text',
    status: 'completed',
    reference: 'abc123',
    bzzUrl: 'bzz://abc123',
  },
]);
const mockClearEntries = jest.fn();
jest.mock('./swarm/publish-history', () => ({
  addEntry: (...args) => mockAddEntry(...args),
  updateEntry: (...args) => mockUpdateEntry(...args),
  getEntries: (...args) => mockGetEntries(...args),
  clearEntries: (...args) => mockClearEntries(...args),
}));

const mockPublishData = jest.fn(() =>
  Promise.resolve({ reference: 'textref', bzzUrl: 'bzz://textref', tagUid: 12 })
);
const mockPublishFile = jest.fn(() =>
  Promise.resolve({ reference: 'fileref', bzzUrl: 'bzz://fileref', tagUid: 13 })
);
const mockPublishDirectory = jest.fn(() =>
  Promise.resolve({ reference: 'dirref', bzzUrl: 'bzz://dirref', tagUid: 14 })
);
const mockGetUploadStatus = jest.fn(() =>
  Promise.resolve({ tagUid: 12, progress: 100, done: true })
);
jest.mock('./swarm/publish-service', () => ({
  USER_ORIGIN: 'freedom://publish',
  publishData: (...args) => mockPublishData(...args),
  publishFile: (...args) => mockPublishFile(...args),
  publishDirectory: (...args) => mockPublishDirectory(...args),
  getUploadStatus: (...args) => mockGetUploadStatus(...args),
}));

const mockGetStamps = jest.fn(() =>
  Promise.resolve([{ batchId: 'batch1', usable: true, remainingBytes: 1024 }])
);
jest.mock('./swarm/stamp-service', () => ({
  getStamps: (...args) => mockGetStamps(...args),
}));

const mockHandleShellRequest = jest.fn(() => Promise.resolve({ ok: true, tabId: 'tab-1' }));
jest.mock('./shell-api', () => ({
  handleShellRequest: (...args) => mockHandleShellRequest(...args),
}));

const {
  channelFor,
  closeTrustedSwarmPublishSurface,
  openTrustedSwarmPublishSurface,
  _resetForTest,
} = require('./trusted-swarm-publish-surface');

beforeEach(() => {
  mockHandlers.clear();
  mockWindows.length = 0;
  mockNextLoadError = null;
  mockDialogResult = { canceled: false, filePaths: ['/tmp/publish.txt'] };
  jest.clearAllMocks();
  _resetForTest();
});

afterEach(() => {
  _resetForTest();
});

test('opens a shell-owned Swarm publish window with dedicated preload and scoped channels', async () => {
  const ownerWindow = { id: 42 };
  const closed = jest.fn();
  const result = await openTrustedSwarmPublishSurface({
    ownerWindow,
    caller: { packageId: 'baby.freedom.chrome.official-local' },
    onClosed: closed,
  });

  expect(result).toMatchObject({
    ok: true,
    surface: 'swarmPublish',
    owner: 'shell',
    trusted: true,
  });
  expect(mockWindows).toHaveLength(1);
  const surfaceWindow = mockWindows[0];
  expect(surfaceWindow.options.parent).toBe(ownerWindow);
  expect(surfaceWindow.options.webPreferences).toEqual(
    expect.objectContaining({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    })
  );
  expect(surfaceWindow.options.webPreferences.preload).toContain(
    'trusted-swarm-publish-preload.js'
  );
  expect(surfaceWindow.loadFile).toHaveBeenCalledWith(
    expect.stringContaining('renderer/pages/publish.html'),
    { query: { surfaceId: expect.any(String) } }
  );

  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;
  const historyResult = await mockHandlers.get(channelFor('get-publish-history', surfaceId))({
    sender: surfaceWindow.webContents,
  });
  expect(historyResult).toMatchObject({
    success: true,
    entries: [expect.objectContaining({ bzzUrl: 'bzz://abc123' })],
  });

  const stampsResult = await mockHandlers.get(channelFor('get-stamps', surfaceId))({
    sender: surfaceWindow.webContents,
  });
  expect(stampsResult).toEqual({
    success: true,
    stamps: [{ batchId: 'batch1', usable: true, remainingBytes: 1024 }],
  });
});

test('rejects scoped publish requests from non-surface senders', async () => {
  await openTrustedSwarmPublishSurface({});
  const surfaceId = mockWindows[0].loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('publish-data', surfaceId))({
    sender: { id: 999 },
  }, 'hello');

  expect(result).toMatchObject({
    success: false,
    error: { code: 'TRUSTED_SWARM_PUBLISH_SURFACE_SENDER_MISMATCH' },
  });
  expect(mockPublishData).not.toHaveBeenCalled();
});

test('publishes trusted text through main-owned publish service and history', async () => {
  await openTrustedSwarmPublishSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('publish-data', surfaceId))({
    sender: surfaceWindow.webContents,
  }, 'hello world');

  expect(result).toEqual({
    success: true,
    reference: 'textref',
    bzzUrl: 'bzz://textref',
    tagUid: 12,
  });
  expect(mockAddEntry).toHaveBeenCalledWith({
    type: 'data',
    name: 'Text',
    status: 'uploading',
    origin: 'freedom://publish',
  });
  expect(mockPublishData).toHaveBeenCalledWith('hello world');
  expect(mockUpdateEntry).toHaveBeenCalledWith(7, {
    status: 'completed',
    reference: 'textref',
    bzzUrl: 'bzz://textref',
    tagUid: 12,
  });
});

test('supports trusted file picker and cleanup on close', async () => {
  const closed = jest.fn();
  await openTrustedSwarmPublishSurface({ onClosed: closed });
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const pickResult = await mockHandlers.get(channelFor('pick-file', surfaceId))({
    sender: surfaceWindow.webContents,
  });
  expect(pickResult).toEqual({ success: true, path: '/tmp/publish.txt' });
  expect(mockShowOpenDialog).toHaveBeenCalledWith(
    surfaceWindow,
    expect.objectContaining({ properties: ['openFile'] })
  );

  const closeResult = closeTrustedSwarmPublishSurface();
  expect(closeResult).toMatchObject({ ok: true, surface: 'swarmPublish', closed: true });
  expect(closed).toHaveBeenCalledTimes(1);
  expect(mockHandlers.has(channelFor('pick-file', surfaceId))).toBe(false);
});

test('opens published links through the host package tab API', async () => {
  const hostWebContents = { id: 55 };
  await openTrustedSwarmPublishSurface({ hostWebContents });
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('open-in-new-tab', surfaceId))({
    sender: surfaceWindow.webContents,
  }, 'bzz://abc123');

  expect(result).toEqual({
    success: true,
    tab: { ok: true, tabId: 'tab-1' },
  });
  expect(mockHandleShellRequest).toHaveBeenCalledWith(
    { sender: hostWebContents },
    {
      method: 'tabs.create',
      args: [{ url: 'bzz://abc123' }],
    }
  );
});
