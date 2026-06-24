jest.mock('electron', () => ({
  dialog: { showMessageBox: jest.fn() },
  ipcMain: { handle: jest.fn() },
}));

jest.mock('qrcode', () => ({}));
jest.mock('./balance-service', () => ({}));
jest.mock('./chains', () => ({}));
jest.mock('./provider-manager', () => ({}));
const mockEstimateGas = jest.fn();
const mockGetGasPrices = jest.fn();
const mockSignPersonalMessage = jest.fn();
const mockSignTypedData = jest.fn();
jest.mock('./transaction-service', () => ({
  estimateGas: mockEstimateGas,
  getGasPrices: mockGetGasPrices,
  signPersonalMessage: mockSignPersonalMessage,
  signTypedData: mockSignTypedData,
}));
const mockSignAndRecord = jest.fn();
jest.mock('./tx-recorder', () => ({
  signAndRecord: mockSignAndRecord,
  KINDS: { WALLET_SEND: 'wallet-send', DAPP_SEND: 'dapp-send' },
}));
const mockGetActiveWalletAddress = jest.fn();
const mockGetActiveWalletIndex = jest.fn();
const mockGetDerivedWallets = jest.fn();
jest.mock('../identity-manager', () => ({
  getActiveWalletAddress: mockGetActiveWalletAddress,
  getActiveWalletIndex: mockGetActiveWalletIndex,
  getDerivedWallets: mockGetDerivedWallets,
}));
const mockGetPermission = jest.fn();
const mockGrantPermission = jest.fn();
const mockUpdateLastUsed = jest.fn();
jest.mock('./dapp-permissions', () => ({
  getPermission: mockGetPermission,
  grantPermission: mockGrantPermission,
  updateLastUsed: mockUpdateLastUsed,
}));
jest.mock('./rpc-manager', () => ({}));
const mockWithVaultPrivateKey = jest.fn();
jest.mock('./vault-access', () => ({
  withVaultPrivateKey: mockWithVaultPrivateKey,
}));
const mockPresentTrustedVaultUnlockPrompt = jest.fn();
jest.mock('../trusted-vault-unlock-prompt', () => ({
  presentTrustedVaultUnlockPrompt: mockPresentTrustedVaultUnlockPrompt,
}));

const mockIsPackageWebContents = jest.fn();
const mockGetPackageWebContentsIdentity = jest.fn();
jest.mock('../shell-api', () => ({
  getPackageWebContentsIdentity: mockGetPackageWebContentsIdentity,
  isPackageWebContents: mockIsPackageWebContents,
}));

const IPC = require('../../shared/ipc-channels');
const {
  buildTxRecordContext,
  handleProviderHostContext,
  handleProviderTrustedPromptRequest,
  handleReadonlyProviderRequest,
  registerWalletIpc,
} = require('./wallet-ipc');

describe('wallet-ipc', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveWalletAddress.mockResolvedValue(null);
    mockGetActiveWalletIndex.mockReturnValue(0);
    mockGetDerivedWallets.mockResolvedValue([]);
    mockGetPermission.mockReturnValue(null);
    mockGrantPermission.mockReturnValue(null);
    mockUpdateLastUsed.mockReturnValue(true);
    mockEstimateGas.mockResolvedValue({ gasLimit: '25200' });
    mockGetGasPrices.mockResolvedValue({
      type: 'legacy',
      gasPrice: '1000000000',
      effectiveGasPrice: '1000000000',
    });
    mockSignAndRecord.mockResolvedValue({
      hash: '0xtransactionhash',
      nonce: 7,
      from: '0x1111111111111111111111111111111111111111',
      to: '0x0000000000000000000000000000000000000001',
      value: '0',
      chainId: 100,
      recorded: true,
      paymentId: 'payment-1',
    });
    mockSignPersonalMessage.mockResolvedValue('0xsigned-personal');
    mockSignTypedData.mockResolvedValue('0xsigned-typed');
    mockWithVaultPrivateKey.mockImplementation((_walletIndex, callback) =>
      callback('0xprivate-key')
    );
    mockPresentTrustedVaultUnlockPrompt.mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
  });

  test('renderer context cannot override fixed payment-history kind', () => {
    expect(buildTxRecordContext('dapp-send', {
      kind: 'wallet-send',
      origin: 'https://app.example',
    })).toEqual({
      kind: 'dapp-send',
      origin: 'https://app.example',
    });
  });

  test('handles only low-risk read-only provider methods', () => {
    expect(handleReadonlyProviderRequest({ method: 'eth_chainId' })).toEqual({
      result: '0x64',
      error: null,
    });
    expect(handleReadonlyProviderRequest({ method: 'eth_requestAccounts' })).toEqual({
      result: null,
      error: { code: 4200, message: 'Method not supported' },
    });
  });

  test('registers provider host-context handler', () => {
    registerWalletIpc();

    expect(require('electron').ipcMain.handle).toHaveBeenCalledWith(
      IPC.DAPP_PROVIDER_HOST_CONTEXT,
      handleProviderHostContext
    );
    expect(require('electron').ipcMain.handle).toHaveBeenCalledWith(
      IPC.DAPP_PROVIDER_TRUSTED_PROMPT_REQUEST,
      handleProviderTrustedPromptRequest
    );
  });

  test('reports package-hosted guest webviews from the main-owned host sender', () => {
    const hostWebContents = { id: 20 };
    mockIsPackageWebContents.mockReturnValue(true);

    expect(handleProviderHostContext({ sender: { hostWebContents } })).toEqual({
      packageHosted: true,
    });
    expect(mockIsPackageWebContents).toHaveBeenCalledWith(hostWebContents);
  });

  test('reports false when a provider request has no package host', () => {
    expect(handleProviderHostContext({ sender: {} })).toEqual({
      packageHosted: false,
    });
    expect(mockIsPackageWebContents).not.toHaveBeenCalled();
  });

  test('returns existing package-hosted wallet connect grants without prompting package chrome', async () => {
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(),
    };
    const sender = {
      id: 42,
      hostWebContents,
      getURL: jest.fn(() => 'https://app.example/path?ignored=1'),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPermission.mockReturnValue({
      origin: 'https://app.example',
      walletIndex: 2,
      chainId: 100,
    });
    mockGetDerivedWallets.mockResolvedValue([
      {
        index: 2,
        name: 'App Wallet',
        address: '0x2222222222222222222222222222222222222222',
      },
    ]);

    await expect(
      handleProviderTrustedPromptRequest({ sender }, { method: 'eth_requestAccounts' })
    ).resolves.toEqual({
      result: ['0x2222222222222222222222222222222222222222'],
      error: null,
    });
    expect(mockGetPermission).toHaveBeenCalledWith('https://app.example');
    expect(mockUpdateLastUsed).toHaveBeenCalledWith('https://app.example', 100);
    expect(require('electron').dialog.showMessageBox).not.toHaveBeenCalled();
    expect(hostWebContents.getOwnerBrowserWindow).not.toHaveBeenCalled();
  });

  test('returns package-hosted eth_accounts from existing main-owned dApp permissions', async () => {
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(),
    };
    const sender = {
      id: 42,
      hostWebContents,
      getURL: jest.fn(() => 'ipfs://bafybeibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/page'),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPermission.mockReturnValue({
      origin: 'ipfs://bafybeibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      walletIndex: 0,
      chainId: 100,
    });
    mockGetDerivedWallets.mockResolvedValue([
      {
        index: 0,
        name: 'Main Wallet',
        address: '0x1111111111111111111111111111111111111111',
      },
    ]);

    await expect(
      handleProviderTrustedPromptRequest({ sender }, { method: 'eth_accounts' })
    ).resolves.toEqual({
      result: ['0x1111111111111111111111111111111111111111'],
      error: null,
    });
    expect(mockGetPermission).toHaveBeenCalledWith(
      'ipfs://bafybeibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    );
    expect(mockUpdateLastUsed).toHaveBeenCalledWith(
      'ipfs://bafybeibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      100
    );
    expect(require('electron').dialog.showMessageBox).not.toHaveBeenCalled();
    expect(hostWebContents.getOwnerBrowserWindow).not.toHaveBeenCalled();
  });

  test('approves package-hosted wallet connect through a shell-owned prompt and main-side permission grant', async () => {
    const ownerWindow = { id: 77 };
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    };
    const sender = {
      id: 42,
      hostWebContents,
      getURL: jest.fn(() => 'https://app.example/path?ignored=1'),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPackageWebContentsIdentity.mockReturnValue({
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
      name: 'Freedom Official Chrome',
      version: '0.7.5',
    });
    mockGetActiveWalletIndex.mockReturnValue(0);
    mockGetActiveWalletAddress.mockResolvedValue('0x1111111111111111111111111111111111111111');
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 0 });

    const result = await handleProviderTrustedPromptRequest(
      { sender },
      {
        method: 'eth_requestAccounts',
        origin: 'https://spoofed.example',
      }
    );

    expect(result).toMatchObject({
      result: ['0x1111111111111111111111111111111111111111'],
      error: null,
      trustedPrompt: {
        ok: true,
        kind: 'wallet.connect',
        renderedBy: 'shell-native-dialog',
        context: {
          source: 'main',
          origin: 'https://app.example',
          webContentsId: 42,
          caller: {
            packageId: 'baby.freedom.chrome.official',
            packageType: 'browser-chrome',
          },
        },
        result: {
          outcome: 'accepted',
          source: 'shell-native-dialog',
          response: 0,
        },
      },
    });
    expect(mockGetPermission).toHaveBeenCalledWith('https://app.example');
    expect(mockGetActiveWalletIndex).toHaveBeenCalledTimes(1);
    expect(mockGetActiveWalletAddress).toHaveBeenCalledTimes(1);
    expect(mockGrantPermission).toHaveBeenCalledWith('https://app.example', 0, 100);
    expect(require('electron').dialog.showMessageBox).toHaveBeenCalledWith(ownerWindow, {
      type: 'info',
      title: 'Freedom Wallet Connection',
      message: 'Wallet connection request',
      detail:
        'https://app.example requested wallet account access. ' +
        'Choose Connect to share the active wallet address through the shell-owned provider broker.',
      buttons: ['Connect', 'Reject'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
  });

  test('rejects package-hosted wallet connect through a shell-owned prompt without granting accounts', async () => {
    const ownerWindow = { id: 77 };
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    };
    const sender = {
      id: 42,
      hostWebContents,
      getURL: jest.fn(() => 'https://app.example/path?ignored=1'),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPackageWebContentsIdentity.mockReturnValue({
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
      name: 'Freedom Official Chrome',
      version: '0.7.5',
    });
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 1 });

    const result = await handleProviderTrustedPromptRequest(
      { sender },
      {
        method: 'eth_requestAccounts',
        origin: 'https://spoofed.example',
      }
    );

    expect(result).toMatchObject({
      result: null,
      error: {
        code: 4001,
        message: 'User rejected the request',
        data: {
          reason: 'shell_trusted_prompt_rejected',
          prompt: {
            kind: 'wallet.connect',
            renderedBy: 'shell-native-dialog',
            surfaceOwner: 'shell',
            origin: 'https://app.example',
            webContentsId: 42,
          },
        },
      },
      trustedPrompt: {
        ok: true,
        kind: 'wallet.connect',
        renderedBy: 'shell-native-dialog',
        context: {
          source: 'main',
          origin: 'https://app.example',
          webContentsId: 42,
          caller: {
            packageId: 'baby.freedom.chrome.official',
            packageType: 'browser-chrome',
          },
        },
        result: {
          outcome: 'rejected',
          response: 1,
        },
      },
    });
    expect(mockGrantPermission).not.toHaveBeenCalled();
    expect(mockGetActiveWalletAddress).not.toHaveBeenCalled();
    expect(mockIsPackageWebContents).toHaveBeenCalledWith(hostWebContents);
    expect(mockGetPackageWebContentsIdentity).toHaveBeenCalledWith(hostWebContents);
    expect(hostWebContents.getOwnerBrowserWindow).toHaveBeenCalledTimes(1);
    expect(require('electron').dialog.showMessageBox).toHaveBeenCalledWith(ownerWindow, {
      type: 'info',
      title: 'Freedom Wallet Connection',
      message: 'Wallet connection request',
      detail:
        'https://app.example requested wallet account access. ' +
        'Choose Connect to share the active wallet address through the shell-owned provider broker.',
      buttons: ['Connect', 'Reject'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
  });

  test('routes package-hosted transaction requests through a shell-owned prompt', async () => {
    const ownerWindow = { id: 78 };
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPackageWebContentsIdentity.mockReturnValue({
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
    });
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 1 });

    const result = await handleProviderTrustedPromptRequest(
      {
        sender: {
          id: 43,
          hostWebContents,
          getURL: jest.fn(() => 'https://app.example/tx'),
        },
      },
      {
        method: 'eth_sendTransaction',
        params: [{ to: '0x0000000000000000000000000000000000000001', value: '0x0' }],
      }
    );

    expect(result).toMatchObject({
      result: null,
      error: {
        code: 4001,
        message: 'User rejected the request',
        data: {
          reason: 'shell_trusted_prompt_rejected',
          prompt: {
            kind: 'wallet.transaction',
            renderedBy: 'shell-native-dialog',
            surfaceOwner: 'shell',
            origin: 'https://app.example',
            webContentsId: 43,
          },
        },
      },
      trustedPrompt: {
        ok: true,
        kind: 'wallet.transaction',
        renderedBy: 'shell-native-dialog',
        context: {
          source: 'main',
          origin: 'https://app.example',
          webContentsId: 43,
        },
      },
    });
    expect(require('electron').dialog.showMessageBox).toHaveBeenCalledWith(ownerWindow, {
      type: 'info',
      title: 'Freedom Wallet Transaction',
      message: 'Transaction request',
      detail:
        'https://app.example requested a wallet transaction. ' +
        'To: 0x0000000000000000000000000000000000000001. ' +
        'Value: 0x0. ' +
        'Choose Send only if you trust this request.',
      buttons: ['Send', 'Reject'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    expect(mockWithVaultPrivateKey).not.toHaveBeenCalled();
    expect(mockSignAndRecord).not.toHaveBeenCalled();
  });

  test('sends package-hosted transactions through shell-owned prompt and main wallet execution', async () => {
    const ownerWindow = { id: 79 };
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPackageWebContentsIdentity.mockReturnValue({
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
    });
    mockGetPermission.mockReturnValue({
      origin: 'https://app.example',
      walletIndex: 3,
      chainId: 100,
    });
    mockGetDerivedWallets.mockResolvedValue([
      {
        index: 3,
        name: 'Transaction Wallet',
        address: '0x1111111111111111111111111111111111111111',
      },
    ]);
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 0 });

    const result = await handleProviderTrustedPromptRequest(
      {
        sender: {
          id: 44,
          hostWebContents,
          getURL: jest.fn(() => 'https://app.example/tx'),
        },
      },
      {
        method: 'eth_sendTransaction',
        params: [{
          from: '0x1111111111111111111111111111111111111111',
          to: '0x0000000000000000000000000000000000000001',
          value: '0x2a',
        }],
      }
    );

    expect(result).toMatchObject({
      result: '0xtransactionhash',
      error: null,
      trustedPrompt: {
        ok: true,
        kind: 'wallet.transaction',
        renderedBy: 'shell-native-dialog',
        context: {
          source: 'main',
          origin: 'https://app.example',
          webContentsId: 44,
        },
        result: {
          outcome: 'accepted',
          response: 0,
        },
      },
    });
    expect(mockGetPermission).toHaveBeenCalledWith('https://app.example');
    expect(mockEstimateGas).toHaveBeenCalledWith({
      from: '0x1111111111111111111111111111111111111111',
      to: '0x0000000000000000000000000000000000000001',
      value: '0x2a',
      data: undefined,
      chainId: 100,
    });
    expect(mockGetGasPrices).toHaveBeenCalledWith(100);
    expect(mockWithVaultPrivateKey).toHaveBeenCalledWith(3, expect.any(Function));
    expect(mockSignAndRecord).toHaveBeenCalledWith(
      {
        to: '0x0000000000000000000000000000000000000001',
        value: '0x2a',
        gasLimit: '25200',
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
        gasPrice: '1000000000',
        chainId: 100,
      },
      '0xprivate-key',
      {
        kind: 'dapp-send',
        origin: 'https://app.example',
      }
    );
    expect(mockUpdateLastUsed).toHaveBeenCalledWith('https://app.example', 100);
  });

  test('unlocks and retries accepted package-hosted transactions after vault-locked execution', async () => {
    const ownerWindow = { id: 79 };
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPackageWebContentsIdentity.mockReturnValue({
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
    });
    mockGetPermission.mockReturnValue({
      origin: 'https://app.example',
      walletIndex: 3,
      chainId: 100,
    });
    mockGetDerivedWallets.mockResolvedValue([
      {
        index: 3,
        name: 'Transaction Wallet',
        address: '0x1111111111111111111111111111111111111111',
      },
    ]);
    mockWithVaultPrivateKey
      .mockRejectedValueOnce(new Error('Vault is locked'))
      .mockImplementationOnce((_walletIndex, callback) => callback('0xprivate-key'));
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 0 });

    const result = await handleProviderTrustedPromptRequest(
      {
        sender: {
          id: 44,
          hostWebContents,
          getURL: jest.fn(() => 'https://app.example/tx'),
        },
      },
      {
        method: 'eth_sendTransaction',
        params: [{
          from: '0x1111111111111111111111111111111111111111',
          to: '0x0000000000000000000000000000000000000001',
          value: '0x2a',
        }],
      }
    );

    expect(result).toMatchObject({
      result: '0xtransactionhash',
      error: null,
      trustedPrompt: {
        ok: true,
        kind: 'wallet.transaction',
      },
      vaultUnlockPrompt: {
        ok: true,
        outcome: 'accepted',
      },
    });
    expect(mockWithVaultPrivateKey).toHaveBeenCalledTimes(2);
    expect(mockSignAndRecord).toHaveBeenCalledTimes(1);
    expect(mockPresentTrustedVaultUnlockPrompt).toHaveBeenCalledWith(
      {
        kind: 'wallet.transaction',
        method: 'eth_sendTransaction',
        origin: 'https://app.example',
        reason: 'Wallet vault unlock request from https://app.example',
        details: {
          method: 'eth_sendTransaction',
          account: '0x1111111111111111111111111111111111111111',
          to: '0x0000000000000000000000000000000000000001',
          value: '0x2a',
          chainId: 100,
        },
      },
      expect.objectContaining({
        origin: 'https://app.example',
        webContentsId: 44,
        ownerWindow,
      })
    );
    expect(mockUpdateLastUsed).toHaveBeenCalledWith('https://app.example', 100);
  });

  test('signs package-hosted personal_sign through shell-owned prompt and vault access', async () => {
    const ownerWindow = { id: 79 };
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPackageWebContentsIdentity.mockReturnValue({
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
    });
    mockGetPermission.mockReturnValue({
      origin: 'https://app.example',
      walletIndex: 3,
      chainId: 100,
    });
    mockGetDerivedWallets.mockResolvedValue([
      {
        index: 3,
        name: 'Signing Wallet',
        address: '0x1111111111111111111111111111111111111111',
      },
    ]);
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 0 });

    const result = await handleProviderTrustedPromptRequest(
      {
        sender: {
          id: 44,
          hostWebContents,
          getURL: jest.fn(() => 'https://app.example/sign'),
        },
      },
      {
        method: 'personal_sign',
        params: ['0x68656c6c6f', '0x1111111111111111111111111111111111111111'],
      }
    );

    expect(result).toMatchObject({
      result: '0xsigned-personal',
      error: null,
      trustedPrompt: {
        ok: true,
        kind: 'wallet.signature',
        renderedBy: 'shell-native-dialog',
        context: {
          source: 'main',
          origin: 'https://app.example',
          webContentsId: 44,
        },
        result: {
          outcome: 'accepted',
          response: 0,
        },
      },
    });
    expect(mockGetPermission).toHaveBeenCalledWith('https://app.example');
    expect(mockWithVaultPrivateKey).toHaveBeenCalledWith(3, expect.any(Function));
    expect(mockSignPersonalMessage).toHaveBeenCalledWith('0x68656c6c6f', '0xprivate-key');
    expect(mockUpdateLastUsed).toHaveBeenCalledWith('https://app.example', 100);
    expect(require('electron').dialog.showMessageBox).toHaveBeenCalledWith(ownerWindow, {
      type: 'info',
      title: 'Freedom Wallet Signature',
      message: 'Signature request',
      detail:
        'https://app.example requested wallet signing. ' +
        'Method: personal_sign. ' +
        'Choose Sign only if you trust this request.',
      buttons: ['Sign', 'Reject'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
  });

  test('signs package-hosted typed data through shell-owned prompt and vault access', async () => {
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(() => ({ id: 80 })),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPackageWebContentsIdentity.mockReturnValue({
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
    });
    mockGetPermission.mockReturnValue({
      origin: 'https://app.example',
      walletIndex: 1,
      chainId: 100,
    });
    mockGetDerivedWallets.mockResolvedValue([
      {
        index: 1,
        name: 'Typed Wallet',
        address: '0x2222222222222222222222222222222222222222',
      },
    ]);
    const typedData = {
      domain: { name: 'Freedom Test' },
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Mail: [{ name: 'contents', type: 'string' }],
      },
      message: { contents: 'hello' },
    };
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 0 });

    await expect(
      handleProviderTrustedPromptRequest(
        {
          sender: {
            id: 45,
            hostWebContents,
            getURL: jest.fn(() => 'https://app.example/typed'),
          },
        },
        {
          method: 'eth_signTypedData_v4',
          params: ['0x2222222222222222222222222222222222222222', typedData],
        }
      )
    ).resolves.toMatchObject({
      result: '0xsigned-typed',
      error: null,
      trustedPrompt: {
        ok: true,
        kind: 'wallet.signature',
        result: {
          outcome: 'accepted',
        },
      },
    });
    expect(mockWithVaultPrivateKey).toHaveBeenCalledWith(1, expect.any(Function));
    expect(mockSignTypedData).toHaveBeenCalledWith(typedData, '0xprivate-key');
    expect(mockUpdateLastUsed).toHaveBeenCalledWith('https://app.example', 100);
  });

  test('rejects package-hosted signature requests when the shell prompt is rejected', async () => {
    const ownerWindow = { id: 79 };
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPackageWebContentsIdentity.mockReturnValue({
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
    });
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 1 });

    const result = await handleProviderTrustedPromptRequest(
      {
        sender: {
          id: 44,
          hostWebContents,
          getURL: jest.fn(() => 'https://app.example/sign'),
        },
      },
      {
        method: 'personal_sign',
        params: ['0x68656c6c6f', '0x1111111111111111111111111111111111111111'],
      }
    );

    expect(result).toMatchObject({
      result: null,
      error: {
        code: 4001,
        message: 'User rejected the request',
        data: {
          reason: 'shell_trusted_prompt_rejected',
          prompt: {
            kind: 'wallet.signature',
            renderedBy: 'shell-native-dialog',
            surfaceOwner: 'shell',
            origin: 'https://app.example',
            webContentsId: 44,
          },
        },
      },
      trustedPrompt: {
        ok: true,
        kind: 'wallet.signature',
        result: {
          outcome: 'rejected',
          response: 1,
        },
      },
    });
    expect(mockWithVaultPrivateKey).not.toHaveBeenCalled();
    expect(mockSignPersonalMessage).not.toHaveBeenCalled();
  });

  test('unlocks and retries accepted package-hosted signatures after vault-locked execution', async () => {
    const ownerWindow = { id: 81 };
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(() => ownerWindow),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPackageWebContentsIdentity.mockReturnValue({
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
    });
    mockGetPermission.mockReturnValue({
      origin: 'https://app.example',
      walletIndex: 0,
      chainId: 100,
    });
    mockGetDerivedWallets.mockResolvedValue([
      {
        index: 0,
        name: 'Main Wallet',
        address: '0x1111111111111111111111111111111111111111',
      },
    ]);
    mockWithVaultPrivateKey
      .mockRejectedValueOnce(new Error('Vault is locked'))
      .mockImplementationOnce((_walletIndex, callback) => callback('0xprivate-key'));
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 0 });

    await expect(
      handleProviderTrustedPromptRequest(
        {
          sender: {
            id: 46,
            hostWebContents,
            getURL: jest.fn(() => 'https://app.example/sign'),
          },
        },
        {
          method: 'personal_sign',
          params: ['0x68656c6c6f', '0x1111111111111111111111111111111111111111'],
        }
      )
    ).resolves.toMatchObject({
      result: '0xsigned-personal',
      error: null,
      trustedPrompt: {
        ok: true,
        kind: 'wallet.signature',
      },
      vaultUnlockPrompt: {
        ok: true,
        outcome: 'accepted',
      },
    });
    expect(mockWithVaultPrivateKey).toHaveBeenCalledTimes(2);
    expect(mockSignPersonalMessage).toHaveBeenCalledWith('0x68656c6c6f', '0xprivate-key');
    expect(mockPresentTrustedVaultUnlockPrompt).toHaveBeenCalledWith(
      {
        kind: 'wallet.signature',
        method: 'personal_sign',
        origin: 'https://app.example',
        reason: 'Wallet vault unlock request from https://app.example',
        details: {
          method: 'personal_sign',
          account: '0x1111111111111111111111111111111111111111',
        },
      },
      expect.objectContaining({
        origin: 'https://app.example',
        webContentsId: 46,
        ownerWindow,
      })
    );
    expect(mockUpdateLastUsed).toHaveBeenCalledWith('https://app.example', 100);
  });

  test('returns structured rejection when package-hosted signature unlock is rejected', async () => {
    const hostWebContents = {
      id: 20,
      getOwnerBrowserWindow: jest.fn(() => ({ id: 82 })),
    };
    mockIsPackageWebContents.mockReturnValue(true);
    mockGetPackageWebContentsIdentity.mockReturnValue({
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
    });
    mockGetPermission.mockReturnValue({
      origin: 'https://app.example',
      walletIndex: 0,
      chainId: 100,
    });
    mockGetDerivedWallets.mockResolvedValue([
      {
        index: 0,
        name: 'Main Wallet',
        address: '0x1111111111111111111111111111111111111111',
      },
    ]);
    mockWithVaultPrivateKey.mockRejectedValue(new Error('Vault is locked'));
    mockPresentTrustedVaultUnlockPrompt.mockResolvedValue({
      ok: true,
      outcome: 'rejected',
      response: 1,
    });
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 0 });

    await expect(
      handleProviderTrustedPromptRequest(
        {
          sender: {
            id: 47,
            hostWebContents,
            getURL: jest.fn(() => 'https://app.example/sign'),
          },
        },
        {
          method: 'personal_sign',
          params: ['0x68656c6c6f', '0x1111111111111111111111111111111111111111'],
        }
      )
    ).resolves.toMatchObject({
      result: null,
      error: {
        code: 4001,
        message: 'User rejected the request',
        data: {
          reason: 'shell_trusted_prompt_rejected',
          prompt: {
            kind: 'wallet.vaultUnlock',
            renderedBy: 'trusted-vault-unlock-window',
            surfaceOwner: 'shell',
            origin: 'https://app.example',
            webContentsId: 47,
            outcome: 'rejected',
          },
        },
      },
      trustedPrompt: {
        ok: true,
        kind: 'wallet.signature',
      },
      vaultUnlockPrompt: {
        ok: true,
        outcome: 'rejected',
      },
    });
    expect(mockWithVaultPrivateKey).toHaveBeenCalledTimes(1);
    expect(mockSignPersonalMessage).not.toHaveBeenCalled();
  });

  test('keeps unsupported package-hosted provider methods unavailable', async () => {
    const hostWebContents = { id: 20 };
    mockIsPackageWebContents.mockReturnValue(true);

    await expect(
      handleProviderTrustedPromptRequest(
        {
          sender: {
            id: 42,
            hostWebContents,
            getURL: jest.fn(() => 'https://app.example/'),
          },
        },
        { method: 'wallet_switchEthereumChain' }
      )
    ).resolves.toEqual({
      result: null,
      error: {
        code: 4100,
        message:
          'Ethereum provider method is unavailable in package mode until a shell-owned trusted prompt exists: wallet_switchEthereumChain',
        data: { reason: 'trusted_prompt_unavailable' },
      },
    });
    expect(require('electron').dialog.showMessageBox).not.toHaveBeenCalled();
  });
});
