const { hashMessage, TypedDataEncoder, getAddress } = require('ethers');
const {
  calculateSafeMessageHash,
  hashSafeMessage,
  buildSignatureBytes,
} = require('@safe-global/protocol-kit');

const { ownerWallet } = require('./__tests__/helpers/test-owners');

const OWNERS = [ownerWallet(0).address, ownerWallet(2).address, ownerWallet(4).address];
const SAFE_ADDRESS = getAddress('0x41aD4887971f90BB3fE4d83eCa65177281283261');

let mockTmpDir = require('os').tmpdir();
jest.mock('electron', () => ({
  app: { getPath: () => mockTmpDir },
}));

const mockWalletRecords = {
  0: { index: 0, name: 'Main Wallet', address: OWNERS[0], type: 'mnemonic' },
  2: { index: 2, name: 'My Stax', address: OWNERS[1], type: 'ledger' },
  4: { index: 4, name: 'My Phone', address: OWNERS[2], type: 'remote' },
  5: {
    index: 5,
    name: 'Joint',
    address: SAFE_ADDRESS,
    type: 'safe',
    owners: [0, 2, 4],
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
    threshold: 1,
    saltNonce: '9',
    deployed: {},
  },
  7: {
    index: 7,
    name: 'Backup',
    address: getAddress(SAFE_ADDRESS.toLowerCase().replace('0x41', '0x43')),
    type: 'safe',
    owners: [0, 2],
    threshold: 1,
    saltNonce: '11',
    deployed: { 100: true },
  },
};
const mockIsVaultUnlocked = jest.fn(async () => true);
jest.mock('../../identity-manager', () => ({
  getWalletRecord: (index) => mockWalletRecords[index] || null,
  isVaultUnlocked: (...args) => mockIsVaultUnlocked(...args),
  WALLET_TYPES: { MNEMONIC: 'mnemonic', LEDGER: 'ledger', REMOTE: 'remote', SAFE: 'safe' },
}));

// Distinct 65-byte signature blobs per owner so concatenation order is
// visible in completeSafeMessage's output.
const sigDataOf = { 0: '0x' + '11'.repeat(65), 2: '0x' + '22'.repeat(65), 4: '0x' + '33'.repeat(65) };
const signatureOf = (index) => ({
  signer: OWNERS[index === 0 ? 0 : index === 2 ? 1 : 2],
  data: sigDataOf[index],
});
const mockCollectOwnerSignature = jest.fn(async ({ ownerIndex }) => signatureOf(ownerIndex));
jest.mock('./safe-executor', () => ({
  SAFE_VERSION: '1.4.1',
  collectOwnerSignature: (...args) => mockCollectOwnerSignature(...args),
  pickDefaultExecutor: jest.requireActual('./safe-executor').pickDefaultExecutor,
}));

jest.mock('../provider-manager', () => ({
  getEip1193Provider: () => ({ request: jest.fn() }),
}));

const {
  startSafeMessage,
  signSafeMessage,
  completeSafeMessage,
  cancelSafeMessage,
  getSafeMessageState,
} = require('./safe-messages');

// "hello" hex-encoded, the way dApps send personal_sign payloads.
const HEX_MESSAGE = '0x68656c6c6f';

const DAPP_TYPED_DATA = {
  domain: { name: 'Test Dapp', chainId: 100, verifyingContract: '0x' + 'ab'.repeat(20) },
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Order: [{ name: 'amount', type: 'uint256' }],
  },
  primaryType: 'Order',
  message: { amount: '12' },
};

const DISPLAY = { site: 'app.example', method: 'personal_sign' };

const startPersonal = (safeIndex = 5, message = HEX_MESSAGE) =>
  startSafeMessage({
    safeIndex,
    request: { method: 'personal_sign', params: [message, SAFE_ADDRESS] },
    display: DISPLAY,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockIsVaultUnlocked.mockResolvedValue(true);
  for (const index of [5, 6, 7]) cancelSafeMessage(index);
});

describe('startSafeMessage', () => {
  test('wraps a hex personal message: EIP-191 digest over the BYTES in the SafeMessage envelope', async () => {
    const state = await startPersonal();

    // digest = what an EOA signer / verifying dApp computes: EIP-191
    // over the decoded bytes ("hello"), never the "0x…" text as UTF-8
    const digest = hashMessage('hello');
    const session = getSafeMessageState(5);
    expect(session.hash).toBe(
      calculateSafeMessageHash(SAFE_ADDRESS, digest, '1.4.1', 100n)
    );

    // the payload every owner signs is the SafeMessage envelope
    expect(mockCollectOwnerSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        typedData: expect.objectContaining({
          primaryType: 'SafeMessage',
          domain: { chainId: 100, verifyingContract: SAFE_ADDRESS },
          message: { message: digest },
        }),
        ownerIndex: 0,
      })
    );

    // only the free (mnemonic) owner was asked — devices never cold-called
    expect(mockCollectOwnerSignature).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({
      safeIndex: 5,
      kind: 'message',
      chainId: 100,
      threshold: 2,
      collected: 1,
      complete: false,
      display: DISPLAY,
      owners: [
        { index: 0, type: 'mnemonic', signed: true },
        { index: 2, type: 'ledger', signed: false },
        { index: 4, type: 'remote', signed: false },
      ].map((owner) => expect.objectContaining(owner)),
    });
  });

  test('plain-text personal messages hash as UTF-8', async () => {
    await startPersonal(5, 'gm world');
    expect(getSafeMessageState(5).hash).toBe(
      calculateSafeMessageHash(SAFE_ADDRESS, hashMessage('gm world'), '1.4.1', 100n)
    );
  });

  test('wraps dApp typed data (JSON-string param), matching protocol-kit hashing', async () => {
    await startSafeMessage({
      safeIndex: 5,
      request: {
        method: 'eth_signTypedData_v4',
        params: [SAFE_ADDRESS, JSON.stringify(DAPP_TYPED_DATA)],
      },
      display: { site: 'app.example', method: 'eth_signTypedData_v4' },
    });

    const digest = TypedDataEncoder.hash(
      DAPP_TYPED_DATA.domain,
      { Order: DAPP_TYPED_DATA.types.Order },
      DAPP_TYPED_DATA.message
    );
    expect(digest).toBe(hashSafeMessage(DAPP_TYPED_DATA)); // parity with protocol-kit
    expect(getSafeMessageState(5).hash).toBe(
      calculateSafeMessageHash(SAFE_ADDRESS, digest, '1.4.1', 100n)
    );
  });

  test('a 1-of-N session is complete right after the free signature', async () => {
    const state = await startPersonal(7);
    expect(state).toMatchObject({ collected: 1, threshold: 1, complete: true });
  });

  test('a locked vault collects nothing', async () => {
    mockIsVaultUnlocked.mockResolvedValue(false);
    const state = await startPersonal();
    expect(mockCollectOwnerSignature).not.toHaveBeenCalled();
    expect(state.collected).toBe(0);
  });

  test('refuses undeployed safes, non-safe accounts, and unsupported methods', async () => {
    await expect(startPersonal(6)).rejects.toThrow(/activate/i);
    await expect(startPersonal(0)).rejects.toThrow(/not a Safe/i);
    await expect(
      startSafeMessage({ safeIndex: 5, request: { method: 'eth_sign', params: [] }, display: {} })
    ).rejects.toThrow(/unsupported/i);
  });

  test('a DIFFERENT message replaces the stale session (its request died with its page)', async () => {
    await startPersonal();
    await signSafeMessage(5, 2); // 2 signatures collected for message #1

    const replaced = await startPersonal(5, 'a different message');
    expect(replaced.collected).toBe(1); // fresh session, fresh free sweep
    expect(getSafeMessageState(5).hash).toBe(
      calculateSafeMessageHash(SAFE_ADDRESS, hashMessage('a different message'), '1.4.1', 100n)
    );
  });

  test('re-requesting the SAME message resumes the session, signatures intact', async () => {
    // A dApp page reload retries its request; collected signatures are
    // still valid for the identical hash — resume, don't dead-end.
    await startPersonal();
    await signSafeMessage(5, 2);
    mockCollectOwnerSignature.mockClear();

    const resumed = await startPersonal();
    expect(resumed).toMatchObject({ collected: 2, complete: true });
    expect(mockCollectOwnerSignature).not.toHaveBeenCalled();
  });
});

describe('signSafeMessage', () => {
  test('signs exactly the requested owner; idempotent for signed ones', async () => {
    await startPersonal(); // owner 0 free-signed
    mockCollectOwnerSignature.mockClear();

    const state = await signSafeMessage(5, 2);
    expect(state).toMatchObject({ collected: 2, complete: true });

    mockCollectOwnerSignature.mockClear();
    const again = await signSafeMessage(5, 2);
    expect(mockCollectOwnerSignature).not.toHaveBeenCalled();
    expect(again.collected).toBe(2);
  });

  test('ownerless call sweeps the free signatures (board reopen after unlock)', async () => {
    mockIsVaultUnlocked.mockResolvedValue(false);
    await startPersonal();
    mockIsVaultUnlocked.mockResolvedValue(true);

    const state = await signSafeMessage(5);
    expect(state.collected).toBe(1);
    expect(state.owners.find((o) => o.index === 0).signed).toBe(true);
  });

  test('rejects non-owners and sessions that do not exist', async () => {
    await startPersonal();
    await expect(signSafeMessage(5, 3)).rejects.toThrow(/not an owner/i);
    await expect(signSafeMessage(7, 0)).rejects.toThrow(/no signature request/i);
  });

  test('a device failure leaves the session and its signatures intact', async () => {
    await startPersonal();
    mockCollectOwnerSignature.mockRejectedValueOnce(
      Object.assign(new Error('Ledger not connected'), { code: 'LEDGER_NOT_CONNECTED' })
    );
    await expect(signSafeMessage(5, 2)).rejects.toMatchObject({ code: 'LEDGER_NOT_CONNECTED' });
    expect(getSafeMessageState(5).collected).toBe(1);
  });

  test('a live ceremony blocks concurrent steps, cancel, and the send flow (shared lock)', async () => {
    await startPersonal();
    let resolveSign;
    mockCollectOwnerSignature.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSign = resolve))
    );

    const inFlight = signSafeMessage(5, 2);
    await new Promise((resolve) => setImmediate(resolve));

    await expect(signSafeMessage(5, 4)).rejects.toMatchObject({ code: 'SAFE_BUSY' });
    expect(() => cancelSafeMessage(5)).toThrow(/current step/i);
    expect(() => completeSafeMessage(5)).toThrow(/current step/i);
    // the SEND flow's guard is the same lock — one ceremony per Safe, full stop
    const { cancelSafeSend } = require('./safe-transactions');
    expect(() => cancelSafeSend(5)).toThrow(/current step/i);

    resolveSign(signatureOf(2));
    await inFlight;
    expect(getSafeMessageState(5).collected).toBe(2);
  });
});

describe('completeSafeMessage', () => {
  test('returns the sorted concatenated signature bytes and closes the session', async () => {
    await startPersonal();
    await signSafeMessage(5, 2);

    const { signature } = completeSafeMessage(5);

    // protocol-kit sorts by signer address — byte-identical output
    expect(signature).toBe(buildSignatureBytes([signatureOf(0), signatureOf(2)]));
    const inOrder = [signatureOf(0), signatureOf(2)]
      .sort((a, b) => a.signer.toLowerCase().localeCompare(b.signer.toLowerCase()))
      .map((sig) => sig.data.slice(2))
      .join('');
    expect(signature).toBe('0x' + inOrder);

    expect(getSafeMessageState(5)).toBeNull();
  });

  test('refuses below the threshold', async () => {
    await startPersonal();
    expect(() => completeSafeMessage(5)).toThrow(/not enough signatures/i);
    expect(getSafeMessageState(5)).not.toBeNull(); // session survives
  });
});

describe('getSafeMessageState / cancelSafeMessage', () => {
  test('null when nothing is open; cancel clears', async () => {
    expect(getSafeMessageState(5)).toBeNull();
    await startPersonal();
    expect(getSafeMessageState(5)).not.toBeNull();
    cancelSafeMessage(5);
    expect(getSafeMessageState(5)).toBeNull();
  });

  test('sessions are independent from pending sends (no cross-blocking)', async () => {
    // a message session on 5 does not create a pending SEND
    await startPersonal();
    const { getSafeSendState } = require('./safe-transactions');
    expect(getSafeSendState(5)).toBeNull();
  });
});
