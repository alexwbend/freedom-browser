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

const mockUnlockVault = jest.fn();
jest.mock('./identity-manager', () => ({
  unlockVault: (...args) => mockUnlockVault(...args),
}));

const {
  buildPromptContext,
  channelFor,
  presentTrustedVaultUnlockPrompt,
} = require('./trusted-vault-unlock-prompt');

function request() {
  return {
    requestId: 'vault-request-1',
    reason: 'x402 vault unlock request from https://api.example',
    origin: 'https://api.example',
    details: {
      amount: '10000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      network: 'eip155:8453',
      payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
      resource: 'https://api.example/article',
    },
  };
}

beforeEach(() => {
  mockHandlers.clear();
  mockWindows.length = 0;
  mockNextLoadError = null;
  mockUnlockVault.mockReset().mockResolvedValue(undefined);
  jest.clearAllMocks();
});

test('buildPromptContext keeps only serializable display details', () => {
  expect(buildPromptContext(request())).toEqual({
    title: 'Unlock Vault',
    heading: 'Unlock vault for x402 payment',
    origin: 'https://api.example',
    reason: 'x402 vault unlock request from https://api.example',
    rows: [
      { label: 'Amount', value: '10000' },
      { label: 'Asset', value: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
      { label: 'Network', value: 'eip155:8453' },
      { label: 'Pay to', value: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C' },
      { label: 'Resource', value: 'https://api.example/article' },
    ],
  });
});

test('buildPromptContext describes wallet transaction unlock requests', () => {
  expect(buildPromptContext({
    kind: 'wallet.transaction',
    method: 'eth_sendTransaction',
    reason: 'Wallet vault unlock request from https://app.example',
    origin: 'https://app.example',
    details: {
      account: '0x1111111111111111111111111111111111111111',
      to: '0x0000000000000000000000000000000000000001',
      value: '0x2a',
      chainId: 100,
    },
  })).toEqual({
    title: 'Unlock Vault',
    heading: 'Unlock vault for wallet transaction',
    origin: 'https://app.example',
    reason: 'Wallet vault unlock request from https://app.example',
    rows: [
      { label: 'Method', value: 'eth_sendTransaction' },
      { label: 'Account', value: '0x1111111111111111111111111111111111111111' },
      { label: 'To', value: '0x0000000000000000000000000000000000000001' },
      { label: 'Value', value: '0x2a' },
      { label: 'Chain', value: '100' },
    ],
  });
});

test('creates a modal shell-owned window with a dedicated preload and prompt channels', async () => {
  const ownerWindow = { id: 42 };
  const promptPromise = presentTrustedVaultUnlockPrompt(request(), { ownerWindow });

  expect(mockWindows).toHaveLength(1);
  const promptWindow = mockWindows[0];
  expect(promptWindow.options.parent).toBe(ownerWindow);
  expect(promptWindow.options.modal).toBe(true);
  expect(promptWindow.options.webPreferences).toEqual(expect.objectContaining({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  }));
  expect(promptWindow.options.webPreferences.preload).toContain('trusted-vault-unlock-preload.js');
  expect(promptWindow.loadFile).toHaveBeenCalledWith(
    expect.stringContaining('trusted-vault-unlock.html'),
    { query: { requestId: 'vault-request-1' } }
  );

  const contextResult = await mockHandlers.get(channelFor('context', 'vault-request-1'))({
    sender: promptWindow.webContents,
  });
  expect(contextResult).toEqual(expect.objectContaining({
    ok: true,
    context: expect.objectContaining({
      origin: 'https://api.example',
    }),
  }));

  const submitResult = await mockHandlers.get(channelFor('submit', 'vault-request-1'))(
    { sender: promptWindow.webContents },
    'correct-password'
  );
  expect(submitResult).toEqual({ ok: true });
  const result = await promptPromise;

  expect(mockUnlockVault).toHaveBeenCalledWith('correct-password');
  expect(result).toEqual({ ok: true, outcome: 'accepted', response: 0 });
  expect(mockHandlers.size).toBe(0);
});

test('rejects submit requests from unexpected senders without unlocking', async () => {
  const promptPromise = presentTrustedVaultUnlockPrompt(request(), {});
  const promptWindow = mockWindows[0];
  const submitResult = await mockHandlers.get(channelFor('submit', 'vault-request-1'))(
    { sender: { id: 999 } },
    'password'
  );

  expect(submitResult).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_VAULT_UNLOCK_SENDER_MISMATCH',
    }),
  });
  expect(mockUnlockVault).not.toHaveBeenCalled();

  await mockHandlers.get(channelFor('cancel', 'vault-request-1'))({
    sender: promptWindow.webContents,
  });
  await expect(promptPromise).resolves.toEqual({
    ok: true,
    outcome: 'rejected',
    response: 1,
  });
});

test('keeps the prompt open after a bad password and resolves after cancel', async () => {
  mockUnlockVault.mockRejectedValueOnce(new Error('Incorrect password'));
  const promptPromise = presentTrustedVaultUnlockPrompt(request(), {});
  const promptWindow = mockWindows[0];

  const failedSubmit = await mockHandlers.get(channelFor('submit', 'vault-request-1'))(
    { sender: promptWindow.webContents },
    'wrong-password'
  );
  expect(failedSubmit).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_VAULT_UNLOCK_FAILED',
      message: 'Incorrect password',
    },
  });
  expect(promptWindow.close).not.toHaveBeenCalled();

  const cancelResult = await mockHandlers.get(channelFor('cancel', 'vault-request-1'))({
    sender: promptWindow.webContents,
  });
  expect(cancelResult).toEqual({ ok: true });
  await expect(promptPromise).resolves.toEqual({
    ok: true,
    outcome: 'rejected',
    response: 1,
  });
  expect(mockHandlers.size).toBe(0);
});

test('window load failure returns a presentation error and removes handlers', async () => {
  mockNextLoadError = new Error('boom');
  const failed = await presentTrustedVaultUnlockPrompt(request(), {});

  expect(failed).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_VAULT_UNLOCK_LOAD_FAILED',
      message: 'boom',
    },
  });
  expect(mockHandlers.size).toBe(0);
});
