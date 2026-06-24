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

const mockHasVault = jest.fn();
const mockIsVaultUnlocked = jest.fn();
const mockGetVaultMeta = jest.fn();
const mockGetIdentityStatus = jest.fn();
const mockCreateNewVault = jest.fn();
const mockImportExistingMnemonic = jest.fn();
const mockUnlockVault = jest.fn();
const mockLockVault = jest.fn();
const mockChangeVaultPassword = jest.fn();
const mockDeleteVaultData = jest.fn();
jest.mock('./identity-manager', () => ({
  hasVault: (...args) => mockHasVault(...args),
  isVaultUnlocked: (...args) => mockIsVaultUnlocked(...args),
  getVaultMeta: (...args) => mockGetVaultMeta(...args),
  getIdentityStatus: (...args) => mockGetIdentityStatus(...args),
  createNewVault: (...args) => mockCreateNewVault(...args),
  importExistingMnemonic: (...args) => mockImportExistingMnemonic(...args),
  unlockVault: (...args) => mockUnlockVault(...args),
  lockVault: (...args) => mockLockVault(...args),
  changeVaultPassword: (...args) => mockChangeVaultPassword(...args),
  deleteVaultData: (...args) => mockDeleteVaultData(...args),
}));

const mockCanUseTouchId = jest.fn();
const mockIsSecureStorageAvailable = jest.fn();
const mockIsQuickUnlockEnabled = jest.fn();
const mockEnableQuickUnlock = jest.fn();
const mockDisableQuickUnlock = jest.fn();
jest.mock('./quick-unlock', () => ({
  canUseTouchId: (...args) => mockCanUseTouchId(...args),
  isSecureStorageAvailable: (...args) => mockIsSecureStorageAvailable(...args),
  isQuickUnlockEnabled: (...args) => mockIsQuickUnlockEnabled(...args),
  enableQuickUnlock: (...args) => mockEnableQuickUnlock(...args),
  disableQuickUnlock: (...args) => mockDisableQuickUnlock(...args),
}));

const {
  channelFor,
  openTrustedIdentitySurface,
  closeTrustedIdentitySurface,
  _resetForTest,
} = require('./trusted-identity-surface');

function seedIdentityState() {
  mockHasVault.mockResolvedValue(true);
  mockIsVaultUnlocked.mockResolvedValue(false);
  mockGetVaultMeta.mockReturnValue({
    userKnowsPassword: true,
    addresses: {
      userWallet: '0x1111111111111111111111111111111111111111',
      beeWallet: '0x2222222222222222222222222222222222222222',
    },
  });
  mockGetIdentityStatus.mockResolvedValue({
    hasVault: true,
    isUnlocked: false,
    beeInjected: false,
    ipfsInjected: false,
    radicleInjected: false,
  });
  mockCreateNewVault.mockResolvedValue(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  );
  mockImportExistingMnemonic.mockResolvedValue(undefined);
  mockUnlockVault.mockResolvedValue(undefined);
  mockLockVault.mockResolvedValue(undefined);
  mockChangeVaultPassword.mockResolvedValue(undefined);
  mockDeleteVaultData.mockResolvedValue(undefined);
  mockCanUseTouchId.mockReturnValue(true);
  mockIsSecureStorageAvailable.mockReturnValue(true);
  mockIsQuickUnlockEnabled.mockReturnValue(false);
  mockEnableQuickUnlock.mockImplementation(async () => {
    mockIsQuickUnlockEnabled.mockReturnValue(true);
    return { success: true };
  });
  mockDisableQuickUnlock.mockImplementation(() => {
    mockIsQuickUnlockEnabled.mockReturnValue(false);
    return { success: true };
  });
}

beforeEach(() => {
  mockHandlers.clear();
  mockWindows.length = 0;
  mockNextLoadError = null;
  seedIdentityState();
  jest.clearAllMocks();
  _resetForTest();
});

afterEach(() => {
  _resetForTest();
});

test('opens a shell-owned identity window with dedicated preload and scoped channels', async () => {
  const ownerWindow = { id: 42 };
  const closed = jest.fn();
  const result = await openTrustedIdentitySurface({
    ownerWindow,
    caller: { packageId: 'baby.freedom.chrome.official-local' },
    onClosed: closed,
  });

  expect(result).toMatchObject({
    ok: true,
    surface: 'identity',
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
  expect(surfaceWindow.options.webPreferences.preload).toContain('trusted-identity-preload.js');
  expect(surfaceWindow.loadFile).toHaveBeenCalledWith(
    expect.stringContaining('trusted-identity.html'),
    { query: { surfaceId: expect.any(String) } }
  );

  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;
  const contextResult = await mockHandlers.get(channelFor('context', surfaceId))({
    sender: surfaceWindow.webContents,
  });
  expect(contextResult).toMatchObject({
    ok: true,
    context: {
      heading: 'Identity And Vault',
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
      hasVault: true,
      isUnlocked: false,
      vaultMeta: {
        addresses: {
          userWallet: '0x1111111111111111111111111111111111111111',
        },
      },
      status: {
        beeInjected: false,
      },
      quickUnlock: {
        canUseTouchId: true,
        secureStorageAvailable: true,
        enabled: false,
      },
      identityError: null,
    },
  });
});

test('rejects identity requests from unexpected senders', async () => {
  await openTrustedIdentitySurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('unlock', surfaceId))(
    { sender: { id: 999 } },
    { password: 'password123' }
  );

  expect(result).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_IDENTITY_SURFACE_SENDER_MISMATCH',
    }),
  });
  expect(mockUnlockVault).not.toHaveBeenCalled();
});

test('creates and imports vaults only through the trusted surface window', async () => {
  await openTrustedIdentitySurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const createResult = await mockHandlers.get(channelFor('create-vault', surfaceId))(
    { sender: surfaceWindow.webContents },
    { password: 'password123', strength: 128 }
  );

  expect(createResult).toMatchObject({
    ok: true,
    mnemonic: expect.stringContaining('abandon'),
    snapshot: {
      hasVault: true,
    },
  });
  expect(mockCreateNewVault).toHaveBeenCalledWith('password123', 128, true);
  expect(surfaceWindow.webContents.send).toHaveBeenCalledWith(
    channelFor('snapshot-updated', surfaceId),
    expect.objectContaining({
      ok: true,
      snapshot: expect.objectContaining({ hasVault: true }),
    })
  );

  const importResult = await mockHandlers.get(channelFor('import-mnemonic', surfaceId))(
    { sender: surfaceWindow.webContents },
    {
      password: 'password123',
      mnemonic: ' abandon   abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about ',
    }
  );

  expect(importResult).toMatchObject({
    ok: true,
    snapshot: {
      hasVault: true,
    },
  });
  expect(mockImportExistingMnemonic).toHaveBeenCalledWith(
    'password123',
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    true
  );
});

test('unlocks and locks vault through scoped trusted-window channels', async () => {
  await openTrustedIdentitySurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const unlockResult = await mockHandlers.get(channelFor('unlock', surfaceId))(
    { sender: surfaceWindow.webContents },
    { password: 'password123' }
  );

  expect(unlockResult).toMatchObject({
    ok: true,
    snapshot: {
      hasVault: true,
    },
  });
  expect(mockUnlockVault).toHaveBeenCalledWith('password123');

  const lockResult = await mockHandlers.get(channelFor('lock', surfaceId))({
    sender: surfaceWindow.webContents,
  });

  expect(lockResult).toMatchObject({
    ok: true,
    snapshot: {
      hasVault: true,
    },
  });
  expect(mockLockVault).toHaveBeenCalled();
});

test('changes vault password through scoped trusted-window channel', async () => {
  mockIsQuickUnlockEnabled.mockReturnValue(true);
  await openTrustedIdentitySurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('change-password', surfaceId))(
    { sender: surfaceWindow.webContents },
    { currentPassword: 'oldpassword', newPassword: 'newpassword123' }
  );

  expect(result).toMatchObject({
    ok: true,
    snapshot: {
      quickUnlock: {
        enabled: false,
      },
    },
  });
  expect(mockChangeVaultPassword).toHaveBeenCalledWith('oldpassword', 'newpassword123');
  expect(mockDisableQuickUnlock).toHaveBeenCalledTimes(1);
});

test('deletes the vault only after typed confirmation', async () => {
  mockDeleteVaultData.mockImplementation(async () => {
    mockHasVault.mockResolvedValue(false);
    mockIsVaultUnlocked.mockResolvedValue(false);
    mockGetVaultMeta.mockReturnValue(null);
  });
  await openTrustedIdentitySurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const rejected = await mockHandlers.get(channelFor('delete-vault', surfaceId))(
    { sender: surfaceWindow.webContents },
    { password: 'password123', confirmation: 'delete' }
  );

  expect(rejected).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_IDENTITY_SURFACE_DELETE_VAULT_FAILED',
    }),
  });
  expect(mockDeleteVaultData).not.toHaveBeenCalled();

  const accepted = await mockHandlers.get(channelFor('delete-vault', surfaceId))(
    { sender: surfaceWindow.webContents },
    { password: 'password123', confirmation: 'DELETE' }
  );

  expect(accepted).toMatchObject({
    ok: true,
    snapshot: {
      hasVault: false,
    },
  });
  expect(mockDeleteVaultData).toHaveBeenCalledWith('password123');
  expect(mockDisableQuickUnlock).toHaveBeenCalledTimes(1);
});

test('enables and disables quick unlock through scoped trusted-window channels', async () => {
  await openTrustedIdentitySurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const enabled = await mockHandlers.get(channelFor('enable-quick-unlock', surfaceId))(
    { sender: surfaceWindow.webContents },
    { password: 'password123' }
  );

  expect(enabled).toMatchObject({
    ok: true,
    snapshot: {
      quickUnlock: {
        canUseTouchId: true,
        enabled: true,
      },
    },
  });
  expect(mockEnableQuickUnlock).toHaveBeenCalledWith('password123');

  const disabled = await mockHandlers.get(channelFor('disable-quick-unlock', surfaceId))({
    sender: surfaceWindow.webContents,
  });

  expect(disabled).toMatchObject({
    ok: true,
    snapshot: {
      quickUnlock: {
        secureStorageAvailable: true,
        enabled: false,
      },
    },
  });
  expect(mockDisableQuickUnlock).toHaveBeenCalledTimes(1);
});

test('reuses and closes the active trusted identity window', async () => {
  const first = await openTrustedIdentitySurface({});
  const second = await openTrustedIdentitySurface({});

  expect(first).toMatchObject({ ok: true, reused: false });
  expect(second).toMatchObject({ ok: true, reused: true });
  expect(mockWindows).toHaveLength(1);
  expect(mockWindows[0].show).toHaveBeenCalled();
  expect(mockWindows[0].focus).toHaveBeenCalled();

  const closed = closeTrustedIdentitySurface();
  expect(closed).toMatchObject({
    ok: true,
    surface: 'identity',
    closed: true,
  });
  expect(mockWindows[0].close).toHaveBeenCalled();
});
