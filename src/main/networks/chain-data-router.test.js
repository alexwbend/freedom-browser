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

const { request, getFeeQuote, broadcastRawTransaction } = require('./chain-data-router');
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

  test('uses one Myotis response for a complete fee quote', async () => {
    mockMyotis.feeEstimate.mockResolvedValue({
      gasPriceWei: '100',
      maxPriorityFeePerGasWei: '2',
    });

    await expect(getFeeQuote(100)).resolves.toEqual({
      type: 'eip1559',
      baseFee: '98',
      maxPriorityFeePerGas: '2',
      maxFeePerGas: '100',
      effectiveGasPrice: '100',
      source: 'myotis',
      verified: true,
    });
    expect(mockMyotis.feeEstimate).toHaveBeenCalledTimes(1);
    expect(mockMyotis.feeEstimate).toHaveBeenCalledWith(100);
  });

  test('downgrades an inconsistent fee quote instead of signing invalid EIP-1559 fees', async () => {
    mockMyotis.feeEstimate.mockResolvedValue({
      gasPriceWei: '3727',
      maxPriorityFeePerGasWei: '1000000000',
    });

    await expect(getFeeQuote(100)).resolves.toEqual({
      type: 'legacy',
      gasPrice: '3727',
      effectiveGasPrice: '3727',
      source: 'myotis',
      verified: true,
    });
  });

  test('gets direct fee components from the same RPC endpoint', async () => {
    mockRegistry.getNetwork.mockReturnValue({
      access: { readOrder: ['direct'] },
      quorum: { timeoutMs: 1000 },
    });
    mockRegistry.getEndpoints.mockReturnValue([
      'https://primary.example',
      'https://secondary.example',
    ]);
    global.fetch = jest.fn().mockImplementation(async (url, options) => {
      const { method } = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ result: method === 'eth_gasPrice' ? '0xebd' : '0x1' }),
        url,
      };
    });

    await expect(getFeeQuote(100)).resolves.toMatchObject({
      type: 'eip1559',
      maxFeePerGas: '3773',
      maxPriorityFeePerGas: '1',
      source: 'direct',
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://primary.example',
      'https://primary.example',
    ]);
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
