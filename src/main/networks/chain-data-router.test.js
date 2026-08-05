const mockRegistry = {
  getNetwork: jest.fn(),
  getEndpoints: jest.fn(),
};
const mockMyotis = {
  isReady: jest.fn(),
  getAccount: jest.fn(),
  ethCall: jest.fn(),
  estimateGas: jest.fn(),
  feeEstimate: jest.fn(),
  sendRawTransaction: jest.fn(),
};
const mockRequestViaColibri = jest.fn();

jest.mock('./network-registry', () => mockRegistry);
jest.mock('../myotis/myotis-manager', () => mockMyotis);
jest.mock('../ens/colibri-resolver', () => ({
  requestViaColibri: (...args) => mockRequestViaColibri(...args),
}));
jest.mock('../logger', () => ({ verbose: jest.fn() }));

const { request, broadcastRawTransaction } = require('./chain-data-router');
const originalFetch = global.fetch;

describe('chain-data-router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistry.getNetwork.mockReturnValue({
      access: {
        readOrder: ['myotis', 'colibri', 'direct'],
        broadcastOrder: ['myotis', 'direct'],
      },
      quorum: { k: 3, m: 2, timeoutMs: 1000 },
    });
    mockRegistry.getEndpoints.mockImplementation((_chainId, role) =>
      role === 'prover' ? ['https://prover.example'] : ['https://rpc.example']
    );
    mockMyotis.isReady.mockReturnValue(true);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('serves account balances from the matching Myotis chain', async () => {
    mockMyotis.getAccount.mockResolvedValue({ status: 'ok', balanceWei: '42', nonce: 3 });

    await expect(request(100, 'eth_getBalance', ['0xabc', 'latest'])).resolves.toEqual({
      result: '0x2a',
      source: 'myotis',
      verified: true,
    });
    expect(mockMyotis.getAccount).toHaveBeenCalledWith('0xabc', 100);
    expect(mockRequestViaColibri).not.toHaveBeenCalled();
  });

  test('falls through unsupported Myotis reads to the per-chain Colibri client', async () => {
    mockRequestViaColibri.mockResolvedValue('0x6000');

    await expect(request(100, 'eth_getCode', ['0xabc', 'latest'])).resolves.toEqual({
      result: '0x6000',
      source: 'colibri',
      verified: true,
    });
    expect(mockRequestViaColibri).toHaveBeenCalledWith(100, 'eth_getCode', [
      '0xabc',
      'latest',
    ]);
  });

  test('uses Myotis P2P transaction broadcast before RPC', async () => {
    mockMyotis.sendRawTransaction.mockResolvedValue({ txHash: '0x1234' });

    await expect(broadcastRawTransaction(100, '0xsigned')).resolves.toEqual({
      result: '0x1234',
      source: 'myotis',
    });
    expect(mockMyotis.sendRawTransaction).toHaveBeenCalledWith('0xsigned', 100);
  });

  test('keeps stateful dapp filters on one direct RPC endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: '0xfilter' }),
    });

    await expect(request(1, 'eth_newFilter', [{ address: '0xabc' }])).resolves.toEqual({
      result: '0xfilter',
      source: 'direct',
      verified: false,
    });
    expect(mockRequestViaColibri).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('falls back to direct RPC when Myotis is not ready', async () => {
    mockMyotis.isReady.mockReturnValue(false);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: '0xrpc' }),
    });

    await expect(broadcastRawTransaction(1, '0xsigned')).resolves.toEqual({
      result: '0xrpc',
      source: 'direct',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://rpc.example',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
