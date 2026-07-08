const mockGetProvider = jest.fn();
jest.mock('./provider-manager', () => ({
  getProvider: (...args) => mockGetProvider(...args),
  withRetry: (fn) => fn(),
}));
jest.mock('./chains', () => ({
  getTxExplorerUrl: (chainId, hash) => `https://explorer.test/${chainId}/${hash}`,
}));

const { Wallet, Transaction } = require('ethers');
const { signAndSendTransaction } = require('./transaction-service');

// Deterministic test key (not a real wallet)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const testWallet = new Wallet(TEST_PRIVATE_KEY);

describe('signAndSendTransaction (signer-based)', () => {
  // A signer that signs locally with the test key — mirrors what the
  // vault signer produces, without the vault plumbing. Ledger signers
  // implement the same interface, so this proves the sign/broadcast
  // split works for any signer that can't hand out a raw key.
  const signer = {
    getAddress: async () => testWallet.address,
    signTransaction: (tx) => testWallet.signTransaction(tx),
  };

  let broadcastedRaw;
  beforeEach(() => {
    broadcastedRaw = null;
    mockGetProvider.mockReset().mockReturnValue({
      getTransactionCount: async () => 5,
      broadcastTransaction: async (raw) => {
        broadcastedRaw = raw;
        const parsed = Transaction.from(raw);
        return {
          hash: parsed.hash,
          nonce: parsed.nonce,
          from: parsed.from,
          to: parsed.to,
          value: parsed.value,
        };
      },
    });
  });

  it('fetches the nonce for the signer address, signs, and broadcasts', async () => {
    const result = await signAndSendTransaction(
      {
        to: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
        value: '1000',
        gasLimit: '21000',
        maxFeePerGas: '2000000000',
        maxPriorityFeePerGas: '1000000000',
        chainId: 8453,
      },
      signer,
    );

    const parsed = Transaction.from(broadcastedRaw);
    expect(parsed.from).toBe(testWallet.address);
    expect(parsed.nonce).toBe(5);
    expect(parsed.chainId).toBe(8453n);

    expect(result).toMatchObject({
      hash: parsed.hash,
      nonce: 5,
      from: testWallet.address,
      to: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
      value: '1000',
      chainId: 8453,
      explorerUrl: `https://explorer.test/8453/${parsed.hash}`,
    });
  });

  it('maps insufficient-funds broadcast errors to a friendly message', async () => {
    mockGetProvider.mockReturnValue({
      getTransactionCount: async () => 0,
      broadcastTransaction: async () => {
        throw new Error('insufficient funds for gas * price + value');
      },
    });

    await expect(
      signAndSendTransaction(
        { to: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C', value: '1', gasLimit: '21000', gasPrice: '7', chainId: 1 },
        signer,
      ),
    ).rejects.toThrow('Insufficient funds for transaction');
  });

  describe('signer sendTransaction capability (device broadcasts itself)', () => {
    // Remote (phone) signers cannot produce a raw signed tx: the phone
    // picks the nonce and broadcasts itself. Only intent fields go over.
    const hash = '0x' + 'cd'.repeat(32);
    const params = {
      to: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
      value: '1000',
      data: '0xabcdef',
      gasLimit: '21000',
      maxFeePerGas: '2000000000',
      maxPriorityFeePerGas: '1000000000',
      chainId: 8453,
    };
    let getTransaction;
    let broadcastingSigner;

    beforeEach(() => {
      getTransaction = jest.fn(async () => ({ from: testWallet.address }));
      mockGetProvider.mockReturnValue({ getTransaction });
      broadcastingSigner = { ...signer, sendTransaction: jest.fn(async () => hash) };
    });

    it('prefers the capability over sign+broadcast and verifies the tx sender', async () => {
      const result = await signAndSendTransaction(params, broadcastingSigner);

      expect(broadcastingSigner.sendTransaction).toHaveBeenCalledWith({
        to: params.to,
        value: '1000',
        data: '0xabcdef',
        chainId: 8453,
      });
      expect(broadcastedRaw).toBeNull(); // never touched our provider's broadcast path
      expect(getTransaction).toHaveBeenCalledWith(hash);
      expect(result).toEqual({
        hash,
        from: testWallet.address,
        to: params.to,
        value: '1000',
        chainId: 8453,
        explorerUrl: `https://explorer.test/8453/${hash}`,
      });
    });

    it('rejects with REMOTE_WRONG_ACCOUNT when the broadcast tx is from someone else', async () => {
      getTransaction.mockResolvedValue({ from: '0x' + '11'.repeat(20) });
      await expect(signAndSendTransaction(params, broadcastingSigner)).rejects.toMatchObject({
        code: 'REMOTE_WRONG_ACCOUNT',
      });
    });

    it('tolerates a tx not yet visible on our RPC (best-effort check)', async () => {
      getTransaction.mockResolvedValue(null);
      await expect(signAndSendTransaction(params, broadcastingSigner)).resolves.toMatchObject({ hash });
    });

    it('tolerates lookup failures (best-effort check)', async () => {
      getTransaction.mockRejectedValue(new Error('rpc down'));
      await expect(signAndSendTransaction(params, broadcastingSigner)).resolves.toMatchObject({ hash });
    });
  });

  it('passes device-backend errors through with their stable code intact', async () => {
    // LEDGER_*/REMOTE_* errors carry user-facing messages and codes the
    // approval UIs rely on; the generic rewrap must not swallow them —
    // e.g. a phone error mentioning "gas" must not become our local
    // gas-estimation message.
    const deviceError = Object.assign(new Error('intrinsic gas too low'), {
      code: 'REMOTE_UNKNOWN',
    });
    const rejectingSigner = {
      ...signer,
      signTransaction: async () => {
        throw deviceError;
      },
    };

    await expect(
      signAndSendTransaction(
        { to: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C', value: '1', gasLimit: '21000', gasPrice: '7', chainId: 1 },
        rejectingSigner,
      ),
    ).rejects.toBe(deviceError);
  });

  it('surfaces signer rejection (e.g. user declined on device) unchanged', async () => {
    const decliningSigner = {
      ...signer,
      signTransaction: async () => {
        throw new Error('User rejected on device');
      },
    };

    await expect(
      signAndSendTransaction(
        { to: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C', value: '1', gasLimit: '21000', gasPrice: '7', chainId: 1 },
        decliningSigner,
      ),
    ).rejects.toThrow(/User rejected on device/);
  });
});
