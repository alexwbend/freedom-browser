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
  presentTrustedWalletApprovalPrompt,
} = require('./trusted-wallet-approval-prompt');

function request(overrides = {}) {
  return {
    requestId: 'wallet-approval-request-1',
    kind: 'wallet.transaction',
    method: 'eth_sendTransaction',
    reason: 'Wallet transaction request from https://app.example',
    origin: 'https://app.example',
    details: {
      method: 'eth_sendTransaction',
      account: '0x1111111111111111111111111111111111111111',
      walletIndex: 0,
      chainId: 100,
      to: '0x0000000000000000000000000000000000000001',
      value: '0x2a',
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

test('buildPromptContext keeps display-only transaction details', () => {
  expect(buildPromptContext(request())).toEqual({
    title: 'Freedom Wallet Transaction',
    heading: 'Review wallet transaction',
    origin: 'https://app.example',
    summary: 'https://app.example requested a wallet transaction.',
    reason: 'Wallet transaction request from https://app.example',
    rows: [
      { label: 'Method', value: 'eth_sendTransaction' },
      { label: 'Account', value: '0x1111111111111111111111111111111111111111' },
      { label: 'Wallet index', value: '0' },
      { label: 'Chain', value: '100' },
      { label: 'To', value: '0x0000000000000000000000000000000000000001' },
      { label: 'Value', value: '0x2a' },
    ],
    accountChoices: [],
    notice: 'Send only if the account, recipient, value, and site match what you intended.',
    actions: {
      acceptLabel: 'Send',
      rejectLabel: 'Reject',
    },
  });
});

test('buildPromptContext labels connect and signature decisions', () => {
  expect(buildPromptContext(request({
    kind: 'wallet.connect',
    method: 'eth_requestAccounts',
    details: {
      activeAccount: '0x1111111111111111111111111111111111111111',
      accountChoices: [
        {
          walletIndex: 0,
          name: 'Main Wallet',
          account: '0x1111111111111111111111111111111111111111',
          active: true,
        },
        {
          walletIndex: 1,
          name: 'Savings',
          account: '0x2222222222222222222222222222222222222222',
        },
      ],
    },
  }))).toMatchObject({
    title: 'Freedom Wallet Connection',
    heading: 'Review wallet connection',
    actions: { acceptLabel: 'Connect', rejectLabel: 'Reject' },
    rows: [
      { label: 'Method', value: 'eth_requestAccounts' },
      { label: 'Account', value: '0x1111111111111111111111111111111111111111' },
    ],
    accountChoices: [
      {
        walletIndex: 0,
        name: 'Main Wallet',
        account: '0x1111111111111111111111111111111111111111',
        active: true,
      },
      {
        walletIndex: 1,
        name: 'Savings',
        account: '0x2222222222222222222222222222222222222222',
        active: false,
      },
    ],
  });

  expect(buildPromptContext(request({
    kind: 'wallet.signature',
    method: 'personal_sign',
    details: {
      method: 'personal_sign',
      account: '0x1111111111111111111111111111111111111111',
      messagePreview: '0x68656c6c6f',
      payloadSize: '12 chars',
    },
  }))).toMatchObject({
    title: 'Freedom Wallet Signature',
    heading: 'Review wallet signature',
    actions: { acceptLabel: 'Sign', rejectLabel: 'Reject' },
    rows: expect.arrayContaining([
      { label: 'Message', value: '0x68656c6c6f' },
      { label: 'Payload size', value: '12 chars' },
    ]),
  });
});

test('creates a modal shell-owned window with a dedicated preload and scoped channels', async () => {
  const ownerWindow = { id: 42 };
  const promptPromise = presentTrustedWalletApprovalPrompt(request(), { ownerWindow });

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
    'trusted-wallet-approval-preload.js'
  );
  expect(promptWindow.loadFile).toHaveBeenCalledWith(
    expect.stringContaining('trusted-wallet-approval.html'),
    { query: { requestId: 'wallet-approval-request-1' } }
  );

  const contextResult = await mockHandlers.get(channelFor('context', 'wallet-approval-request-1'))({
    sender: promptWindow.webContents,
  });
  expect(contextResult).toEqual(expect.objectContaining({
    ok: true,
    context: expect.objectContaining({
      origin: 'https://app.example',
      actions: { acceptLabel: 'Send', rejectLabel: 'Reject' },
    }),
  }));

  const decisionResult = await mockHandlers.get(channelFor('decision', 'wallet-approval-request-1'))(
    { sender: promptWindow.webContents },
    { action: 'accept' }
  );
  expect(decisionResult).toEqual({ ok: true });
  await expect(promptPromise).resolves.toEqual({
    ok: true,
    outcome: 'accepted',
    response: 0,
    renderedBy: 'trusted-wallet-approval-window',
    presentation: 'trusted-window',
    source: 'trusted-wallet-approval-window',
  });
  expect(mockHandlers.size).toBe(0);
});

test('trusted wallet connect decision returns a selected main-provided account choice', async () => {
  const promptPromise = presentTrustedWalletApprovalPrompt(
    request({
      kind: 'wallet.connect',
      method: 'eth_requestAccounts',
      details: {
        method: 'eth_requestAccounts',
        activeAccount: '0x1111111111111111111111111111111111111111',
        accountChoices: [
          {
            walletIndex: 0,
            name: 'Main Wallet',
            account: '0x1111111111111111111111111111111111111111',
            active: true,
          },
          {
            walletIndex: 1,
            name: 'Savings',
            account: '0x2222222222222222222222222222222222222222',
          },
        ],
      },
    }),
    {}
  );
  const promptWindow = mockWindows[0];

  const decisionResult = await mockHandlers.get(channelFor('decision', 'wallet-approval-request-1'))(
    { sender: promptWindow.webContents },
    { action: 'accept', selectedWalletIndex: 1 }
  );
  expect(decisionResult).toEqual({ ok: true });
  await expect(promptPromise).resolves.toEqual({
    ok: true,
    outcome: 'accepted',
    response: 0,
    renderedBy: 'trusted-wallet-approval-window',
    presentation: 'trusted-window',
    source: 'trusted-wallet-approval-window',
    selectedWalletIndex: 1,
    selectedAccount: '0x2222222222222222222222222222222222222222',
  });
});

test('trusted wallet signature decision returns a selected main-provided account choice', async () => {
  const promptPromise = presentTrustedWalletApprovalPrompt(
    request({
      kind: 'wallet.signature',
      method: 'personal_sign',
      details: {
        method: 'personal_sign',
        account: '0x1111111111111111111111111111111111111111',
        requestedAccount: '0x2222222222222222222222222222222222222222',
        messagePreview: '0x68656c6c6f',
        accountChoices: [
          {
            walletIndex: 0,
            name: 'Main Wallet',
            account: '0x1111111111111111111111111111111111111111',
            active: true,
          },
          {
            walletIndex: 1,
            name: 'Savings',
            account: '0x2222222222222222222222222222222222222222',
          },
        ],
      },
    }),
    {}
  );
  const promptWindow = mockWindows[0];

  const contextResult = await mockHandlers.get(channelFor('context', 'wallet-approval-request-1'))({
    sender: promptWindow.webContents,
  });
  expect(contextResult.context).toMatchObject({
    accountChoices: [
      {
        walletIndex: 0,
        account: '0x1111111111111111111111111111111111111111',
        active: true,
      },
      {
        walletIndex: 1,
        account: '0x2222222222222222222222222222222222222222',
        active: false,
      },
    ],
    rows: expect.arrayContaining([
      { label: 'Account', value: '0x1111111111111111111111111111111111111111' },
      { label: 'Requested account', value: '0x2222222222222222222222222222222222222222' },
    ]),
  });

  const decisionResult = await mockHandlers.get(channelFor('decision', 'wallet-approval-request-1'))(
    { sender: promptWindow.webContents },
    { action: 'accept', selectedWalletIndex: 1 }
  );
  expect(decisionResult).toEqual({ ok: true });
  await expect(promptPromise).resolves.toEqual({
    ok: true,
    outcome: 'accepted',
    response: 0,
    renderedBy: 'trusted-wallet-approval-window',
    presentation: 'trusted-window',
    source: 'trusted-wallet-approval-window',
    selectedWalletIndex: 1,
    selectedAccount: '0x2222222222222222222222222222222222222222',
  });
});

test('rejects decisions from unexpected senders without settling the prompt', async () => {
  const promptPromise = presentTrustedWalletApprovalPrompt(request(), {});
  const promptWindow = mockWindows[0];

  const mismatch = await mockHandlers.get(channelFor('decision', 'wallet-approval-request-1'))(
    { sender: { id: 999 } },
    { action: 'accept' }
  );

  expect(mismatch).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_WALLET_APPROVAL_SENDER_MISMATCH',
    }),
  });
  const reject = await mockHandlers.get(channelFor('decision', 'wallet-approval-request-1'))(
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
  const failed = await presentTrustedWalletApprovalPrompt(request(), {});

  expect(failed).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_WALLET_APPROVAL_LOAD_FAILED',
      message: 'boom',
    },
    renderedBy: 'trusted-wallet-approval-window',
    presentation: 'trusted-window',
    source: 'trusted-wallet-approval-window',
  });
  expect(mockHandlers.size).toBe(0);
});
