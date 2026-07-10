/**
 * Safe send orchestration: build a SafeTx, collect owner signatures one
 * device at a time, execute through the default executor, record it —
 * with the half-signed state persisted (pending-store) so a rejection,
 * an unreachable phone, or an app restart never loses collected
 * signatures. One pending SafeTx per Safe; cancel discards it.
 *
 * Signatures survive a failed broadcast too: the SafeTx nonce only
 * advances when an execution lands, so a retry re-uses them as-is.
 */

const { KINDS: PAYMENT_KINDS } = require('../tx-recorder');
const {
  buildSafeTransaction,
  collectOwnerSignatures,
  execTransaction,
  pickDefaultExecutor,
} = require('./safe-executor');
const { getSafeRecord, DEPLOY_CHAIN_ID } = require('./safe-service');
const { getPending, setPending, clearPending } = require('./pending-store');

/**
 * Build and start signing a new SafeTx. Runs through to execution when
 * every signer cooperates; on any interruption the collected signatures
 * are already persisted and resumeSafeSend picks up where it stopped.
 *
 * @param {Object} params
 * @param {number} params.safeIndex - Wallet index of the safe record
 * @param {Object} params.tx - {to, value, data?} the Safe should execute
 * @param {Object} params.display - Human-visible payment facts for
 *   history + the pending card: {toAddress, asset, amount}
 * @param {Function} [onProgress] - Signing checklist updates
 * @returns {Promise<Object>} transaction-service result ({hash, …})
 */
async function startSafeSend({ safeIndex, tx, display }, onProgress) {
  const record = getSafeRecord(safeIndex);
  if (!record.deployed?.[DEPLOY_CHAIN_ID]) {
    throw new Error('Activate this account on Gnosis before sending');
  }
  if (getPending(safeIndex)) {
    throw new Error('A transaction is already waiting for signatures — finish or cancel it first');
  }

  const built = await buildSafeTransaction({ chainId: DEPLOY_CHAIN_ID, safe: record, tx });
  setPending(safeIndex, {
    chainId: DEPLOY_CHAIN_ID,
    safeAddress: built.safeAddress,
    safeTxData: built.safeTxData,
    safeTxHash: built.safeTxHash,
    typedData: built.typedData,
    // threshold is a property of THIS SafeTx — frozen with it
    threshold: record.threshold,
    display,
    signatures: [],
    createdAt: Date.now(),
  });

  return resumeSafeSend(safeIndex, onProgress);
}

/**
 * Continue a persisted pending SafeTx: collect the missing signatures
 * (already-signed owners are skipped) and execute.
 *
 * @param {number} safeIndex
 * @param {Function} [onProgress]
 * @returns {Promise<Object>} transaction-service result ({hash, …})
 */
async function resumeSafeSend(safeIndex, onProgress) {
  const record = getSafeRecord(safeIndex);
  const pending = getPending(safeIndex);
  if (!pending) {
    throw new Error('No pending transaction for this account');
  }

  const signatures = await collectOwnerSignatures({
    typedData: pending.typedData,
    owners: record.owners,
    threshold: record.threshold,
    existing: pending.signatures,
    onProgress: (update) => {
      if (update.status === 'signed') {
        // Persist every signature the moment it exists — this is what a
        // restart resumes from.
        pending.signatures = [...pending.signatures, update.signature];
        setPending(safeIndex, pending);
      }
      onProgress?.(update);
    },
  });

  const result = await execTransaction({
    chainId: pending.chainId,
    safeAddress: pending.safeAddress,
    safeTxData: pending.safeTxData,
    signatures,
    executorIndex: pickDefaultExecutor(record.owners),
    record: {
      kind: PAYMENT_KINDS.SAFE_SEND,
      fromAddress: pending.safeAddress,
      toAddress: pending.display?.toAddress,
      asset: pending.display?.asset ?? null,
      amount: pending.display?.amount,
      metadata: { safeAddress: pending.safeAddress, safeTxHash: pending.safeTxHash },
    },
  });

  clearPending(safeIndex);
  return result;
}

/**
 * Compact view of the pending SafeTx for the account's status card.
 * @returns {{collected: number, threshold: number, createdAt: number}|null}
 */
function getPendingInfo(safeIndex) {
  const pending = getPending(safeIndex);
  if (!pending) {
    return null;
  }
  return {
    collected: pending.signatures.length,
    threshold: pending.threshold,
    createdAt: pending.createdAt,
  };
}

/** Discard the pending SafeTx (collected signatures are thrown away). */
function cancelSafeSend(safeIndex) {
  clearPending(safeIndex);
}

module.exports = { startSafeSend, resumeSafeSend, getPendingInfo, cancelSafeSend };
