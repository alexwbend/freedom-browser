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

const { buildTxRecordContext, handleReadonlyProviderRequest } = require('./wallet-ipc');

describe('wallet-ipc', () => {
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
});
