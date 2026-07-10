const fs = require('fs');
const os = require('os');
const path = require('path');

const { ownerWallet } = require('./__tests__/helpers/test-owners');

const OWNERS = [ownerWallet(0).address, ownerWallet(2).address, ownerWallet(4).address];
const SAFE_ADDRESS = '0x41aD4887971f90BB3fE4d83eCa65177281283261';
const SAFE_TX_HASH = '0x' + 'cd'.repeat(32);
const TX_HASH = '0x' + 'ab'.repeat(32);

let mockTmpDir;
jest.mock('electron', () => ({
  app: { getPath: () => mockTmpDir },
}));

const mockWalletRecords = {
  0: { index: 0, name: 'Main Wallet', address: OWNERS[0], type: 'mnemonic' },
  2: { index: 2, name: 'My Stax', address: OWNERS[1], type: 'ledger' },
  5: {
    index: 5,
    name: 'Joint',
    address: SAFE_ADDRESS,
    type: 'safe',
    owners: [0, 2],
    threshold: 2,
    saltNonce: '7508',
    deployed: { 100: true },
  },
  6: {
    index: 6,
    name: 'Fresh',
    address: SAFE_ADDRESS.replace('41', '42'),
    type: 'safe',
    owners: [0, 2],
    threshold: 2,
    saltNonce: '9',
    deployed: {},
  },
};
jest.mock('../../identity-manager', () => ({
  getWalletRecord: (index) => mockWalletRecords[index] || null,
  WALLET_TYPES: { MNEMONIC: 'mnemonic', LEDGER: 'ledger', REMOTE: 'remote', SAFE: 'safe' },
}));

const builtResult = {
  safeAddress: SAFE_ADDRESS,
  deployed: true,
  safeTxData: { to: OWNERS[2], value: '1000', data: '0x', nonce: 0 },
  safeTxHash: SAFE_TX_HASH,
  typedData: { domain: {}, types: {}, message: {} },
};
const signatureOf = (index) => ({ signer: OWNERS[index === 0 ? 0 : 1], data: '0x' + 'ee'.repeat(65) });

const mockBuildSafeTransaction = jest.fn(async () => builtResult);
const mockCollectOwnerSignatures = jest.fn(async ({ owners, threshold, existing = [], onProgress }) => {
  const signatures = [...existing];
  for (const ownerIndex of owners) {
    if (signatures.length >= threshold) break;
    const signature = signatureOf(ownerIndex);
    if (signatures.some((sig) => sig.signer === signature.signer)) continue;
    signatures.push(signature);
    onProgress?.({ ownerIndex, address: signature.signer, status: 'signed', collected: signatures.length, threshold, signature });
  }
  return signatures;
});
const mockExecTransaction = jest.fn(async () => ({ hash: TX_HASH, recorded: true }));
jest.mock('./safe-executor', () => ({
  buildSafeTransaction: (...args) => mockBuildSafeTransaction(...args),
  collectOwnerSignatures: (...args) => mockCollectOwnerSignatures(...args),
  execTransaction: (...args) => mockExecTransaction(...args),
  pickDefaultExecutor: jest.requireActual('./safe-executor').pickDefaultExecutor,
}));

const {
  startSafeSend,
  resumeSafeSend,
  cancelSafeSend,
  getPendingInfo,
} = require('./safe-transactions');
const { getPending } = require('./pending-store');

const DISPLAY = { toAddress: OWNERS[2], asset: null, amount: '1000' };
const TX = { to: OWNERS[2], value: '1000', data: '0x' };

beforeEach(() => {
  mockTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-pending-'));
  jest.clearAllMocks();
  // pending-store caches per module load; reset by clearing all safes
  for (const index of [5, 6]) cancelSafeSend(index);
});

afterEach(() => {
  fs.rmSync(mockTmpDir, { recursive: true, force: true });
});

describe('startSafeSend', () => {
  test('builds, persists, collects to threshold, executes with recording, clears pending', async () => {
    const updates = [];
    const result = await startSafeSend({ safeIndex: 5, tx: TX, display: DISPLAY }, (u) => updates.push(u));

    expect(result.hash).toBe(TX_HASH);
    expect(mockBuildSafeTransaction).toHaveBeenCalledWith({
      chainId: 100,
      safe: mockWalletRecords[5],
      tx: TX,
    });
    expect(mockExecTransaction).toHaveBeenCalledWith({
      chainId: 100,
      safeAddress: SAFE_ADDRESS,
      safeTxData: builtResult.safeTxData,
      signatures: [signatureOf(0), signatureOf(2)],
      executorIndex: 0,
      record: {
        kind: 'safe-send',
        fromAddress: SAFE_ADDRESS,
        toAddress: DISPLAY.toAddress,
        asset: null,
        amount: '1000',
        metadata: { safeAddress: SAFE_ADDRESS, safeTxHash: SAFE_TX_HASH },
      },
    });
    expect(updates.filter((u) => u.status === 'signed')).toHaveLength(2);
    expect(getPending(5)).toBeNull();
  });

  test('refuses a second pending transaction for the same safe', async () => {
    // First collection stalls at one signature (device error on owner 2)
    mockCollectOwnerSignatures.mockImplementationOnce(async ({ onProgress }) => {
      onProgress?.({ ownerIndex: 0, address: OWNERS[0], status: 'signed', collected: 1, threshold: 2, signature: signatureOf(0) });
      throw new Error('Rejected on device');
    });
    await expect(startSafeSend({ safeIndex: 5, tx: TX, display: DISPLAY })).rejects.toThrow('Rejected on device');

    // The half-signed tx survived, so a new one is refused
    await expect(startSafeSend({ safeIndex: 5, tx: TX, display: DISPLAY })).rejects.toThrow(/already waiting/i);
    expect(getPending(5).signatures).toEqual([signatureOf(0)]);
  });

  test('refuses safes not yet deployed on Gnosis', async () => {
    await expect(startSafeSend({ safeIndex: 6, tx: TX, display: DISPLAY })).rejects.toThrow(/activate/i);
  });

  test('refuses non-safe accounts', async () => {
    await expect(startSafeSend({ safeIndex: 0, tx: TX, display: DISPLAY })).rejects.toThrow(/not a Safe/i);
  });
});

describe('resumeSafeSend', () => {
  test('passes persisted signatures as existing and executes', async () => {
    mockCollectOwnerSignatures.mockImplementationOnce(async ({ onProgress }) => {
      onProgress?.({ ownerIndex: 0, address: OWNERS[0], status: 'signed', collected: 1, threshold: 2, signature: signatureOf(0) });
      throw new Error('phone unreachable');
    });
    await expect(startSafeSend({ safeIndex: 5, tx: TX, display: DISPLAY })).rejects.toThrow('phone unreachable');

    const result = await resumeSafeSend(5);

    expect(result.hash).toBe(TX_HASH);
    expect(mockCollectOwnerSignatures).toHaveBeenLastCalledWith(
      expect.objectContaining({ existing: [signatureOf(0)] })
    );
    expect(getPending(5)).toBeNull();
  });

  test('a failed broadcast keeps the pending entry (signatures stay valid)', async () => {
    mockExecTransaction.mockRejectedValueOnce(new Error('RPC down'));
    await expect(startSafeSend({ safeIndex: 5, tx: TX, display: DISPLAY })).rejects.toThrow('RPC down');

    expect(getPending(5)).not.toBeNull();
    expect(getPending(5).signatures).toHaveLength(2);

    // retry succeeds without re-asking anyone
    const result = await resumeSafeSend(5);
    expect(result.hash).toBe(TX_HASH);
    expect(getPending(5)).toBeNull();
  });

  test('throws when there is nothing to resume', async () => {
    await expect(resumeSafeSend(5)).rejects.toThrow(/no pending/i);
  });
});

describe('getPendingInfo / cancelSafeSend', () => {
  test('reports the pending tx for the UI and cancel clears it', async () => {
    mockCollectOwnerSignatures.mockImplementationOnce(async ({ onProgress }) => {
      onProgress?.({ ownerIndex: 0, address: OWNERS[0], status: 'signed', collected: 1, threshold: 2, signature: signatureOf(0) });
      throw new Error('later');
    });
    await expect(startSafeSend({ safeIndex: 5, tx: TX, display: DISPLAY })).rejects.toThrow('later');

    const info = getPendingInfo(5);
    expect(info).toMatchObject({
      collected: 1,
      threshold: 2,
    });
    expect(typeof info.createdAt).toBe('number');

    cancelSafeSend(5);
    expect(getPendingInfo(5)).toBeNull();
    expect(getPending(5)).toBeNull();
  });
});
