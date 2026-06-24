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
  presentTrustedX402ApprovalPrompt,
} = require('./trusted-x402-approval-prompt');

function request(overrides = {}) {
  return {
    requestId: 'x402-approval-request-1',
    reason: 'x402 payment approval request from https://api.example',
    origin: 'https://api.example',
    details: {
      amount: '10000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      network: 'eip155:8453',
      payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
      resource: 'https://api.example/article',
      defaultGrant: {
        capAmount: '10000000',
        windowSeconds: 30 * 24 * 60 * 60,
        selectedAcceptIndex: 0,
        label: '10 USDC for 30 days',
      },
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

test('buildPromptContext keeps only display payment details and cap label', () => {
  expect(buildPromptContext(request())).toEqual({
    title: 'Freedom x402 Payment',
    heading: 'Review x402 payment',
    origin: 'https://api.example',
    reason: 'x402 payment approval request from https://api.example',
    rows: [
      { label: 'Amount', value: '10000' },
      { label: 'Asset', value: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
      { label: 'Network', value: 'eip155:8453' },
      { label: 'Pay to', value: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C' },
      { label: 'Resource', value: 'https://api.example/article' },
    ],
    actions: {
      payOnceLabel: 'Pay once',
      rejectLabel: 'Reject',
      allowLabel: 'Pay and allow 10 USDC for 30 days',
    },
  });
});

test('creates a modal shell-owned window with a dedicated preload and scoped channels', async () => {
  const ownerWindow = { id: 42 };
  const promptPromise = presentTrustedX402ApprovalPrompt(request(), { ownerWindow });

  expect(mockWindows).toHaveLength(1);
  const promptWindow = mockWindows[0];
  expect(promptWindow.options.parent).toBe(ownerWindow);
  expect(promptWindow.options.modal).toBe(true);
  expect(promptWindow.options.webPreferences).toEqual(expect.objectContaining({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  }));
  expect(promptWindow.options.webPreferences.preload).toContain('trusted-x402-approval-preload.js');
  expect(promptWindow.loadFile).toHaveBeenCalledWith(
    expect.stringContaining('trusted-x402-approval.html'),
    { query: { requestId: 'x402-approval-request-1' } }
  );

  const contextResult = await mockHandlers.get(channelFor('context', 'x402-approval-request-1'))({
    sender: promptWindow.webContents,
  });
  expect(contextResult).toEqual(expect.objectContaining({
    ok: true,
    context: expect.objectContaining({
      origin: 'https://api.example',
      actions: expect.objectContaining({
        allowLabel: 'Pay and allow 10 USDC for 30 days',
      }),
    }),
  }));

  const decisionResult = await mockHandlers.get(channelFor('decision', 'x402-approval-request-1'))(
    { sender: promptWindow.webContents },
    { action: 'pay-once' }
  );
  expect(decisionResult).toEqual({ ok: true });
  await expect(promptPromise).resolves.toEqual({
    ok: true,
    outcome: 'accepted',
    response: 0,
    renderedBy: 'trusted-x402-approval-window',
    presentation: 'trusted-window',
    source: 'trusted-x402-approval-window',
  });
  expect(mockHandlers.size).toBe(0);
});

test('bounded cap approval uses the main-derived grant and ignores spoofed payload values', async () => {
  const promptPromise = presentTrustedX402ApprovalPrompt(request(), {});
  const promptWindow = mockWindows[0];

  const decisionResult = await mockHandlers.get(channelFor('decision', 'x402-approval-request-1'))(
    { sender: promptWindow.webContents },
    {
      action: 'allow',
      grant: {
        capAmount: '999999999999',
        windowSeconds: 999999,
        selectedAcceptIndex: 7,
      },
    }
  );
  expect(decisionResult).toEqual({ ok: true });
  await expect(promptPromise).resolves.toEqual({
    ok: true,
    outcome: 'accepted',
    response: 1,
    grant: {
      capAmount: '10000000',
      windowSeconds: 30 * 24 * 60 * 60,
    },
    selectedAcceptIndex: 0,
    renderedBy: 'trusted-x402-approval-window',
    presentation: 'trusted-window',
    source: 'trusted-x402-approval-window',
  });
});

test('rejects decisions from unexpected senders without settling the prompt', async () => {
  const promptPromise = presentTrustedX402ApprovalPrompt(request(), {});
  const promptWindow = mockWindows[0];

  const mismatch = await mockHandlers.get(channelFor('decision', 'x402-approval-request-1'))(
    { sender: { id: 999 } },
    { action: 'allow' }
  );

  expect(mismatch).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_X402_APPROVAL_SENDER_MISMATCH',
    }),
  });
  const reject = await mockHandlers.get(channelFor('decision', 'x402-approval-request-1'))(
    { sender: promptWindow.webContents },
    { action: 'reject' }
  );
  expect(reject).toEqual({ ok: true });
  await expect(promptPromise).resolves.toEqual(expect.objectContaining({
    ok: true,
    outcome: 'rejected',
    response: 2,
  }));
});

test('does not accept a cap decision when the request has no default grant', async () => {
  const promptPromise = presentTrustedX402ApprovalPrompt(request({
    details: {
      amount: '10000',
    },
  }), {});
  const promptWindow = mockWindows[0];

  const invalid = await mockHandlers.get(channelFor('decision', 'x402-approval-request-1'))(
    { sender: promptWindow.webContents },
    { action: 'allow' }
  );
  expect(invalid).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_X402_APPROVAL_DECISION_INVALID',
      message: 'This payment request does not include a bounded cap option.',
    },
  });

  await mockHandlers.get(channelFor('decision', 'x402-approval-request-1'))(
    { sender: promptWindow.webContents },
    { action: 'reject' }
  );
  await expect(promptPromise).resolves.toEqual(expect.objectContaining({
    ok: true,
    outcome: 'rejected',
    response: 1,
  }));
});

test('window load failure returns a trusted presentation error and removes handlers', async () => {
  mockNextLoadError = new Error('boom');
  const failed = await presentTrustedX402ApprovalPrompt(request(), {});

  expect(failed).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_X402_APPROVAL_LOAD_FAILED',
      message: 'boom',
    },
    renderedBy: 'trusted-x402-approval-window',
    presentation: 'trusted-window',
    source: 'trusted-x402-approval-window',
  });
  expect(mockHandlers.size).toBe(0);
});
