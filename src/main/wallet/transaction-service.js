/**
 * Transaction Service
 *
 * Handles gas estimation, transaction building, signing, and broadcasting.
 * Uses the vault's derived keys for signing.
 */

const { parseUnits, formatUnits, Interface, Wallet, Transaction } = require('ethers');
const chainData = require('../networks/chain-data-router');
const { getTxExplorerUrl } = require('./chains');

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
  try {
    const tx = {
      from,
      to,
      value: value || '0',
    };

    if (data) {
      tx.data = data;
    }

    const { result } = await chainData.request(chainId, 'eth_estimateGas', [tx]);
    const gasLimit = BigInt(result);

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
  try {
    const quote = await chainData.getFeeQuote(chainId);
    console.log('[TransactionService] Fee quote:', {
      chainId,
      type: quote.type,
      source: quote.source,
      maxFeePerGas: quote.maxFeePerGas,
      maxPriorityFeePerGas: quote.maxPriorityFeePerGas,
      gasPrice: quote.gasPrice,
    });
    return quote;
  } catch (err) {
    console.error('[TransactionService] Failed to get gas prices:', err);
    throw new Error(`Failed to get gas prices: ${err.message}`, { cause: err });
  }
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
  if (maxFeePerGas != null && maxPriorityFeePerGas != null) {
    if (BigInt(maxPriorityFeePerGas) > BigInt(maxFeePerGas)) {
      throw new Error('Invalid transaction fees: priority fee exceeds maximum fee');
    }
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
 * Sign and broadcast a transaction
 * @param {Object} params - Transaction parameters
 * @param {string} params.to - Recipient (or token contract for ERC-20)
 * @param {string} params.value - Value in wei
 * @param {string} [params.data] - Transaction data
 * @param {string} params.gasLimit - Gas limit
 * @param {string} [params.maxFeePerGas] - Max fee per gas (EIP-1559)
 * @param {string} [params.maxPriorityFeePerGas] - Max priority fee (EIP-1559)
 * @param {string} [params.gasPrice] - Gas price (legacy)
 * @param {number} params.chainId - Chain ID
 * @param {string} privateKey - Private key for signing (0x-prefixed)
 * @returns {Promise<Object>} Transaction result
 */
async function signAndSendTransaction(params, privateKey) {
  const { to, value, data, gasLimit, maxFeePerGas, maxPriorityFeePerGas, gasPrice, chainId } = params;

  try {
    const wallet = new Wallet(privateKey);

    // Get nonce
    const nonceResponse = await chainData.request(chainId, 'eth_getTransactionCount', [
      wallet.address,
      'pending',
    ]);
    const nonce = Number(BigInt(nonceResponse.result));

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
      nonceSource: nonceResponse.source,
    });

    const signedTransaction = await wallet.signTransaction(tx);
    const parsedTransaction = Transaction.from(signedTransaction);
    const broadcast = await chainData.broadcastRawTransaction(chainId, signedTransaction);
    if (
      parsedTransaction.hash &&
      String(broadcast.result).toLowerCase() !== parsedTransaction.hash.toLowerCase()
    ) {
      throw new Error('Transaction broadcaster returned a mismatched hash');
    }

    console.log('[TransactionService] Transaction sent:', broadcast.result);

    return {
      hash: broadcast.result,
      nonce: parsedTransaction.nonce,
      from: wallet.address,
      to: parsedTransaction.to,
      value: parsedTransaction.value?.toString(),
      chainId,
      broadcastSource: broadcast.source,
      explorerUrl: getTxExplorerUrl(chainId, broadcast.result),
    };
  } catch (err) {
    console.error('[TransactionService] Transaction failed:', err);

    // Parse common error messages
    const message = String(err?.message || '');
    const normalizedMessage = message.toLowerCase();
    if (normalizedMessage.includes('insufficient funds')) {
      throw new Error('Insufficient funds for transaction', { cause: err });
    }
    if (
      [
        'nonce too low',
        'nonce too high',
        'invalid nonce',
        'nonce has already been used',
        'replacement transaction underpriced',
      ].some((pattern) => normalizedMessage.includes(pattern))
    ) {
      throw new Error('Transaction nonce error. Please try again.', { cause: err });
    }
    if (
      normalizedMessage.includes('priority fee') ||
      normalizedMessage.includes('priorityfee') ||
      normalizedMessage.includes('maxfeepergas') ||
      normalizedMessage.includes('maxpriorityfeepergas') ||
      normalizedMessage.includes('fee cap') ||
      normalizedMessage.includes('base fee')
    ) {
      throw new Error('Transaction fee data is invalid. Please refresh and try again.', {
        cause: err,
      });
    }
    if (normalizedMessage.includes('gas')) {
      throw new Error('Gas estimation error. The transaction may fail.', { cause: err });
    }
    // Server errors (rate limiting, blocked, etc.)
    if (
      err.code === 'SERVER_ERROR' ||
      message.includes('SERVER_ERROR') ||
      message.includes('403') ||
      message.includes('429') ||
      normalizedMessage.includes('invalid numeric value')
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
  try {
    const { result: receipt } = await chainData.request(chainId, 'eth_getTransactionReceipt', [txHash]);

    if (!receipt) {
      return {
        status: 'pending',
        hash: txHash,
      };
    }

    return {
      status: BigInt(receipt.status || 0) === 1n ? 'confirmed' : 'failed',
      hash: txHash,
      blockNumber: receipt.blockNumber ? Number(BigInt(receipt.blockNumber)) : null,
      gasUsed: receipt.gasUsed ? BigInt(receipt.gasUsed).toString() : null,
      effectiveGasPrice: receipt.effectiveGasPrice
        ? BigInt(receipt.effectiveGasPrice).toString()
        : null,
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
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const status = await getTransactionStatus(txHash, chainId);
      if (status.status === 'failed') return status;
      if (status.status === 'confirmed') {
        if (confirmations <= 1) return status;
        const { result: head } = await chainData.request(chainId, 'eth_blockNumber');
        if (Number(BigInt(head)) - status.blockNumber + 1 >= confirmations) return status;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Timed out waiting for transaction confirmation');
  } catch (err) {
    console.error('[TransactionService] Wait for transaction failed:', err);
    throw new Error(`Transaction confirmation timeout: ${err.message}`, { cause: err });
  }
}

/**
 * Sign a personal message (EIP-191)
 * @param {string} message - Message to sign (hex string or UTF-8)
 * @param {string} privateKey - Private key for signing
 * @returns {Promise<string>} Signature (hex string)
 */
async function signPersonalMessage(message, privateKey) {
  try {
    const wallet = new Wallet(privateKey);

    // If message is hex-encoded, convert to raw bytes (not UTF-8 string)
    let messageToSign = message;
    if (message.startsWith('0x')) {
      messageToSign = Buffer.from(message.slice(2), 'hex');
    }

    // signMessage automatically applies EIP-191 prefix
    const signature = await wallet.signMessage(messageToSign);

    console.log('[TransactionService] Message signed');
    return signature;
  } catch (err) {
    console.error('[TransactionService] Message signing failed:', err);
    throw new Error(`Message signing failed: ${err.message}`, { cause: err });
  }
}

/**
 * Sign typed data (EIP-712)
 * @param {Object} typedData - EIP-712 typed data object
 * @param {string} privateKey - Private key for signing
 * @returns {Promise<string>} Signature (hex string)
 */
async function signTypedData(typedData, privateKey) {
  try {
    const wallet = new Wallet(privateKey);

    // Parse if string
    const data = typeof typedData === 'string' ? JSON.parse(typedData) : typedData;

    // Extract domain, types, and message from EIP-712 structure
    const { domain, types, message } = data;

    // Remove EIP712Domain from types (ethers handles it internally)
    const typesWithoutDomain = { ...types };
    delete typesWithoutDomain.EIP712Domain;

    // Sign using ethers' signTypedData
    const signature = await wallet.signTypedData(domain, typesWithoutDomain, message);

    console.log('[TransactionService] Typed data signed');
    return signature;
  } catch (err) {
    console.error('[TransactionService] Typed data signing failed:', err);
    throw new Error(`Typed data signing failed: ${err.message}`, { cause: err });
  }
}

module.exports = {
  estimateGas,
  getGasPrices,
  buildErc20TransferData,
  parseAmount,
  formatAmount,
  buildTransaction,
  signAndSendTransaction,
  getTransactionStatus,
  waitForTransaction,
  signPersonalMessage,
  signTypedData,
};
