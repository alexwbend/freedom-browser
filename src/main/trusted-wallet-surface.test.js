const mockHandlers = new Map();
const mockWindows = [];
const mockViews = [];
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

class MockWebContentsView {
  constructor(options) {
    this.options = options;
    this.webContents = {
      id: 100 + mockViews.length,
      send: jest.fn(),
      loadFile: jest.fn().mockResolvedValue(undefined),
      isDestroyed: jest.fn(() => false),
      close: jest.fn(),
      getURL: jest.fn(() => 'file:///trusted-wallet.html'),
    };
    mockViews.push(this);
  }
}

jest.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  WebContentsView: MockWebContentsView,
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
const mockExportMnemonicWithPassword = jest.fn();
const mockExportPrivateKeyWithPassword = jest.fn();
const mockSetActiveWalletIndex = jest.fn();
const mockCreateDerivedWallet = jest.fn();
const mockRenameDerivedWallet = jest.fn();
const mockDeleteDerivedWallet = jest.fn();
jest.mock('./identity-manager', () => ({
  getDerivedWallets: (...args) => mockGetDerivedWallets(...args),
  getActiveWalletIndex: (...args) => mockGetActiveWalletIndex(...args),
  getActiveWalletAddress: (...args) => mockGetActiveWalletAddress(...args),
  exportMnemonicWithPassword: (...args) => mockExportMnemonicWithPassword(...args),
  exportPrivateKeyWithPassword: (...args) => mockExportPrivateKeyWithPassword(...args),
  setActiveWalletIndex: (...args) => mockSetActiveWalletIndex(...args),
  createDerivedWallet: (...args) => mockCreateDerivedWallet(...args),
  renameDerivedWallet: (...args) => mockRenameDerivedWallet(...args),
  deleteDerivedWallet: (...args) => mockDeleteDerivedWallet(...args),
}));

const mockGetAllPermissions = jest.fn();
const mockRevokePermission = jest.fn();
jest.mock('./wallet/dapp-permissions', () => ({
  getAllPermissions: (...args) => mockGetAllPermissions(...args),
  revokePermission: (...args) => mockRevokePermission(...args),
}));

const mockGetShellTheme = jest.fn();
const mockLoadSettings = jest.fn();
const mockSaveSettings = jest.fn();
const mockOnSettingsUpdated = jest.fn();
jest.mock('./settings-store', () => ({
  getShellTheme: (...args) => mockGetShellTheme(...args),
  loadSettings: (...args) => mockLoadSettings(...args),
  saveSettings: (...args) => mockSaveSettings(...args),
  onSettingsUpdated: (...args) => mockOnSettingsUpdated(...args),
}));

const {
  channelFor,
  openTrustedWalletSurface,
  closeTrustedWalletSurface,
  _resetForTest,
} = require('./trusted-wallet-surface');

function seedStores() {
  mockGetShellTheme.mockImplementation((settings) =>
    settings?.shellTheme || {
      mode: 'system',
      effective: 'light',
    }
  );
  mockLoadSettings.mockReturnValue({
    walletSurfaceLayoutMode: 'dock',
  });
  mockSaveSettings.mockReturnValue(true);
  mockOnSettingsUpdated.mockReturnValue(jest.fn());
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
  mockExportMnemonicWithPassword.mockResolvedValue(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  );
  mockExportPrivateKeyWithPassword.mockResolvedValue(
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  mockSetActiveWalletIndex.mockResolvedValue(undefined);
  mockCreateDerivedWallet.mockResolvedValue({
    index: 2,
    name: 'Trading',
    address: '0x3333333333333333333333333333333333333333',
  });
  mockRenameDerivedWallet.mockResolvedValue(undefined);
  mockDeleteDerivedWallet.mockResolvedValue(undefined);
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

function resetStoreMocks() {
  [
    mockGetDerivedWallets,
    mockGetActiveWalletIndex,
    mockGetActiveWalletAddress,
    mockExportMnemonicWithPassword,
    mockExportPrivateKeyWithPassword,
    mockSetActiveWalletIndex,
    mockCreateDerivedWallet,
    mockRenameDerivedWallet,
    mockDeleteDerivedWallet,
    mockGetAllPermissions,
    mockRevokePermission,
    mockGetShellTheme,
    mockLoadSettings,
    mockSaveSettings,
    mockOnSettingsUpdated,
  ].forEach((mock) => mock.mockReset());
}

beforeEach(() => {
  mockHandlers.clear();
  mockWindows.length = 0;
  mockViews.length = 0;
  mockNextLoadError = null;
  mockNextLoadPromise = null;
  resetStoreMocks();
  seedStores();
  jest.clearAllMocks();
  _resetForTest();
});

function createCompositorSurfaceWindow(ownerWindow) {
  const events = new Map();
  const surfaceWindow = {
    destroyed: false,
    webContents: {
      id: 500,
      send: jest.fn(),
    },
    show: jest.fn(),
    focus: jest.fn(),
    loadFile: jest.fn().mockResolvedValue(undefined),
    layoutMode: 'dock',
    getLayoutMode: jest.fn(() => surfaceWindow.layoutMode),
    setLayoutMode: jest.fn((layoutMode) => {
      surfaceWindow.layoutMode = layoutMode;
      return surfaceWindow.layoutMode;
    }),
    close: jest.fn(() => {
      if (surfaceWindow.destroyed) {
        return;
      }
      surfaceWindow.destroyed = true;
      events.get('closed')?.();
    }),
    once: jest.fn((event, callback) => {
      events.set(event, callback);
    }),
    isDestroyed: jest.fn(() => surfaceWindow.destroyed),
    getNativeOwnerWindow: jest.fn(() => ownerWindow),
  };
  return surfaceWindow;
}

function createCompositorOwnerWindow() {
  const ownerWindow = { id: 42 };
  const surfaceWindow = createCompositorSurfaceWindow(ownerWindow);
  ownerWindow.__freedomShellWindow = {
    canHostTrustedSurfaceWindows: jest.fn(() => true),
    createTrustedSurfaceWindow: jest.fn((options) => {
      surfaceWindow.layoutMode = options.layoutMode || surfaceWindow.layoutMode;
      surfaceWindow.createdView = options.createView();
      return surfaceWindow;
    }),
  };
  return { ownerWindow, surfaceWindow };
}

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
      surface: 'wallet',
      title: 'Freedom Wallet',
      heading: 'Wallet Accounts',
      surfaceOwner: 'shell',
      trusted: true,
      caller: { packageId: 'baby.freedom.chrome.official-local' },
      mode: 'shell-owned-trusted-window',
      layoutMode: null,
      theme: {
        mode: 'system',
        effective: 'light',
      },
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

test('opens wallet as a shell compositor view when the owner window supports surfaces', async () => {
  const { ownerWindow, surfaceWindow } = createCompositorOwnerWindow();
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
    mode: 'shell-owned-webcontents-view',
  });
  expect(mockWindows).toHaveLength(0);
  expect(mockViews).toHaveLength(1);
  expect(ownerWindow.__freedomShellWindow.createTrustedSurfaceWindow).toHaveBeenCalledWith(
    expect.objectContaining({
      surface: 'wallet',
      width: 360,
      minWidth: 320,
      layoutMode: 'dock',
      createView: expect.any(Function),
    })
  );
  expect(mockViews[0].options.webPreferences).toEqual(expect.objectContaining({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  }));
  expect(mockViews[0].options.webPreferences.preload).toContain('trusted-wallet-preload.js');
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
      surface: 'wallet',
      surfaceOwner: 'shell',
      trusted: true,
      caller: { packageId: 'baby.freedom.chrome.official-local' },
      mode: 'shell-owned-webcontents-view',
      layoutMode: 'dock',
      theme: {
        mode: 'system',
        effective: 'light',
      },
    },
  });

  const closeResult = closeTrustedWalletSurface();
  expect(closeResult).toMatchObject({
    ok: true,
    surface: 'wallet',
    mode: 'shell-owned-webcontents-view',
    layoutMode: 'dock',
    closed: true,
  });
  expect(surfaceWindow.close).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(mockHandlers.size).toBe(0);
});

test('opens wallet compositor view with the saved surface layout mode', async () => {
  mockLoadSettings.mockReturnValue({ walletSurfaceLayoutMode: 'overlay' });
  const { ownerWindow, surfaceWindow } = createCompositorOwnerWindow();
  const result = await openTrustedWalletSurface({
    ownerWindow,
    caller: { packageId: 'baby.freedom.chrome.official-local' },
  });

  expect(result).toMatchObject({
    ok: true,
    mode: 'shell-owned-webcontents-view',
    layoutMode: 'overlay',
  });
  expect(ownerWindow.__freedomShellWindow.createTrustedSurfaceWindow).toHaveBeenCalledWith(
    expect.objectContaining({
      layoutMode: 'overlay',
    })
  );

  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;
  const contextResult = await mockHandlers.get(channelFor('context', surfaceId))({
    sender: surfaceWindow.webContents,
  });
  expect(contextResult.context.layoutMode).toBe('overlay');
});

test('falls back to a trusted window when the shell window cannot host surfaces', async () => {
  const ownerWindow = {
    id: 42,
    __freedomShellWindow: {
      canHostTrustedSurfaceWindows: jest.fn(() => false),
      createTrustedSurfaceWindow: jest.fn(() => {
        throw new Error('should not be called');
      }),
    },
  };
  const result = await openTrustedWalletSurface({
    ownerWindow,
    caller: { packageId: 'builtin' },
  });

  expect(result).toMatchObject({
    ok: true,
    surface: 'wallet',
    owner: 'shell',
    trusted: true,
    mode: 'shell-owned-trusted-window',
  });
  expect(mockWindows).toHaveLength(1);
  expect(mockViews).toHaveLength(0);
  expect(ownerWindow.__freedomShellWindow.createTrustedSurfaceWindow).not.toHaveBeenCalled();
  expect(mockWindows[0].options.parent).toBe(ownerWindow);
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
  expect(mockHandlers.size).toBe(11);
  resolveLoad();
});

test('sets compositor wallet layout only through the trusted surface window', async () => {
  const { ownerWindow, surfaceWindow } = createCompositorOwnerWindow();
  await openTrustedWalletSurface({ ownerWindow });
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('set-layout-mode', surfaceId))(
    { sender: surfaceWindow.webContents },
    { layoutMode: 'overlay' }
  );

  expect(result).toEqual({
    ok: true,
    layoutMode: 'overlay',
  });
  expect(surfaceWindow.setLayoutMode).toHaveBeenCalledWith('overlay');
  expect(mockSaveSettings).toHaveBeenCalledWith({
    walletSurfaceLayoutMode: 'overlay',
  });
  expect(surfaceWindow.webContents.send).toHaveBeenCalledWith(
    channelFor('layout-updated', surfaceId),
    {
      ok: true,
      layoutMode: 'overlay',
    }
  );

  const contextResult = await mockHandlers.get(channelFor('context', surfaceId))({
    sender: surfaceWindow.webContents,
  });
  expect(contextResult.context.layoutMode).toBe('overlay');
});

test('rejects wallet layout changes from unexpected senders', async () => {
  const { ownerWindow, surfaceWindow } = createCompositorOwnerWindow();
  await openTrustedWalletSurface({ ownerWindow });
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('set-layout-mode', surfaceId))(
    { sender: { id: 999 } },
    { layoutMode: 'overlay' }
  );

  expect(result).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_WALLET_SURFACE_SENDER_MISMATCH',
    }),
  });
  expect(surfaceWindow.setLayoutMode).not.toHaveBeenCalled();
});

test('rejects wallet management requests from unexpected senders', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('set-active-wallet', surfaceId))(
    { sender: { id: 999 } },
    { walletIndex: 0 }
  );

  expect(result).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_WALLET_SURFACE_SENDER_MISMATCH',
    }),
  });
  expect(mockSetActiveWalletIndex).not.toHaveBeenCalled();
});

test('sets the active wallet only through the trusted surface window', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('set-active-wallet', surfaceId))(
    { sender: surfaceWindow.webContents },
    { walletIndex: 0 }
  );

  expect(result).toMatchObject({
    ok: true,
    walletIndex: 0,
    snapshot: {
      activeWalletIndex: 1,
    },
  });
  expect(mockSetActiveWalletIndex).toHaveBeenCalledWith(0);
  expect(surfaceWindow.webContents.send).toHaveBeenCalledWith(
    channelFor('snapshot-updated', surfaceId),
    expect.objectContaining({
      ok: true,
      snapshot: expect.objectContaining({
        wallets: expect.any(Array),
      }),
    })
  );
});

test('creates derived wallets only through the trusted surface window', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('create-wallet', surfaceId))(
    { sender: surfaceWindow.webContents },
    { name: ' Trading ' }
  );

  expect(result).toMatchObject({
    ok: true,
    wallet: {
      index: 2,
      name: 'Trading',
      address: '0x3333333333333333333333333333333333333333',
    },
    snapshot: {
      wallets: expect.any(Array),
    },
  });
  expect(mockCreateDerivedWallet).toHaveBeenCalledWith('Trading');
});

test('unlocks the vault and retries trusted wallet creation when the vault is locked', async () => {
  const presentVaultUnlockPrompt = jest.fn().mockResolvedValue({
    ok: true,
    outcome: 'accepted',
    response: 0,
  });
  mockCreateDerivedWallet
    .mockRejectedValueOnce(new Error('Vault must be unlocked to create a new wallet'))
    .mockResolvedValueOnce({
      index: 2,
      name: 'Trading',
      address: '0x3333333333333333333333333333333333333333',
    });
  await openTrustedWalletSurface(
    { caller: { packageId: 'baby.freedom.chrome.official-local' } },
    { presentVaultUnlockPrompt }
  );
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('create-wallet', surfaceId))(
    { sender: surfaceWindow.webContents },
    { name: ' Trading ' }
  );

  expect(result).toMatchObject({
    ok: true,
    wallet: {
      index: 2,
      name: 'Trading',
      address: '0x3333333333333333333333333333333333333333',
    },
  });
  expect(mockCreateDerivedWallet).toHaveBeenCalledTimes(2);
  expect(mockCreateDerivedWallet).toHaveBeenNthCalledWith(1, 'Trading');
  expect(mockCreateDerivedWallet).toHaveBeenNthCalledWith(2, 'Trading');
  expect(presentVaultUnlockPrompt).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'wallet.management',
      method: 'wallet.createDerivedWallet',
      heading: 'Unlock vault to create wallet',
      origin: 'Freedom Wallet',
      rows: [
        { label: 'Action', value: 'Create wallet' },
        { label: 'Wallet name', value: 'Trading' },
      ],
    }),
    expect.objectContaining({
      ownerWindow: surfaceWindow,
      origin: 'Freedom Wallet',
      caller: { packageId: 'baby.freedom.chrome.official-local' },
      surface: 'wallet',
    })
  );
});

test('uses the native owner window for vault prompts from compositor wallet views', async () => {
  const { ownerWindow, surfaceWindow } = createCompositorOwnerWindow();
  const presentVaultUnlockPrompt = jest.fn().mockResolvedValue({
    ok: true,
    outcome: 'accepted',
    response: 0,
  });
  mockCreateDerivedWallet
    .mockRejectedValueOnce(new Error('Vault must be unlocked to create a new wallet'))
    .mockResolvedValueOnce({
      index: 2,
      name: 'Trading',
      address: '0x3333333333333333333333333333333333333333',
    });
  await openTrustedWalletSurface(
    {
      ownerWindow,
      caller: { packageId: 'baby.freedom.chrome.official-local' },
    },
    { presentVaultUnlockPrompt }
  );
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  await mockHandlers.get(channelFor('create-wallet', surfaceId))(
    { sender: surfaceWindow.webContents },
    { name: ' Trading ' }
  );

  expect(presentVaultUnlockPrompt).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({
      ownerWindow,
      caller: { packageId: 'baby.freedom.chrome.official-local' },
      surface: 'wallet',
    })
  );
});

test('does not retry trusted wallet creation when vault unlock is rejected', async () => {
  const presentVaultUnlockPrompt = jest.fn().mockResolvedValue({
    ok: true,
    outcome: 'rejected',
    response: 1,
  });
  mockCreateDerivedWallet.mockRejectedValueOnce(
    new Error('Vault must be unlocked to create a new wallet')
  );
  await openTrustedWalletSurface({}, { presentVaultUnlockPrompt });
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('create-wallet', surfaceId))(
    { sender: surfaceWindow.webContents },
    { name: 'Trading' }
  );

  expect(result).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_WALLET_SURFACE_CREATE_WALLET_UNLOCK_REJECTED',
      message: 'Vault unlock was cancelled.',
    },
  });
  expect(mockCreateDerivedWallet).toHaveBeenCalledTimes(1);
  expect(presentVaultUnlockPrompt).toHaveBeenCalledTimes(1);
});

test('renames wallets only through the trusted surface window', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('rename-wallet', surfaceId))(
    { sender: surfaceWindow.webContents },
    { walletIndex: 1, name: ' Long Term ' }
  );

  expect(result).toMatchObject({
    ok: true,
    walletIndex: 1,
    name: 'Long Term',
    snapshot: {
      wallets: expect.any(Array),
    },
  });
  expect(mockRenameDerivedWallet).toHaveBeenCalledWith(1, 'Long Term');
});

test('deletes derived wallets only through the trusted surface window', async () => {
  mockGetAllPermissions.mockReturnValueOnce([]);
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('delete-wallet', surfaceId))(
    { sender: surfaceWindow.webContents },
    { walletIndex: 1 }
  );

  expect(result).toMatchObject({
    ok: true,
    walletIndex: 1,
    snapshot: {
      wallets: expect.any(Array),
    },
  });
  expect(mockDeleteDerivedWallet).toHaveBeenCalledWith(1);
});

test('refuses to delete wallets that still have dapp permissions', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('delete-wallet', surfaceId))(
    { sender: surfaceWindow.webContents },
    { walletIndex: 1 }
  );

  expect(result).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_WALLET_SURFACE_DELETE_WALLET_FAILED',
      message: 'Cannot delete wallet with index 1; it is connected to dApps for https://app.example. Revoke connected sites before deleting this wallet.',
    },
  });
  expect(mockDeleteDerivedWallet).not.toHaveBeenCalled();
});

test('returns structured wallet management failures', async () => {
  mockCreateDerivedWallet.mockRejectedValueOnce(new Error('Vault must be unlocked'));
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('create-wallet', surfaceId))(
    { sender: surfaceWindow.webContents },
    { name: 'Trading' }
  );

  expect(result).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_WALLET_SURFACE_CREATE_WALLET_FAILED',
      message: 'Vault must be unlocked',
    },
  });
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

test('rejects mnemonic export from unexpected senders', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('export-mnemonic', surfaceId))(
    { sender: { id: 999 } },
    { password: 'password123' }
  );

  expect(result).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TRUSTED_WALLET_SURFACE_SENDER_MISMATCH',
    }),
  });
  expect(mockExportMnemonicWithPassword).not.toHaveBeenCalled();
});

test('exports mnemonic only through the trusted surface window', async () => {
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('export-mnemonic', surfaceId))(
    { sender: surfaceWindow.webContents },
    { password: 'password123' }
  );

  expect(result).toEqual({
    ok: true,
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  });
  expect(mockExportMnemonicWithPassword).toHaveBeenCalledWith('password123');
});

test('returns structured mnemonic export failures', async () => {
  mockExportMnemonicWithPassword.mockRejectedValueOnce(new Error('Incorrect password'));
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  const result = await mockHandlers.get(channelFor('export-mnemonic', surfaceId))(
    { sender: surfaceWindow.webContents },
    { password: 'wrongpassword' }
  );

  expect(result).toEqual({
    ok: false,
    error: {
      code: 'TRUSTED_WALLET_SURFACE_EXPORT_MNEMONIC_FAILED',
      message: 'Incorrect password',
    },
  });
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

test('sends shell theme updates directly to the trusted surface', async () => {
  let settingsUpdatedListener = null;
  const unsubscribe = jest.fn();
  mockOnSettingsUpdated.mockImplementation((listener) => {
    settingsUpdatedListener = listener;
    return unsubscribe;
  });
  await openTrustedWalletSurface({});
  const surfaceWindow = mockWindows[0];
  const surfaceId = surfaceWindow.loadFile.mock.calls[0][1].query.surfaceId;

  settingsUpdatedListener({
    theme: 'system',
    shellTheme: { mode: 'system', effective: 'dark' },
  });

  expect(surfaceWindow.webContents.send).toHaveBeenCalledWith(
    channelFor('theme-updated', surfaceId),
    {
      ok: true,
      theme: { mode: 'system', effective: 'dark' },
    }
  );

  closeTrustedWalletSurface();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
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
