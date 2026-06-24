jest.mock('electron', () => ({
  dialog: { showMessageBox: jest.fn() },
  ipcMain: { handle: jest.fn() },
}));

jest.mock('qrcode', () => ({}));
jest.mock('./balance-service', () => ({}));
jest.mock('./chains', () => ({}));
jest.mock('./provider-manager', () => ({}));
jest.mock('./transaction-service', () => ({}));
jest.mock('./tx-recorder', () => ({
  signAndRecord: jest.fn(),
  KINDS: { WALLET_SEND: 'wallet-send', DAPP_SEND: 'dapp-send' },
}));
jest.mock('../identity-manager', () => ({}));
jest.mock('./rpc-manager', () => ({}));
jest.mock('./vault-access', () => ({}));

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

  test('routes package-hosted wallet connect requests through a shell-owned prompt', async () => {
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
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 0 });

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
      },
    });
    expect(mockIsPackageWebContents).toHaveBeenCalledWith(hostWebContents);
    expect(mockGetPackageWebContentsIdentity).toHaveBeenCalledWith(hostWebContents);
    expect(hostWebContents.getOwnerBrowserWindow).toHaveBeenCalledTimes(1);
    expect(require('electron').dialog.showMessageBox).toHaveBeenCalledWith(ownerWindow, {
      type: 'info',
      title: 'Freedom Wallet Connection',
      message: 'Wallet connection request',
      detail:
        'https://app.example requested wallet account access. ' +
        'Package chrome cannot approve this request; the shell is rejecting it for now.',
      buttons: ['Reject'],
      defaultId: 0,
      cancelId: 0,
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
    require('electron').dialog.showMessageBox.mockResolvedValue({ response: 0 });

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
        params: [{ to: '0x0000000000000000000000000000000000000001' }],
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
        'Package chrome cannot approve this request; the shell is rejecting it for now.',
      buttons: ['Reject'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
  });

  test('routes package-hosted signature requests through a shell-owned prompt', async () => {
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
        params: ['0x68656c6c6f'],
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
        renderedBy: 'shell-native-dialog',
        context: {
          source: 'main',
          origin: 'https://app.example',
          webContentsId: 44,
        },
      },
    });
    expect(require('electron').dialog.showMessageBox).toHaveBeenCalledWith(ownerWindow, {
      type: 'info',
      title: 'Freedom Wallet Signature',
      message: 'Signature request',
      detail:
        'https://app.example requested wallet signing. ' +
        'Package chrome cannot approve this request; the shell is rejecting it for now.',
      buttons: ['Reject'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
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
