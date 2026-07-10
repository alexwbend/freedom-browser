/**
 * SafeMessage signing sessions — EIP-1271 message signing for dApps.
 *
 * A dApp's personal_sign / eth_signTypedData_v4 against a Safe account
 * is answered with owner signatures over the SafeMessage EIP-712
 * envelope; the verifying dApp calls `isValidSignature` on the Safe,
 * whose fallback handler checks the same owner signatures against the
 * same envelope. Owners sign through the ordinary collection machinery
 * (signature-collection.js), so the board UX — free vault signatures,
 * Ledger tap, phone QR — is identical to sends.
 *
 * Sessions are IN-MEMORY only, unlike pending sends: a dApp request is
 * a live promise that dies with its page (or the app), so a persisted
 * half-signed message could never be delivered. They also don't touch
 * the Safe nonce, so a parked send never blocks a message session —
 * only the per-safe device-ceremony lock is shared.
 */

const { getAddress, hashMessage, TypedDataEncoder } = require('ethers');
const { getEip712MessageTypes, buildSignatureBytes } = require('@safe-global/protocol-kit');

const { SAFE_VERSION } = require('./safe-executor');
const { getSafeRecord, DEPLOY_CHAIN_ID } = require('./safe-service');
const {
  normalizeMessage,
  normalizeTypedData,
  withoutDomainType,
} = require('../signing-utils');
const {
  release,
  acquire,
  isBusy,
  ownersView,
  collectFreeSignatures,
  signEntryOwner,
} = require('./signature-collection');
const { codedError, SAFE_BUSY } = require('./errors');

const sessions = new Map();
const store = {
  get: (safeIndex) => sessions.get(safeIndex) || null,
  set: (safeIndex, entry) => sessions.set(safeIndex, entry),
  idOf: (entry) => entry.hash,
};

/**
 * The digest a VERIFIER computes for the dApp's request — EIP-191 for
 * personal messages (0x-hex decoded to bytes, exactly like the EOA
 * signer backends), the EIP-712 hash for typed data. This digest is
 * what goes into the SafeMessage envelope's `message` bytes field.
 * (protocol-kit's hashSafeMessage is deliberately not used for personal
 * messages: viem hashes hex STRINGS as UTF-8 text.)
 */
function requestDigest(method, params) {
  if (method === 'personal_sign') {
    return hashMessage(normalizeMessage(params[0]));
  }
  if (method === 'eth_signTypedData_v4') {
    const { domain, types, message } = normalizeTypedData(params[1]);
    return TypedDataEncoder.hash(domain, withoutDomainType(types), message);
  }
  throw new Error(`Unsupported signing method for Safe accounts: ${method}`);
}

function getSession(safeIndex) {
  const entry = sessions.get(safeIndex);
  if (!entry) {
    throw new Error('No signature request is open for this account');
  }
  return entry;
}

/** The board's render model for a message session; null when none is open. */
function getSafeMessageState(safeIndex) {
  const entry = sessions.get(safeIndex);
  if (!entry) {
    return null;
  }

  let ownerIndexes = [];
  try {
    ownerIndexes = getSafeRecord(safeIndex).owners;
  } catch {
    // record gone — render what the session alone supports
  }
  return {
    safeIndex,
    kind: 'message',
    chainId: entry.chainId,
    hash: entry.hash,
    threshold: entry.threshold,
    collected: entry.signatures.length,
    owners: ownersView(ownerIndexes, entry.signatures),
    display: entry.display,
    createdAt: entry.createdAt,
    complete: entry.signatures.length >= entry.threshold,
  };
}

/**
 * Open a SafeMessage session for a dApp signing request and silently
 * collect the free signatures (mnemonic owners, vault unlocked). Never
 * touches a device: the signing board drives those, per user action.
 *
 * @param {Object} params
 * @param {number} params.safeIndex
 * @param {{method: string, params: Array}} params.request - The dApp's
 *   verbatim personal_sign / eth_signTypedData_v4 request
 * @param {Object} params.display - Presentation facts for the board
 *   (site, method, preview…), stored verbatim
 * @returns {Promise<Object>} SafeMessageState
 */
async function startSafeMessage({ safeIndex, request, display }) {
  const record = getSafeRecord(safeIndex);
  // isValidSignature lives on the deployed contract — nothing to verify
  // against before activation.
  if (!record.deployed?.[DEPLOY_CHAIN_ID]) {
    throw new Error('Activate this account on Gnosis before signing for apps');
  }
  const digest = requestDigest(request.method, request.params);
  const safeAddress = getAddress(record.address);
  const typedData = {
    types: getEip712MessageTypes(SAFE_VERSION),
    domain: { chainId: DEPLOY_CHAIN_ID, verifyingContract: safeAddress },
    primaryType: 'SafeMessage',
    message: { message: digest },
  };
  const hash = TypedDataEncoder.hash(
    typedData.domain,
    withoutDomainType(typedData.types),
    typedData.message
  );

  const existing = sessions.get(safeIndex);
  if (existing && existing.hash === hash) {
    // The identical request again (dApp page reloaded and retried) —
    // resume: the collected signatures are still valid for this hash.
    return signSafeMessage(safeIndex);
  }
  // A different-hash leftover is a dead request (its promise died with
  // its page — sessions never outlive their request usefully): replace
  // it. A live ceremony is still protected by the acquire below.

  acquire(safeIndex);
  try {
    sessions.set(safeIndex, {
      chainId: DEPLOY_CHAIN_ID,
      typedData,
      hash,
      threshold: record.threshold,
      display,
      signatures: [],
      createdAt: Date.now(),
    });
    await collectFreeSignatures(store, safeIndex, record.owners);
  } finally {
    release(safeIndex);
  }
  return getSafeMessageState(safeIndex);
}

/**
 * Collect exactly one owner's signature (or, without an ownerIndex,
 * sweep the free ones — the board runs this on open). Same semantics as
 * the send flow's signSafePending: idempotent, per-safe lock, failures
 * belong to the row.
 *
 * @param {number} safeIndex
 * @param {number} [ownerIndex]
 * @returns {Promise<Object>} SafeMessageState
 */
async function signSafeMessage(safeIndex, ownerIndex) {
  const record = getSafeRecord(safeIndex);
  getSession(safeIndex);
  await signEntryOwner({ store, safeIndex, ownerIndex, ownerIndexes: record.owners });
  return getSafeMessageState(safeIndex);
}

/**
 * Close a threshold-met session and return the EIP-1271 signature: the
 * owners' signatures sorted by signer and concatenated, ready to hand
 * back to the dApp (which verifies via `isValidSignature` on the Safe).
 *
 * @param {number} safeIndex
 * @returns {{signature: string}}
 */
function completeSafeMessage(safeIndex) {
  if (isBusy(safeIndex)) {
    throw codedError('Wait for the current step to finish first', SAFE_BUSY);
  }
  const entry = getSession(safeIndex);
  if (entry.signatures.length < entry.threshold) {
    throw new Error(
      `Not enough signatures yet (${entry.signatures.length} of ${entry.threshold})`
    );
  }
  // buildSignatureBytes sorts its input in place — hand it a copy.
  const signature = buildSignatureBytes(entry.signatures.map((sig) => ({ ...sig })));
  sessions.delete(safeIndex);
  return { signature };
}

/** Drop the session (collected signatures are thrown away). */
function cancelSafeMessage(safeIndex) {
  if (isBusy(safeIndex)) {
    throw codedError('Wait for the current step to finish first', SAFE_BUSY);
  }
  sessions.delete(safeIndex);
}

module.exports = {
  startSafeMessage,
  signSafeMessage,
  completeSafeMessage,
  cancelSafeMessage,
  getSafeMessageState,
};
