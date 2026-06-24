const mockHandlers = new Map();
const mockWindows = [];
let mockNextLoadError = null;
let mockNextLoadPromise = null;

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
    if (mockNextLoadPromise) {
      this.loadFile = jest.fn(() => mockNextLoadPromise);
    } else if (mockNextLoadError) {
      this.loadFile = jest.fn().mockRejectedValue(mockNextLoadError);
    } else {
      this.loadFile = jest.fn().mockResolvedValue(undefined);
    }
    mockNextLoadError = null;
    mockNextLoadPromise = null;
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

const mockGetDerivedWallets = jest.fn();
const mockGetActiveWalletIndex = jest.fn();
const mockGetActiveWalletAddress = jest.fn();
const mockExportPrivateKeyWithPassword = jest.fn();
jest.mock('./identity-manager', () => ({
  getDerivedWallets: (...args) => mockGetDerivedWallets(...args),
  getActiveWalletIndex: (...args) => mockGetActiveWalletIndex(...args),
  getActiveWalletAddress: (...args) => mockGetActiveWalletAddress(...args),
  exportPrivateKeyWithPassword: (...args) => mockExportPrivateKeyWithPassword(...args),
}));

const mockGetAllPermissions = jest.fn();
const mockRevokePermission = jest.fn();
jest.mock('./wallet/dapp-permissions', () => ({
  getAllPermissions: (...args) => mockGetAllPermissions(...args),
  revokePermission: (...args) => mockRevokePermission(...args),
}));

const {
  channelFor,
  openTrustedWalletSurface,
  closeTrustedWalletSurface,
  _resetForTest,
} = require('./trusted-wallet-surface');

function seedStores() {
  mockGetDerivedWallets.mockResolvedValue([
    {
      index: 0,
      name: 'Main Wallet',
      address: '0x1111111111111111111111111111111111111111',
    },
    {
      index: 1,
      name: 'Savings',
      address: '0x2222222222222222222222222222222222222222',
    },
  ]);
  mockGetActiveWalletIndex.mockReturnValue(1);
  mockGetActiveWalletAddress.mockResolvedValue('0x2222222222222222222222222222222222222222');
  mockExportPrivateKeyWithPassword.mockResolvedValue(
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  mockGetAllPermissions.mockReturnValue([
    {
      origin: 'https://app.example',
      walletIndex: 1,
      chainId: 100,
      connectedAt: 100,
      lastUsed: 200,
      autoApprove: { signing: false, transactions: [] },
    },
  ]);
  mockRevokePermission.mockReturnValue(true);
}

beforeEach(() => {
  mockHandlers.clear();
  mockWindows.length = 0;
  mockNextLoadError = null;
  mockNextLoadPromise = null;
  seedStores();
  jest.clearAllMocks();
  _resetForTest();
});

afterEach(() => {
  _resetForTest();
});

test('opens a shell-owned wallet window with dedicated preload and scoped channels', async () => {
  const ownerWindow = { id: 42 };
  const closed = jest.fn();
  const result = await openTrustedWalletSurface({
    ownerWindow,
    caller: { packageId: 'baby.freedom.chrome.official-local' },
    onClosed: closed,
  });

  expect(result).toMatchObject({
    ok: true,
    surface: 'wallet',
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
  expect(surfaceWindow.options.webPreferences.preload).toContain('trusted-wallet-preload.js');
  expect(surfaceWindow.loadFile).toHaveBeenCalledWith(
    expect.stringContaining('trusted-wallet.html'),
    { query: { surfaceId: expect.any(String) } }
  );

  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;
  const contextResult = await mockHandlers.get(channelFor('context', surfaceId))({
    sender: surfaceWindow.webContents,
  });
  expect(contextResult).toMatchObject({
    ok: true,
    context: {
      heading: 'Wallet Accounts',
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
      activeWalletIndex: 1,
      activeWalletAddress: '0x2222222222222222222222222222222222222222',
      wallets: [
        expect.objectContaining({ index: 0, name: 'Main Wallet' }),
        expect.objectContaining({ index: 1, name: 'Savings' }),
      ],
      permissions: [
        expect.objectContaining({
          origin: 'https://app.example',
          walletIndex: 1,
          chainId: 100,
        }),
      ],
      walletError: null,
    },
  });
});

test('returns after creating the trusted wallet window while presentation load continues', async () => {
  let resolveLoad;
  mockNextLoadPromise = new Promise((resolve) => {
    resolveLoad = resolve;
  });

  const result = await openTrustedWalletSurface({});

  expect(result).toMatchObject({
    ok: true,
    surface: 'wallet',
    owner: 'shell',
    trusted: true,
  });
  expect(mockWindows).toHaveLength(1);
  expect(mockWindows[0].loadFile).toHaveBeenCalled();
  expect(mockHandlers.size).toBe(5);
  resolveLoad();
});

test('rejects permission revocation from unexpected senders', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('revoke-permission', surfaceId))(
    { sender: { id: 999 } },
    { origin: 'https://app.example' }
  );

  expect(result).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_WALLET_SURFACE_SENDER_MISMATCH',
    }),
  });
  expect(mockRevokePermission).not.toHaveBeenCalled();
});

test('rejects private-key export from unexpected senders', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('export-private-key', surfaceId))(
    { sender: { id: 999 } },
    { walletIndex: 1, password: 'password123' }
  );

  expect(result).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_WALLET_SURFACE_SENDER_MISMATCH',
    }),
  });
  expect(mockExportPrivateKeyWithPassword).not.toHaveBeenCalled();
});

test('exports private keys only through the trusted surface window', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('export-private-key', surfaceId))(
    { sender: surfaceWindow.webContents },
    { walletIndex: 1, password: 'password123' }
  );

  expect(result).toEqual({
    ok: true,
    walletIndex: 1,
    privateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  expect(mockExportPrivateKeyWithPassword).toHaveBeenCalledWith(1, 'password123');
});

test('returns structured private-key export failures', async () => {
  mockExportPrivateKeyWithPassword.mockRejectedValueOnce(new Error('Incorrect password'));
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('export-private-key', surfaceId))(
    { sender: surfaceWindow.webContents },
    { walletIndex: 1, password: 'wrongpassword' }
  );

  expect(result).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_WALLET_SURFACE_EXPORT_PRIVATE_KEY_FAILED',
      message: 'Incorrect password',
    },
  });
});

test('revokes dApp permissions only through the trusted surface window', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('revoke-permission', surfaceId))(
    { sender: surfaceWindow.webContents },
    { origin: 'https://app.example' }
  );

  expect(result).toMatchObject({
    ok: true,
    revoked: true,
    snapshot: {
      permissions: [expect.objectContaining({ origin: 'https://app.example' })],
    },
  });
  expect(mockRevokePermission).toHaveBeenCalledWith('https://app.example');
  expect(surfaceWindow.webContents.send).toHaveBeenCalledWith(
    channelFor('snapshot-updated', surfaceId),
    expect.objectContaining({
      ok: true,
      snapshot: expect.objectContaining({
        activeWalletIndex: 1,
      }),
    })
  );
});

test('reuses an existing wallet surface and closes it cleanly', async () => {
  const firstClosed = jest.fn();
  const secondClosed = jest.fn();
  await openTrustedWalletSurface({ onClosed: firstClosed });
  const reused = await openTrustedWalletSurface({ onClosed: secondClosed });

  expect(reused).toMatchObject({
    ok: true,
    surface: 'wallet',
    reused: true,
  });
  expect(mockWindows).toHaveLength(1);
  expect(mockWindows[0].focus).toHaveBeenCalled();

  const closeResult = closeTrustedWalletSurface();
  expect(closeResult).toMatchObject({
    ok: true,
    surface: 'wallet',
    closed: true,
  });
  expect(firstClosed).toHaveBeenCalledTimes(1);
  expect(secondClosed).toHaveBeenCalledTimes(1);
  expect(mockHandlers.size).toBe(0);
});

test('asynchronous window load failure removes handlers and closes the surface', async () => {
  mockNextLoadError = new Error('boom');
  const result = await openTrustedWalletSurface({});

  expect(result).toMatchObject({
    ok: true,
    surface: 'wallet',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockHandlers.size).toBe(0);
  expect(mockWindows[0].close).toHaveBeenCalledTimes(1);
});
