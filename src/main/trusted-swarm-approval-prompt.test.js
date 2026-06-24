const mockHandlers = new Map();
const mockWindows = [];
let mockNextLoadError = null;

class MockBrowserWindow {
  constructor(options) {
    this.options = options;
    this.webContents = { id: mockWindows.length + 1 };
    this.destroyed = false;
    this.events = new Map();
    this.show = jest.fn();
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

jest.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  ipcMain: {
    handle: jest.fn((channel, handler) => {
      mockHandlers.set(channel, handler);
    }),
    removeHandler: jest.fn((channel) => {
      mockHandlers.delete(channel);
    }),
  },
}));

const {
  buildPromptContext,
  channelFor,
  presentTrustedSwarmApprovalPrompt,
} = require('./trusted-swarm-approval-prompt');

function request(overrides = {}) {
  return {
    requestId: 'swarm-approval-request-1',
    kind: 'swarm.publish',
    method: 'swarm_publishFiles',
    reason: 'Swarm publish request from ipfs://bafyapp',
    origin: 'ipfs://bafyapp',
    details: {
      target: 'files',
      contentType: 'text/html',
      fileCount: 2,
      sizeBytes: 8,
      indexDocument: 'index.html',
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockHandlers.clear();
  mockWindows.length = 0;
  mockNextLoadError = null;
  jest.clearAllMocks();
});

test('buildPromptContext keeps display-only Swarm publish details', () => {
  expect(buildPromptContext(request())).toEqual({
    title: 'Freedom Swarm Publish',
    heading: 'Review Swarm publish',
    origin: 'ipfs://bafyapp',
    summary: 'ipfs://bafyapp requested to publish to Swarm.',
    reason: 'Swarm publish request from ipfs://bafyapp',
    rows: [
      { label: 'Method', value: 'swarm_publishFiles' },
      { label: 'Target', value: 'files' },
      { label: 'Content type', value: 'text/html' },
      { label: 'Files', value: '2' },
      { label: 'Size', value: '8 bytes' },
      { label: 'Index document', value: 'index.html' },
    ],
    notice: 'Publish only if the target, size, and site match what you intended.',
    actions: {
      acceptLabel: 'Publish',
      rejectLabel: 'Reject',
    },
  });
});

test('buildPromptContext labels connect, feed, and signing decisions', () => {
  expect(buildPromptContext(request({
    kind: 'swarm.connect',
    method: 'swarm_requestAccess',
    details: null,
  }))).toMatchObject({
    title: 'Freedom Swarm Connection',
    heading: 'Review Swarm connection',
    actions: { acceptLabel: 'Allow', rejectLabel: 'Reject' },
  });

  expect(buildPromptContext(request({
    kind: 'swarm.feed',
    method: 'swarm_createFeed',
    details: { action: 'create', feedName: 'blog', identityMode: 'app-scoped' },
  }))).toMatchObject({
    title: 'Freedom Swarm Feed',
    rows: expect.arrayContaining([
      { label: 'Action', value: 'create' },
      { label: 'Feed', value: 'blog' },
      { label: 'Identity', value: 'app-scoped' },
    ]),
  });

  expect(buildPromptContext(request({
    kind: 'swarm.signing',
    method: 'swarm_writeSingleOwnerChunk',
    details: {
      action: 'soc',
      identifier: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sizeBytes: 5,
    },
  }))).toMatchObject({
    title: 'Freedom Swarm Publisher Signing',
    rows: expect.arrayContaining([
      { label: 'Identifier', value: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      { label: 'Size', value: '5 bytes' },
    ]),
  });
});

test('creates a modal shell-owned window with a dedicated preload and scoped channels', async () => {
  const ownerWindow = { id: 42 };
  const promptPromise = presentTrustedSwarmApprovalPrompt(request(), { ownerWindow });

  expect(mockWindows).toHaveLength(1);
  const promptWindow = mockWindows[0];
  expect(promptWindow.options.parent).toBe(ownerWindow);
  expect(promptWindow.options.modal).toBe(true);
  expect(promptWindow.options.webPreferences).toEqual(expect.objectContaining({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  }));
  expect(promptWindow.options.webPreferences.preload).toContain(
    'trusted-swarm-approval-preload.js'
  );
  expect(promptWindow.loadFile).toHaveBeenCalledWith(
    expect.stringContaining('trusted-swarm-approval.html'),
    { query: { requestId: 'swarm-approval-request-1' } }
  );

  const contextResult = await mockHandlers.get(channelFor('context', 'swarm-approval-request-1'))({
    sender: promptWindow.webContents,
  });
  expect(contextResult).toEqual(expect.objectContaining({
    ok: true,
    context: expect.objectContaining({
      origin: 'ipfs://bafyapp',
      actions: { acceptLabel: 'Publish', rejectLabel: 'Reject' },
    }),
  }));

  const decisionResult = await mockHandlers.get(channelFor('decision', 'swarm-approval-request-1'))(
    { sender: promptWindow.webContents },
    { action: 'accept' }
  );
  expect(decisionResult).toEqual({ ok: true });
  await expect(promptPromise).resolves.toEqual({
    ok: true,
    outcome: 'accepted',
    response: 0,
    renderedBy: 'trusted-swarm-approval-window',
    presentation: 'trusted-window',
    source: 'trusted-swarm-approval-window',
  });
  expect(mockHandlers.size).toBe(0);
});

test('rejects decisions from unexpected senders without settling the prompt', async () => {
  const promptPromise = presentTrustedSwarmApprovalPrompt(request(), {});
  const promptWindow = mockWindows[0];

  const mismatch = await mockHandlers.get(channelFor('decision', 'swarm-approval-request-1'))(
    { sender: { id: 999 } },
    { action: 'accept' }
  );

  expect(mismatch).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_SWARM_APPROVAL_SENDER_MISMATCH',
    }),
  });
  const reject = await mockHandlers.get(channelFor('decision', 'swarm-approval-request-1'))(
    { sender: promptWindow.webContents },
    { action: 'reject' }
  );
  expect(reject).toEqual({ ok: true });
  await expect(promptPromise).resolves.toEqual(expect.objectContaining({
    ok: true,
    outcome: 'rejected',
    response: 1,
  }));
});

test('window load failure returns a trusted presentation error and removes handlers', async () => {
  mockNextLoadError = new Error('boom');
  const failed = await presentTrustedSwarmApprovalPrompt(request(), {});

  expect(failed).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_SWARM_APPROVAL_LOAD_FAILED',
      message: 'boom',
    },
    renderedBy: 'trusted-swarm-approval-window',
    presentation: 'trusted-window',
    source: 'trusted-swarm-approval-window',
  });
  expect(mockHandlers.size).toBe(0);
});
