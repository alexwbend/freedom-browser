/**
 * Transaction Service
 *
 * Handles gas estimation, transaction building, and broadcasting.
 * Signing is delegated to a Signer (see ./signers.js), so this module
 * never touches key material.
 */

const { parseUnits, formatUnits, Interface } = require('ethers');
const { getProvider, withRetry } = require('./provider-manager');
const { getTxExplorerUrl } = require('./chains');
const { REMOTE_ERROR_CODES, createRemoteError } = require('./remote/errors');

// ERC-20 transfer function interface
const ERC20_INTERFACE = new Interface([
  'function transfer(address to, uint256 amount) returns (bool)',
]);

/**
 * Estimate gas for a transaction
 * @param {Object} params - Transaction parameters
 * @param {string} params.from - Sender address
 * @param {string} params.to - Recipient address
 * @param {string} params.value - Value in wei (as string)
 * @param {string} [params.data] - Transaction data (for token transfers)
 * @param {number} params.chainId - Chain ID
 * @returns {Promise<{gasLimit: string, error?: string}>}
 */
async function estimateGas({ from, to, value, data, chainId }) {
  const provider = getProvider(chainId);
  if (!provider) {
    throw new Error(`No provider available for chain ${chainId}`);
  }

  try {
    const tx = {
      from,
      to,
      value: value || '0',
    };

    if (data) {
      tx.data = data;
    }

    const gasLimit = await withRetry(() => provider.estimateGas(tx), 2, chainId);

    // Add 20% buffer for safety
    const bufferedGas = (gasLimit * 120n) / 100n;

    return {
      gasLimit: bufferedGas.toString(),
    };
  } catch (err) {
    console.error('[TransactionService] Gas estimation failed:', err);
    throw new Error(`Gas estimation failed: ${err.message}`, { cause: err });
  }
}

/**
 * Get current gas prices for a chain
 * Returns EIP-1559 fee data with market preset
 * @param {number} chainId - Chain ID
 * @returns {Promise<Object>} Gas price data
 */
async function getGasPrices(chainId) {
  const provider = getProvider(chainId);
  if (!provider) {
    throw new Error(`No provider available for chain ${chainId}`);
  }

  try {
    const [feeData, block] = await withRetry(
      () => Promise.all([provider.getFeeData(), provider.getBlock('latest')]),
      2,
      chainId
    );

    // For EIP-1559 chains (Ethereum, Gnosis)
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      const baseFee = block?.baseFeePerGas || feeData.gasPrice || 0n;

      // Market: 2x base fee + priority fee (covers 2 blocks of full blocks)
      const marketMaxFee = baseFee * 2n + feeData.maxPriorityFeePerGas;

      return {
        type: 'eip1559',
        baseFee: baseFee.toString(),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.toString(),
        maxFeePerGas: marketMaxFee.toString(),
        // For display: estimated fee per gas
        effectiveGasPrice: ((baseFee + feeData.maxPriorityFeePerGas)).toString(),
      };
    }

    // Legacy gas price (fallback)
    return {
      type: 'legacy',
      gasPrice: (feeData.gasPrice || 0n).toString(),
      effectiveGasPrice: (feeData.gasPrice || 0n).toString(),
    };
  } catch (err) {
    console.error('[TransactionService] Failed to get gas prices:', err);
    throw new Error(`Failed to get gas prices: ${err.message}`, { cause: err });
  }
}

/**
 * getGasPrices result → the fee fields buildTransaction / send params
 * expect, so callers don't re-derive the eip1559-vs-legacy branch.
 * @param {Object} gasPrices - Result of getGasPrices
 * @returns {{maxFeePerGas: string, maxPriorityFeePerGas: string}|{gasPrice: string}}
 */
function toFeeFields(gasPrices) {
  return gasPrices.type === 'eip1559'
    ? {
        maxFeePerGas: gasPrices.maxFeePerGas,
        maxPriorityFeePerGas: gasPrices.maxPriorityFeePerGas,
      }
    : { gasPrice: gasPrices.gasPrice };
}

/**
 * Build ERC-20 transfer calldata
 * @param {string} to - Recipient address
 * @param {string} amount - Amount in token's smallest unit (as string)
 * @returns {string} Encoded calldata
 */
function buildErc20TransferData(to, amount) {
  return ERC20_INTERFACE.encodeFunctionData('transfer', [to, amount]);
}

/**
 * Parse amount string to wei/smallest unit
 * @param {string} amount - Human-readable amount (e.g., "1.5")
 * @param {number} decimals - Token decimals
 * @returns {bigint} Amount in smallest unit
 */
function parseAmount(amount, decimals = 18) {
  return parseUnits(amount, decimals);
}

/**
 * Format amount from wei/smallest unit to human-readable
 * @param {string|bigint} amount - Amount in smallest unit
 * @param {number} decimals - Token decimals
 * @returns {string} Human-readable amount
 */
function formatAmount(amount, decimals = 18) {
  return formatUnits(amount, decimals);
}

/**
 * Build a transaction object
 * @param {Object} params - Transaction parameters
 * @returns {Object} Unsigned transaction
 */
function buildTransaction({
  to,
  value,
  data,
  gasLimit,
  maxFeePerGas,
  maxPriorityFeePerGas,
  gasPrice,
  nonce,
  chainId,
}) {
  const tx = {
    to,
    value: value || '0',
    gasLimit,
    chainId,
  };

  if (data) {
    tx.data = data;
  }

  if (nonce !== undefined) {
    tx.nonce = nonce;
  }

  // EIP-1559 or legacy
  if (maxFeePerGas && maxPriorityFeePerGas) {
    tx.maxFeePerGas = maxFeePerGas;
    tx.maxPriorityFeePerGas = maxPriorityFeePerGas;
    tx.type = 2; // EIP-1559
  } else if (gasPrice) {
    tx.gasPrice = gasPrice;
    tx.type = 0; // Legacy
  }

  return tx;
}

/**
 * Best-effort check that a device-broadcast tx really came from the
 * signer's account: a compromised responder could report the hash of
 * someone else's transaction. The tx usually reaches our RPC a beat
 * after the device's, so "not visible yet" is not an error — only a
 * visible mismatch is.
 */
async function verifyDeviceBroadcastFrom(provider, hash, expectedFrom, chainId) {
  let tx;
  try {
    tx = await withRetry(() => provider.getTransaction(hash), 2, chainId);
  } catch (err) {
    console.warn('[TransactionService] Device-broadcast lookup failed:', err.message);
    return;
  }
  if (!tx) {
    console.warn('[TransactionService] Device-broadcast tx not visible on our RPC yet:', hash);
    return;
  }
  if (tx.from.toLowerCase() !== expectedFrom.toLowerCase()) {
    throw createRemoteError(REMOTE_ERROR_CODES.WRONG_ACCOUNT);
  }
}

/**
 * Sign and broadcast a transaction.
 *
 * Signing and broadcasting are separate steps so the signer can be
 * anything implementing the signer interface (vault key, hardware
 * device) — the provider only ever sees the serialized signed tx.
 *
 * @param {Object} params - Transaction parameters
 * @param {string} params.to - Recipient (or token contract for ERC-20)
 * @param {string} params.value - Value in wei
 * @param {string} [params.data] - Transaction data
 * @param {string} params.gasLimit - Gas limit
 * @param {string} [params.maxFeePerGas] - Max fee per gas (EIP-1559)
 * @param {string} [params.maxPriorityFeePerGas] - Max priority fee (EIP-1559)
 * @param {string} [params.gasPrice] - Gas price (legacy)
 * @param {number} params.chainId - Chain ID
 * @param {import('./signers').Signer} signer - Signer for the sending account
 * @returns {Promise<Object>} Transaction result
 */
async function signAndSendTransaction(params, signer) {
  const { to, value, data, gasLimit, maxFeePerGas, maxPriorityFeePerGas, gasPrice, chainId } = params;

  const provider = getProvider(chainId);
  if (!provider) {
    throw new Error(`No provider available for chain ${chainId}`);
  }

  try {
    const from = await signer.getAddress();

    // Backends that can only sign-and-broadcast through their own channel
    // (phone wallets) expose the optional sendTransaction capability: the
    // remote wallet picks the nonce, estimates gas, and broadcasts via its
    // own RPC — our gas parameters would be stale guesses by the time the
    // user confirms on the device, so only the intent fields go over.
    if (typeof signer.sendTransaction === 'function') {
      const hash = await signer.sendTransaction({ to, value, data, chainId });
      await verifyDeviceBroadcastFrom(provider, hash, from, chainId);
      console.log('[TransactionService] Transaction broadcast by signer:', hash);
      return {
        hash,
        from,
        to,
        value,
        chainId,
        explorerUrl: getTxExplorerUrl(chainId, hash),
      };
    }

    // Get nonce
    const nonce = await withRetry(() => provider.getTransactionCount(from, 'pending'), 2, chainId);

    // Build transaction
    const tx = buildTransaction({
      to,
      value,
      data,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasPrice,
      nonce,
      chainId,
    });

    console.log('[TransactionService] Signing transaction:', {
      to: tx.to,
      value: tx.value,
      gasLimit: tx.gasLimit,
      chainId: tx.chainId,
      nonce: tx.nonce,
    });

    const signedTx = await signer.signTransaction(tx);
    const txResponse = await provider.broadcastTransaction(signedTx);

    console.log('[TransactionService] Transaction sent:', txResponse.hash);

    return {
      hash: txResponse.hash,
      nonce: txResponse.nonce,
      from: txResponse.from,
      to: txResponse.to,
      value: txResponse.value?.toString(),
      chainId,
      explorerUrl: getTxExplorerUrl(chainId, txResponse.hash),
    };
  } catch (err) {
    console.error('[TransactionService] Transaction failed:', err);

    // Device-backend errors (LEDGER_*/REMOTE_*) carry a stable code and a
    // user-facing message; rewrapping them here would strip the code and
    // let the local-provider heuristics below mislabel them.
    if (typeof err.code === 'string' && /^(LEDGER|REMOTE)_/.test(err.code)) {
      throw err;
    }

    // Parse common error messages
    if (err.message.includes('insufficient funds')) {
      throw new Error('Insufficient funds for transaction', { cause: err });
    }
    if (err.message.includes('nonce')) {
      throw new Error('Transaction nonce error. Please try again.', { cause: err });
    }
    if (err.message.includes('gas')) {
      throw new Error('Gas estimation error. The transaction may fail.', { cause: err });
    }
    // Server errors (rate limiting, blocked, etc.)
    if (
      err.code === 'SERVER_ERROR' ||
      err.message.includes('SERVER_ERROR') ||
      err.message.includes('403') ||
      err.message.includes('429') ||
      err.message.includes('invalid numeric value')
    ) {
      throw new Error('RPC provider temporarily unavailable. Please try again.', { cause: err });
    }

    throw new Error(`Transaction failed: ${err.message}`, { cause: err });
  }
}

/**
 * Get transaction status/receipt
 * @param {string} txHash - Transaction hash
 * @param {number} chainId - Chain ID
 * @returns {Promise<Object>} Transaction status
 */
async function getTransactionStatus(txHash, chainId) {
  const provider = getProvider(chainId);
  if (!provider) {
    throw new Error(`No provider available for chain ${chainId}`);
  }

  try {
    const receipt = await withRetry(() => provider.getTransactionReceipt(txHash), 2, chainId);

    if (!receipt) {
      return {
        status: 'pending',
        hash: txHash,
      };
    }

    return {
      status: receipt.status === 1 ? 'confirmed' : 'failed',
      hash: txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed?.toString(),
      effectiveGasPrice: receipt.gasPrice?.toString(),
      explorerUrl: getTxExplorerUrl(chainId, txHash),
    };
  } catch (err) {
    console.error('[TransactionService] Failed to get transaction status:', err);
    return {
      status: 'unknown',
      hash: txHash,
      error: err.message,
    };
  }
}

/**
 * Wait for transaction confirmation
 * @param {string} txHash - Transaction hash
 * @param {number} chainId - Chain ID
 * @param {number} confirmations - Number of confirmations to wait for
 * @returns {Promise<Object>} Transaction receipt
 */
async function waitForTransaction(txHash, chainId, confirmations = 1) {
  const provider = getProvider(chainId);
  if (!provider) {
    throw new Error(`No provider available for chain ${chainId}`);
  }

  try {
    const receipt = await provider.waitForTransaction(txHash, confirmations, 60000); // 60s timeout

    return {
      status: receipt.status === 1 ? 'confirmed' : 'failed',
      hash: txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed?.toString(),
      effectiveGasPrice: receipt.gasPrice?.toString(),
      explorerUrl: getTxExplorerUrl(chainId, txHash),
    };
  } catch (err) {
    console.error('[TransactionService] Wait for transaction failed:', err);
    throw new Error(`Transaction confirmation timeout: ${err.message}`, { cause: err });
  }
}

module.exports = {
  estimateGas,
  getGasPrices,
  toFeeFields,
  buildErc20TransferData,
  parseAmount,
  formatAmount,
  buildTransaction,
  signAndSendTransaction,
  getTransactionStatus,
  waitForTransaction,
};
