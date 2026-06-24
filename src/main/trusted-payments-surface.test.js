const mockHandlers = new Map();
const mockWindows = [];
let mockNextLoadError = null;

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

const mockGetAllPermissions = jest.fn();
const mockUpdatePermission = jest.fn();
const mockRevoke = jest.fn();
const mockRevokeAllForOrigin = jest.fn();
jest.mock('./x402/permissions', () => ({
  getAllPermissions: (...args) => mockGetAllPermissions(...args),
  updatePermission: (...args) => mockUpdatePermission(...args),
  revoke: (...args) => mockRevoke(...args),
  revokeAllForOrigin: (...args) => mockRevokeAllForOrigin(...args),
}));

const mockGetRecent = jest.fn();
const mockGetCount = jest.fn();
const mockClear = jest.fn();
jest.mock('./payment-history', () => ({
  getRecent: (...args) => mockGetRecent(...args),
  getCount: (...args) => mockGetCount(...args),
  clear: (...args) => mockClear(...args),
}));

const {
  channelFor,
  openTrustedPaymentsSurface,
  closeTrustedPaymentsSurface,
  _resetForTest,
} = require('./trusted-payments-surface');

function seedStores() {
  mockGetAllPermissions.mockReturnValue([
    {
      origin: 'https://api.example',
      chainId: 8453,
      asset: '0xToken',
      capAmount: '1000000',
      spentAmount: '250000',
      createdAt: 100,
      expiresAt: 200,
    },
  ]);
  mockGetRecent.mockReturnValue([
    {
      id: 1,
      kind: 'x402',
      chainId: 8453,
      amount: '250000',
      asset: '0xToken',
      origin: 'https://api.example',
      status: 'confirmed',
      createdAt: 123,
    },
  ]);
  mockGetCount.mockReturnValue(1);
  mockUpdatePermission.mockReturnValue({
    origin: 'https://api.example',
    chainId: 8453,
    asset: '0xToken',
    capAmount: '2000000',
    spentAmount: '250000',
    createdAt: 100,
    expiresAt: 300,
  });
  mockClear.mockReturnValue(1);
}

beforeEach(() => {
  mockHandlers.clear();
  mockWindows.length = 0;
  mockNextLoadError = null;
  seedStores();
  jest.clearAllMocks();
  _resetForTest();
});

afterEach(() => {
  _resetForTest();
});

test('opens a shell-owned payments window with dedicated preload and scoped channels', async () => {
  const ownerWindow = { id: 42 };
  const closed = jest.fn();
  const result = await openTrustedPaymentsSurface({
    ownerWindow,
    caller: { packageId: 'baby.freedom.chrome.official-local' },
    onClosed: closed,
  });

  expect(result).toMatchObject({
    ok: true,
    surface: 'payments',
    owner: 'shell',
    trusted: true,
  });
  expect(mockWindows).toHaveLength(1);
  const surfaceWindow = mockWindows[0];
  expect(surfaceWindow.options.parent).toBe(ownerWindow);
  expect(surfaceWindow.options.webPreferences).toEqual(expect.objectContaining({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  }));
  expect(surfaceWindow.options.webPreferences.preload).toContain('trusted-payments-preload.js');
  expect(surfaceWindow.loadFile).toHaveBeenCalledWith(
    expect.stringContaining('trusted-payments.html'),
    { query: { surfaceId: expect.any(String) } }
  );

  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;
  const contextResult = await mockHandlers.get(channelFor('context', surfaceId))({
    sender: surfaceWindow.webContents,
  });
  expect(contextResult).toMatchObject({
    ok: true,
    context: {
      heading: 'Payment Permissions',
      surfaceOwner: 'shell',
      trusted: true,
      caller: { packageId: 'baby.freedom.chrome.official-local' },
    },
  });

  const snapshotResult = await mockHandlers.get(channelFor('snapshot', surfaceId))({
    sender: surfaceWindow.webContents,
  });
  expect(snapshotResult).toMatchObject({
    ok: true,
    snapshot: {
      permissions: [expect.objectContaining({ origin: 'https://api.example' })],
      payments: [expect.objectContaining({ kind: 'x402' })],
      paymentCount: 1,
      historyLimit: 100,
    },
  });
  expect(mockGetRecent).toHaveBeenCalledWith({ limit: 100 });
});

test('rejects x402 mutations from unexpected senders', async () => {
  await openTrustedPaymentsSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('update-permission', surfaceId))(
    { sender: { id: 999 } },
    {
      origin: 'https://api.example',
      chainId: 8453,
      asset: '0xToken',
      capAmount: '2000000',
    }
  );

  expect(result).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_PAYMENTS_SURFACE_SENDER_MISMATCH',
    }),
  });
  expect(mockUpdatePermission).not.toHaveBeenCalled();
});

test('updates and revokes x402 caps only through the trusted surface window', async () => {
  await openTrustedPaymentsSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;
  const sender = { sender: surfaceWindow.webContents };

  const updateResult = await mockHandlers.get(channelFor('update-permission', surfaceId))(sender, {
    origin: 'https://api.example',
    chainId: 8453,
    asset: '0xToken',
    capAmount: '2000000',
    windowSeconds: 604800,
  });
  expect(updateResult).toMatchObject({
    ok: true,
    permission: {
      origin: 'https://api.example',
      capAmount: '2000000',
    },
    snapshot: {
      permissions: expect.any(Array),
    },
  });
  expect(mockUpdatePermission).toHaveBeenCalledWith('https://api.example', 8453, '0xToken', {
    capAmount: '2000000',
    windowSeconds: 604800,
  });

  const revokeResult = await mockHandlers.get(channelFor('revoke-permission', surfaceId))(sender, {
    origin: 'https://api.example',
    chainId: 8453,
    asset: '0xToken',
  });
  expect(revokeResult).toMatchObject({ ok: true });
  expect(mockRevoke).toHaveBeenCalledWith('https://api.example', 8453, '0xToken');

  const revokeAllResult = await mockHandlers.get(channelFor('revoke-all-for-origin', surfaceId))(
    sender,
    { origin: 'https://api.example' }
  );
  expect(revokeAllResult).toMatchObject({ ok: true });
  expect(mockRevokeAllForOrigin).toHaveBeenCalledWith('https://api.example');
});

test('cleans handlers and notifies caller state listeners when closed', async () => {
  const closed = jest.fn();
  await openTrustedPaymentsSurface({ onClosed: closed });
  const surfaceWindow = mockWindows[0];
  expect(mockHandlers.size).toBeGreaterThan(0);

  const result = closeTrustedPaymentsSurface();

  expect(result).toMatchObject({ ok: true, surface: 'payments', closed: true });
  expect(surfaceWindow.close).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(mockHandlers.size).toBe(0);
});

test('load failure returns a presentation error and removes handlers', async () => {
  mockNextLoadError = new Error('boom');

  const result = await openTrustedPaymentsSurface({});

  expect(result).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_PAYMENTS_SURFACE_LOAD_FAILED',
      message: 'boom',
    },
  });
  expect(mockHandlers.size).toBe(0);
});
