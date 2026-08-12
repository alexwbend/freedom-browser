const { Wallet, Transaction, verifyMessage, getBytes } = require('ethers');
const mockChainRequest = jest.fn();
const mockGetFeeQuote = jest.fn();
const mockBroadcastRawTransaction = jest.fn();
jest.mock('../networks/chain-data-router', () => ({
  request: (...args) => mockChainRequest(...args),
  getFeeQuote: (...args) => mockGetFeeQuote(...args),
  broadcastRawTransaction: (...args) => mockBroadcastRawTransaction(...args),
}));
const {
  signPersonalMessage,
  estimateGas,
  getGasPrices,
  signAndSendTransaction,
  waitForTransaction,
} = require('./transaction-service');

// Deterministic test key (not a real wallet)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const testWallet = new Wallet(TEST_PRIVATE_KEY);

describe('signPersonalMessage', () => {
  it('signs a plain text message', async () => {
    const message = 'Hello, this is a test message';
    const signature = await signPersonalMessage(message, TEST_PRIVATE_KEY);

    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    // Verify the signature recovers to the correct address
    const recovered = verifyMessage(message, signature);
    expect(recovered.toLowerCase()).toBe(testWallet.address.toLowerCase());
  });

  it('signs a hex-encoded text message (0x prefix)', async () => {
    // "Hello" in hex
    const hexMessage = '0x48656c6c6f';
    const signature = await signPersonalMessage(hexMessage, TEST_PRIVATE_KEY);

    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    // Verify: ethers.verifyMessage with raw bytes should recover the same address
    const rawBytes = getBytes(hexMessage);
    const recovered = verifyMessage(rawBytes, signature);
    expect(recovered.toLowerCase()).toBe(testWallet.address.toLowerCase());
  });

  it('signs hex-encoded binary data containing non-UTF-8 bytes', async () => {
    // Arbitrary binary data that is NOT valid UTF-8
    // 0xff 0xfe are invalid UTF-8 lead bytes
    const hexMessage = '0xfffefd00010203deadbeef';
    const signature = await signPersonalMessage(hexMessage, TEST_PRIVATE_KEY);

    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    // Verify the signature matches signing the raw bytes directly
    const rawBytes = getBytes(hexMessage);
    const recovered = verifyMessage(rawBytes, signature);
    expect(recovered.toLowerCase()).toBe(testWallet.address.toLowerCase());
  });

  it('signs a hex-encoded hash (32 bytes)', async () => {
    // A keccak256 hash — common in dApp signing flows
    const hashMessage = '0x' + 'ab'.repeat(32);
    const signature = await signPersonalMessage(hashMessage, TEST_PRIVATE_KEY);

    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    const rawBytes = getBytes(hashMessage);
    const recovered = verifyMessage(rawBytes, signature);
    expect(recovered.toLowerCase()).toBe(testWallet.address.toLowerCase());
  });

  it('produces matching signatures for hex and equivalent raw bytes', async () => {
    // Sign "Hello" as plain text hex
    const hexSig = await signPersonalMessage('0x48656c6c6f', TEST_PRIVATE_KEY);
    // Sign "Hello" by passing the same bytes through ethers directly
    const directSig = await testWallet.signMessage(getBytes('0x48656c6c6f'));

    expect(hexSig).toBe(directSig);
  });

  it('treats non-0x messages as plain strings', async () => {
    const message = 'no hex prefix here';
    const signature = await signPersonalMessage(message, TEST_PRIVATE_KEY);

    const recovered = verifyMessage(message, signature);
    expect(recovered.toLowerCase()).toBe(testWallet.address.toLowerCase());
  });
});

describe('capability-aware transaction routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses the configured chain source for gas estimation and fee data', async () => {
    mockChainRequest
      .mockResolvedValueOnce({ result: '0x5208', source: 'myotis' });
    mockGetFeeQuote.mockResolvedValue({
      type: 'eip1559',
      baseFee: '98',
      maxFeePerGas: '100',
      maxPriorityFeePerGas: '2',
      effectiveGasPrice: '100',
      source: 'myotis',
      verified: true,
    });

    await expect(
      estimateGas({ from: testWallet.address, to: testWallet.address, value: '0', chainId: 100 })
    ).resolves.toEqual({ gasLimit: '25200' });
    await expect(getGasPrices(100)).resolves.toMatchObject({
      type: 'eip1559',
      maxFeePerGas: '100',
      maxPriorityFeePerGas: '2',
    });
    expect(mockGetFeeQuote).toHaveBeenCalledWith(100);
  });

  test('signs locally and broadcasts the raw transaction through Myotis', async () => {
    mockChainRequest.mockResolvedValue({ result: '0x0', source: 'myotis' });
    mockBroadcastRawTransaction.mockImplementation(async (_chainId, raw) => ({
      result: Transaction.from(raw).hash,
      source: 'myotis',
    }));

    const result = await signAndSendTransaction(
      {
        to: testWallet.address,
        value: '1',
        gasLimit: '21000',
        maxFeePerGas: '100',
        maxPriorityFeePerGas: '2',
        chainId: 100,
      },
      TEST_PRIVATE_KEY
    );

    expect(mockBroadcastRawTransaction).toHaveBeenCalledWith(
      100,
      expect.stringMatching(/^0x/)
    );
    expect(result).toMatchObject({ chainId: 100, broadcastSource: 'myotis' });
    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  test('reports inconsistent fees as a fee error rather than a nonce error', async () => {
    mockChainRequest.mockResolvedValue({ result: '0x11b', source: 'direct' });

    await expect(
      signAndSendTransaction(
        {
          to: testWallet.address,
          value: '1',
          gasLimit: '25200',
          maxFeePerGas: '3727',
          maxPriorityFeePerGas: '1000000000',
          chainId: 100,
        },
        TEST_PRIVATE_KEY
      )
    ).rejects.toThrow('Transaction fee data is invalid. Please refresh and try again.');
    expect(mockBroadcastRawTransaction).not.toHaveBeenCalled();
  });

  test('still maps an actual nonce rejection to the nonce error', async () => {
    mockChainRequest.mockRejectedValue(new Error('nonce too low'));

    await expect(
      signAndSendTransaction(
        {
          to: testWallet.address,
          value: '1',
          gasLimit: '21000',
          gasPrice: '1',
          chainId: 100,
        },
        TEST_PRIVATE_KEY
      )
    ).rejects.toThrow('Transaction nonce error. Please try again.');
  });

  test('surfaces the locally computed hash when a broadcaster returns a mismatch', async () => {
    let localHash;
    mockChainRequest.mockResolvedValue({ result: '0x0', source: 'direct' });
    mockBroadcastRawTransaction.mockImplementation(async (_chainId, raw) => {
      localHash = Transaction.from(raw).hash;
      return { result: `0x${'11'.repeat(32)}`, source: 'direct' };
    });

    let failure;
    try {
      await signAndSendTransaction(
        {
          to: testWallet.address,
          value: '1',
          gasLimit: '21000',
          gasPrice: '1',
          chainId: 100,
        },
        TEST_PRIVATE_KEY
      );
    } catch (err) {
      failure = err;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain(localHash);
  });

  test('keeps polling after a transient confirmation-head failure', async () => {
    jest.useFakeTimers();
    mockChainRequest
      .mockResolvedValueOnce({
        result: { status: '0x1', blockNumber: '0xa', gasUsed: '0x5208' },
        source: 'direct',
      })
      .mockRejectedValueOnce(new Error('temporary head failure'))
      .mockResolvedValueOnce({
        result: { status: '0x1', blockNumber: '0xa', gasUsed: '0x5208' },
        source: 'direct',
      })
      .mockResolvedValueOnce({ result: '0xb', source: 'direct' });

    const pending = waitForTransaction(`0x${'22'.repeat(32)}`, 100, 2);
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toMatchObject({ status: 'confirmed', blockNumber: 10 });
    jest.useRealTimers();
  });
});
