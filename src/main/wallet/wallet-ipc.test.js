jest.mock('electron', () => ({
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
jest.mock('../shell-api', () => ({
  isPackageWebContents: mockIsPackageWebContents,
}));

const IPC = require('../../shared/ipc-channels');
const {
  buildTxRecordContext,
  handleProviderHostContext,
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
});
