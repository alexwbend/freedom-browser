/**
 * Wallet IPC Handlers
 *
 * Registers IPC handlers for wallet operations.
 */

const { ipcMain } = require('electron');
const QRCode = require('qrcode');
const IPC = require('../../shared/ipc-channels');
const { getAllBalances, getBalancesWithCache, clearBalanceCache } = require('./balance-service');
const { getChain, getAllChains } = require('./chains');
const { testProvider } = require('./provider-manager');
const {
  estimateGas,
  getGasPrices,
  buildErc20TransferData,
  parseAmount,
  getTransactionStatus,
  waitForTransaction,
  signPersonalMessage,
  signTypedData,
} = require('./transaction-service');
const { signAndRecord, KINDS: PAYMENT_KINDS } = require('./tx-recorder');
const {
  getActiveWalletAddress,
  getActiveWalletIndex,
  getDerivedWallets,
} = require('../identity-manager');
const {
  getPermission,
  grantPermission,
  updateLastUsed,
} = require('./dapp-permissions');
const { getEffectiveRpcUrls } = require('./rpc-manager');
const { withVaultPrivateKey } = require('./vault-access');
const { isVaultLockedError } = require('./vault-errors');
const { presentTrustedVaultUnlockPrompt } = require('../trusted-vault-unlock-prompt');
const trustedWalletApprovalPrompt = require('../trusted-wallet-approval-prompt');

const READONLY_PROVIDER_ERRORS = Object.freeze({
  UNSUPPORTED_METHOD: { code: 4200, message: 'Method not supported' },
});
const PACKAGE_PROVIDER_UNAVAILABLE = Object.freeze({
  code: 4100,
  message: 'Ethereum provider method is unavailable in package mode until a shell-owned trusted prompt exists',
  data: { reason: 'trusted_prompt_unavailable' },
});
const PACKAGE_PROVIDER_REJECTED = Object.freeze({
  code: 4001,
  message: 'User rejected the request',
  data: { reason: 'shell_trusted_prompt_rejected' },
});
const PACKAGE_PROVIDER_WALLET_UNAVAILABLE = Object.freeze({
  code: 4100,
  message: 'No active wallet account is available for this origin',
  data: { reason: 'wallet_account_unavailable' },
});
const PACKAGE_PROVIDER_UNAUTHORIZED = Object.freeze({
  code: 4100,
  message: 'Wallet is not connected. Call eth_requestAccounts first.',
  data: { reason: 'wallet_not_connected' },
});
const PACKAGE_PROVIDER_VAULT_LOCKED = Object.freeze({
  code: 4100,
  message: 'Vault is locked',
  data: { reason: 'vault_locked' },
});
const PACKAGE_PROVIDER_INVALID_PARAMS = Object.freeze({
  code: -32602,
  message: 'Invalid provider request parameters',
  data: { reason: 'invalid_params' },
});
const PACKAGE_PROVIDER_SIGNING_FAILED = Object.freeze({
  code: -32603,
  message: 'Wallet signing failed',
  data: { reason: 'wallet_signing_failed' },
});
const PACKAGE_PROVIDER_TRANSACTION_FAILED = Object.freeze({
  code: -32603,
  message: 'Wallet transaction failed',
  data: { reason: 'wallet_transaction_failed' },
});
const DEFAULT_PROVIDER_CHAIN_ID = 100;
const ERC20_TRANSFER_SELECTOR = '0xa9059cbb';
const PACKAGE_PROVIDER_ACCOUNT_METHODS = new Set(['eth_accounts']);
const PACKAGE_PROVIDER_CONNECT_METHODS = new Set(['eth_requestAccounts']);
const PACKAGE_PROVIDER_TRANSACTION_METHODS = new Set(['eth_sendTransaction']);
const PACKAGE_PROVIDER_SIGNABLE_METHODS = new Set([
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
]);
const PACKAGE_PROVIDER_SIGNATURE_METHODS = new Set([
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
]);

/**
 * Validate that an RPC URL is a known, trusted endpoint.
 * Builds an allowlist from all chain configs + configured provider URLs.
 */
function isAllowedRpcUrl(rpcUrl) {
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
  } catch {
    return false;
  }

  // Allowlist = the registry's resolved rpc pool for every known chain.
  const chains = getAllChains();
  for (const chain of Object.values(chains)) {
    const providerUrls = getEffectiveRpcUrls(chain.chainId);
    for (const url of providerUrls) {
      if (url === rpcUrl) return true;
    }
  }

  return false;
}

// Shared body of the two send-transaction IPC handlers. They differ only
// in which wallet index signs and which payment-history kind tags the
// resulting row.
function buildTxRecordContext(kind, context = {}) {
  return { ...context, kind };
}

function handleReadonlyProviderRequest(payload = {}) {
  const method = typeof payload.method === 'string' ? payload.method : '';
  if (method === 'eth_chainId') {
    // Match the current renderer-side provider default without exposing wallet
    // or permission APIs to package chrome.
    return { result: '0x64', error: null };
  }
  return {
    result: null,
    error: READONLY_PROVIDER_ERRORS.UNSUPPORTED_METHOD,
  };
}

function isPackageHostedProviderRequest(event) {
  const hostWebContents = event?.sender?.hostWebContents;
  if (!hostWebContents) {
    return false;
  }

  const { isPackageWebContents } = require('../shell-api');
  return isPackageWebContents(hostWebContents) === true;
}

function handleProviderHostContext(event) {
  return {
    packageHosted: isPackageHostedProviderRequest(event),
  };
}

function getPackageHostWebContents(event) {
  return event?.sender?.hostWebContents || null;
}

function getPackageHostIdentity(hostWebContents) {
  if (!hostWebContents) {
    return null;
  }
  const { getPackageWebContentsIdentity } = require('../shell-api');
  return typeof getPackageWebContentsIdentity === 'function'
    ? getPackageWebContentsIdentity(hostWebContents)
    : null;
}

function deriveProviderOrigin(event) {
  const url = event?.sender?.getURL?.();
  if (typeof url !== 'string' || !url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.origin && parsed.origin !== 'null') {
      return parsed.origin;
    }
    if (parsed.protocol && parsed.host) {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    return null;
  }
  return null;
}

async function presentTrustedWalletConnectPrompt(request, context = {}) {
  return trustedWalletApprovalPrompt.presentTrustedWalletApprovalPrompt(request, context);
}

async function presentTrustedWalletTransactionPrompt(request, context = {}) {
  return trustedWalletApprovalPrompt.presentTrustedWalletApprovalPrompt(request, context);
}

async function presentTrustedWalletSignaturePrompt(request, context = {}) {
  return trustedWalletApprovalPrompt.presentTrustedWalletApprovalPrompt(request, context);
}

function getPackageProviderPrompt(method) {
  if (PACKAGE_PROVIDER_CONNECT_METHODS.has(method)) {
    return {
      reasonPrefix: 'Wallet connection request',
      brokerMethod: 'requestWalletConnectPrompt',
      presentTrustedPrompt: presentTrustedWalletConnectPrompt,
    };
  }
  if (PACKAGE_PROVIDER_TRANSACTION_METHODS.has(method)) {
    return {
      reasonPrefix: 'Wallet transaction request',
      brokerMethod: 'requestWalletTransactionPrompt',
      presentTrustedPrompt: presentTrustedWalletTransactionPrompt,
    };
  }
  if (PACKAGE_PROVIDER_SIGNATURE_METHODS.has(method)) {
    return {
      reasonPrefix: 'Wallet signature request',
      brokerMethod: 'requestWalletSignaturePrompt',
      presentTrustedPrompt: presentTrustedWalletSignaturePrompt,
    };
  }
  return null;
}

async function getAccountsForWalletIndex(walletIndex) {
  if (!Number.isInteger(walletIndex) || walletIndex < 0) {
    return [];
  }
  const wallets = await getDerivedWallets();
  if (!Array.isArray(wallets)) {
    return [];
  }
  const wallet = wallets.find((candidate) => candidate?.index === walletIndex);
  return typeof wallet?.address === 'string' && wallet.address ? [wallet.address] : [];
}

function normalizeEthereumAddress(address) {
  return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address)
    ? address.toLowerCase()
    : null;
}

async function getExistingPackageWalletAccounts(origin) {
  if (!origin) {
    return null;
  }
  const permission = getPermission(origin);
  if (!permission) {
    return null;
  }
  const accounts = await getAccountsForWalletIndex(permission.walletIndex);
  if (accounts.length > 0) {
    updateLastUsed(origin, permission.chainId);
  }
  return accounts;
}

async function getPackageWalletPermission(origin) {
  if (!origin) {
    return {
      ok: false,
      error: {
        code: 4100,
        message: 'Cannot use wallet without a verified origin',
        data: { reason: 'provider_origin_unavailable' },
      },
    };
  }

  const permission = getPermission(origin);
  if (!permission) {
    return {
      ok: false,
      error: PACKAGE_PROVIDER_UNAUTHORIZED,
    };
  }

  const accounts = await getAccountsForWalletIndex(permission.walletIndex);
  if (accounts.length === 0) {
    return {
      ok: false,
      error: PACKAGE_PROVIDER_WALLET_UNAVAILABLE,
    };
  }

  return {
    ok: true,
    permission,
    account: accounts[0],
  };
}

async function grantPackageWalletConnect(origin) {
  if (!origin) {
    return {
      ok: false,
      error: {
        code: 4100,
        message: 'Cannot grant wallet access without a verified origin',
        data: { reason: 'provider_origin_unavailable' },
      },
    };
  }

  const walletIndex = getActiveWalletIndex();
  const address = await getActiveWalletAddress();
  if (!Number.isInteger(walletIndex) || typeof address !== 'string' || !address) {
    return {
      ok: false,
      error: PACKAGE_PROVIDER_WALLET_UNAVAILABLE,
    };
  }

  grantPermission(origin, walletIndex, DEFAULT_PROVIDER_CHAIN_ID);
  return {
    ok: true,
    result: [address],
  };
}

function getAddressMismatchError(expectedAddress, requestedAddress) {
  return {
    code: 4100,
    message: 'Requested signing account is not connected for this origin',
    data: {
      reason: 'wallet_account_mismatch',
      expectedAddress,
      requestedAddress,
    },
  };
}

function getTransactionAccountMismatchError(expectedAddress, requestedAddress) {
  return {
    code: 4100,
    message: 'Requested transaction account is not connected for this origin',
    data: {
      reason: 'wallet_account_mismatch',
      expectedAddress,
      requestedAddress,
    },
  };
}

function normalizeProviderQuantity(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^0x[0-9a-fA-F]+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
      return trimmed;
    }
    return null;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'bigint' && value >= 0n) {
    return value.toString();
  }
  return null;
}

function normalizeProviderChainId(value, fallback = undefined) {
  const raw = normalizeProviderQuantity(value, fallback);
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null) {
    return null;
  }
  const parsed = Number(BigInt(raw));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeProviderData(data) {
  if (data === undefined || data === null || data === '') {
    return undefined;
  }
  return typeof data === 'string' && /^0x[0-9a-fA-F]*$/.test(data) ? data : null;
}

function getPackageTransactionPreview(params) {
  const txParams = Array.isArray(params) ? params[0] : null;
  if (!txParams || typeof txParams !== 'object') {
    return null;
  }
  const preview = {};
  if (typeof txParams.to === 'string') {
    preview.to = txParams.to;
  }
  const value = normalizeProviderQuantity(txParams.value, '0');
  if (value !== null && value !== undefined) {
    preview.value = value;
  }
  const chainId = normalizeProviderChainId(txParams.chainId);
  if (chainId) {
    preview.chainId = chainId;
  }
  return preview;
}

function getPackageSignaturePreview(method, params) {
  const list = Array.isArray(params) ? params : [];
  const preview = { method };
  if (method === 'personal_sign') {
    if (typeof list[1] === 'string') {
      preview.account = list[1];
    }
    if (typeof list[0] === 'string') {
      preview.messagePreview = list[0];
      preview.payloadSize = `${list[0].length} chars`;
    }
    return preview;
  }
  if (PACKAGE_PROVIDER_SIGNATURE_METHODS.has(method)) {
    if (typeof list[0] === 'string') {
      preview.account = list[0];
    }
    const typedData = list[1];
    if (typedData !== undefined) {
      let typedDataText;
      try {
        typedDataText = typeof typedData === 'string'
          ? typedData
          : JSON.stringify(typedData);
      } catch {
        typedDataText = '[unserializable typed data]';
      }
      preview.typedDataPreview = typedDataText;
      preview.payloadSize = `${typedDataText.length} chars`;
    }
  }
  return preview;
}

async function getConnectedWalletReviewDetails(origin) {
  const permission = origin ? getPermission(origin) : null;
  if (!permission) {
    return {};
  }
  const accounts = await getAccountsForWalletIndex(permission.walletIndex);
  return {
    account: accounts[0],
    walletIndex: permission.walletIndex,
    chainId: permission.chainId,
  };
}

async function getPackageWalletApprovalDetails(method, params, origin) {
  if (PACKAGE_PROVIDER_CONNECT_METHODS.has(method)) {
    const walletIndex = getActiveWalletIndex();
    const address = await getActiveWalletAddress();
    const details = {
      method,
      chainId: DEFAULT_PROVIDER_CHAIN_ID,
    };
    if (Number.isInteger(walletIndex)) {
      details.walletIndex = walletIndex;
    }
    if (typeof address === 'string' && address) {
      details.activeAccount = address;
    }
    return details;
  }

  const connected = await getConnectedWalletReviewDetails(origin);
  if (PACKAGE_PROVIDER_TRANSACTION_METHODS.has(method)) {
    return {
      method,
      ...connected,
      ...(getPackageTransactionPreview(params) || {}),
    };
  }
  if (PACKAGE_PROVIDER_SIGNATURE_METHODS.has(method)) {
    return {
      ...connected,
      ...getPackageSignaturePreview(method, params),
    };
  }
  return null;
}

function decodePackageErc20Transfer(data) {
  if (!data || typeof data !== 'string') {
    return null;
  }
  const hex = data.toLowerCase();
  if (!hex.startsWith(ERC20_TRANSFER_SELECTOR) || hex.length < 138) {
    return null;
  }
  const recipientSlot = hex.slice(10, 74);
  const amountSlot = hex.slice(74, 138);
  if (!/^[0-9a-f]{64}$/.test(recipientSlot) || !/^[0-9a-f]{64}$/.test(amountSlot)) {
    return null;
  }
  return {
    toAddress: `0x${recipientSlot.slice(24)}`,
    amount: BigInt(`0x${amountSlot}`).toString(10),
  };
}

function buildPackageDappTxContext(origin, txParams = {}) {
  const decoded = decodePackageErc20Transfer(txParams.data);
  if (!decoded || !txParams.to) {
    return { origin };
  }
  return {
    origin,
    asset: String(txParams.to).toLowerCase(),
    toAddress: decoded.toAddress,
    amount: decoded.amount,
    metadata: { erc20Method: 'transfer' },
  };
}

async function getPackageTransactionRequest(params, permission, connectedAccount) {
  const list = Array.isArray(params) ? params : [];
  const txParams = list[0];
  const connected = normalizeEthereumAddress(connectedAccount);
  if (!connected) {
    return {
      ok: false,
      error: PACKAGE_PROVIDER_WALLET_UNAVAILABLE,
    };
  }
  if (!txParams || typeof txParams !== 'object' || Array.isArray(txParams)) {
    return {
      ok: false,
      error: PACKAGE_PROVIDER_INVALID_PARAMS,
    };
  }

  const requestedFrom = txParams.from;
  const normalizedFrom = normalizeEthereumAddress(requestedFrom);
  if (requestedFrom && normalizedFrom !== connected) {
    return {
      ok: false,
      error: getTransactionAccountMismatchError(connectedAccount, requestedFrom),
    };
  }

  const to = normalizeEthereumAddress(txParams.to);
  const value = normalizeProviderQuantity(txParams.value, '0');
  const data = normalizeProviderData(txParams.data);
  const permissionChainId = normalizeProviderChainId(permission.chainId, DEFAULT_PROVIDER_CHAIN_ID);
  const requestedChainId = normalizeProviderChainId(txParams.chainId, permissionChainId);
  if (!to || value === null || data === null || !requestedChainId || !permissionChainId) {
    return {
      ok: false,
      error: PACKAGE_PROVIDER_INVALID_PARAMS,
    };
  }
  if (requestedChainId !== permissionChainId) {
    return {
      ok: false,
      error: {
        code: 4901,
        message: 'Requested transaction chain is not connected for this origin',
        data: {
          reason: 'wallet_chain_mismatch',
          expectedChainId: permissionChainId,
          requestedChainId,
        },
      },
    };
  }

  const gasLimit = normalizeProviderQuantity(txParams.gasLimit ?? txParams.gas);
  const gasPrice = normalizeProviderQuantity(txParams.gasPrice);
  const maxFeePerGas = normalizeProviderQuantity(txParams.maxFeePerGas);
  const maxPriorityFeePerGas = normalizeProviderQuantity(txParams.maxPriorityFeePerGas);
  if (
    gasLimit === null ||
    gasPrice === null ||
    maxFeePerGas === null ||
    maxPriorityFeePerGas === null ||
    (gasPrice && (maxFeePerGas || maxPriorityFeePerGas)) ||
    ((maxFeePerGas || maxPriorityFeePerGas) && !(maxFeePerGas && maxPriorityFeePerGas))
  ) {
    return {
      ok: false,
      error: PACKAGE_PROVIDER_INVALID_PARAMS,
    };
  }

  const transaction = {
    to,
    value,
    chainId: requestedChainId,
  };
  if (data) {
    transaction.data = data;
  }

  try {
    if (gasLimit) {
      transaction.gasLimit = gasLimit;
    } else {
      const gasEstimate = await estimateGas({
        from: connectedAccount,
        to,
        value,
        data,
        chainId: requestedChainId,
      });
      if (!gasEstimate?.gasLimit) {
        return {
          ok: false,
          error: {
            code: -32603,
            message: 'Gas estimation failed',
            data: { reason: 'gas_estimation_failed' },
          },
        };
      }
      transaction.gasLimit = gasEstimate.gasLimit;
    }

    if (maxFeePerGas && maxPriorityFeePerGas) {
      transaction.maxFeePerGas = maxFeePerGas;
      transaction.maxPriorityFeePerGas = maxPriorityFeePerGas;
    } else if (gasPrice) {
      transaction.gasPrice = gasPrice;
    } else {
      const prices = await getGasPrices(requestedChainId);
      if (prices?.type === 'eip1559' && prices.maxFeePerGas && prices.maxPriorityFeePerGas) {
        transaction.maxFeePerGas = prices.maxFeePerGas;
        transaction.maxPriorityFeePerGas = prices.maxPriorityFeePerGas;
      } else if (prices?.gasPrice) {
        transaction.gasPrice = prices.gasPrice;
      } else {
        return {
          ok: false,
          error: {
            code: -32603,
            message: 'Gas price lookup failed',
            data: { reason: 'gas_price_lookup_failed' },
          },
        };
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: -32603,
        message: err?.message || 'Transaction preparation failed',
        data: { reason: 'transaction_preparation_failed' },
      },
    };
  }

  return {
    ok: true,
    transaction,
  };
}

function getPackageSignatureRequest(method, params, connectedAccount) {
  const list = Array.isArray(params) ? params : [];
  const connected = normalizeEthereumAddress(connectedAccount);
  if (!connected) {
    return {
      ok: false,
      error: PACKAGE_PROVIDER_WALLET_UNAVAILABLE,
    };
  }

  if (method === 'personal_sign') {
    const message = list[0];
    const requestedAddress = list[1];
    const normalizedRequested = normalizeEthereumAddress(requestedAddress);
    if (typeof message !== 'string' || !message) {
      return {
        ok: false,
        error: PACKAGE_PROVIDER_INVALID_PARAMS,
      };
    }
    if (requestedAddress && normalizedRequested !== connected) {
      return {
        ok: false,
        error: getAddressMismatchError(connectedAccount, requestedAddress),
      };
    }
    return {
      ok: true,
      type: 'personal',
      message,
    };
  }

  if (PACKAGE_PROVIDER_SIGNABLE_METHODS.has(method)) {
    const requestedAddress = list[0];
    const typedData = list[1];
    const normalizedRequested = normalizeEthereumAddress(requestedAddress);
    if (!normalizedRequested || normalizedRequested !== connected || typedData === undefined) {
      return {
        ok: false,
        error: normalizedRequested && normalizedRequested !== connected
          ? getAddressMismatchError(connectedAccount, requestedAddress)
          : PACKAGE_PROVIDER_INVALID_PARAMS,
      };
    }
    return {
      ok: true,
      type: 'typedData',
      typedData,
    };
  }

  return {
    ok: false,
    error: {
      code: 4200,
      message: `Unsupported signing method: ${method || 'unknown'}`,
      data: { reason: 'unsupported_signing_method' },
    },
  };
}

function getPackageSignatureUnlockDetails(method, account) {
  return {
    method,
    account,
  };
}

function getPackageTransactionUnlockDetails(transaction = {}, account) {
  return {
    method: 'eth_sendTransaction',
    account,
    to: transaction.to,
    value: transaction.value,
    chainId: transaction.chainId,
  };
}

function getVaultUnlockPromptMetadata(unlockPrompt, context = {}) {
  return {
    kind: 'wallet.vaultUnlock',
    renderedBy: 'trusted-vault-unlock-window',
    surfaceOwner: 'shell',
    origin: context.origin || null,
    webContentsId: Number.isInteger(context.webContentsId) ? context.webContentsId : null,
    outcome: unlockPrompt?.outcome || null,
  };
}

function getVaultUnlockRejectedError(unlockPrompt, context = {}) {
  return {
    ...PACKAGE_PROVIDER_REJECTED,
    data: {
      ...PACKAGE_PROVIDER_REJECTED.data,
      prompt: getVaultUnlockPromptMetadata(unlockPrompt, context),
    },
  };
}

function getVaultUnlockUnavailableError(unlockPrompt) {
  return {
    ...PACKAGE_PROVIDER_VAULT_LOCKED,
    data: {
      ...PACKAGE_PROVIDER_VAULT_LOCKED.data,
      promptError: unlockPrompt?.error?.code || 'TRUSTED_VAULT_UNLOCK_UNAVAILABLE',
    },
  };
}

function isVaultLockedProviderResult(result) {
  return result?.ok === false && result.error?.data?.reason === 'vault_locked';
}

async function requestPackageProviderVaultUnlock({
  origin,
  method,
  operationResult,
  promptContext,
}) {
  const vaultUnlock = operationResult?.vaultUnlock || {};
  const request = {
    kind: vaultUnlock.kind || (
      PACKAGE_PROVIDER_TRANSACTION_METHODS.has(method)
        ? 'wallet.transaction'
        : 'wallet.signature'
    ),
    method,
    origin,
    reason: origin
      ? `Wallet vault unlock request from ${origin}`
      : 'Wallet vault unlock request',
    details: vaultUnlock.details || { method },
  };
  return presentTrustedVaultUnlockPrompt(request, promptContext);
}

async function runPackageProviderOperationWithVaultUnlock({
  operation,
  origin,
  method,
  promptContext,
}) {
  const first = await operation();
  if (!isVaultLockedProviderResult(first)) {
    return {
      operation: first,
      vaultUnlockPrompt: null,
    };
  }

  const unlockPrompt = await requestPackageProviderVaultUnlock({
    origin,
    method,
    operationResult: first,
    promptContext,
  });
  if (unlockPrompt?.ok === true && unlockPrompt.outcome === 'accepted') {
    return {
      operation: await operation(),
      vaultUnlockPrompt: unlockPrompt,
    };
  }
  if (unlockPrompt?.ok === true && unlockPrompt.outcome === 'rejected') {
    return {
      operation: {
        ok: false,
        error: getVaultUnlockRejectedError(unlockPrompt, promptContext),
      },
      vaultUnlockPrompt: unlockPrompt,
    };
  }
  return {
    operation: {
      ok: false,
      error: getVaultUnlockUnavailableError(unlockPrompt),
    },
    vaultUnlockPrompt: unlockPrompt || null,
  };
}

async function signPackageProviderRequest(origin, method, params) {
  const permission = await getPackageWalletPermission(origin);
  if (permission.ok !== true) {
    return permission;
  }

  const signatureRequest = getPackageSignatureRequest(method, params, permission.account);
  if (signatureRequest.ok !== true) {
    return signatureRequest;
  }

  try {
    const signature = await withVaultPrivateKey(permission.permission.walletIndex, (privateKey) => {
      if (signatureRequest.type === 'personal') {
        return signPersonalMessage(signatureRequest.message, privateKey);
      }
      return signTypedData(signatureRequest.typedData, privateKey);
    });
    updateLastUsed(origin, permission.permission.chainId);
    return {
      ok: true,
      result: signature,
    };
  } catch (err) {
    if (isVaultLockedError(err)) {
      return {
        ok: false,
        error: PACKAGE_PROVIDER_VAULT_LOCKED,
        vaultUnlock: {
          kind: 'wallet.signature',
          details: getPackageSignatureUnlockDetails(method, permission.account),
        },
      };
    }
    return {
      ok: false,
      error: {
        ...PACKAGE_PROVIDER_SIGNING_FAILED,
        message: err?.message || PACKAGE_PROVIDER_SIGNING_FAILED.message,
      },
    };
  }
}

async function sendPackageProviderTransaction(origin, params) {
  const permission = await getPackageWalletPermission(origin);
  if (permission.ok !== true) {
    return permission;
  }

  const transactionRequest = await getPackageTransactionRequest(
    params,
    permission.permission,
    permission.account
  );
  if (transactionRequest.ok !== true) {
    return transactionRequest;
  }

  const txResult = await handleSendTransaction(
    permission.permission.walletIndex,
    transactionRequest.transaction,
    PAYMENT_KINDS.DAPP_SEND,
    buildPackageDappTxContext(origin, transactionRequest.transaction)
  );
  if (txResult.success === true && txResult.hash) {
    updateLastUsed(origin, permission.permission.chainId);
    return {
      ok: true,
      result: txResult.hash,
    };
  }

  if (txResult.reason === 'vault_locked') {
    return {
      ok: false,
      error: PACKAGE_PROVIDER_VAULT_LOCKED,
      vaultUnlock: {
        kind: 'wallet.transaction',
        details: getPackageTransactionUnlockDetails(
          transactionRequest.transaction,
          permission.account
        ),
      },
    };
  }
  return {
    ok: false,
    error: {
      ...PACKAGE_PROVIDER_TRANSACTION_FAILED,
      message: txResult.error || PACKAGE_PROVIDER_TRANSACTION_FAILED.message,
    },
  };
}

async function handleProviderTrustedPromptRequest(event, payload = {}) {
  const method = typeof payload.method === 'string' ? payload.method : '';
  const hostWebContents = getPackageHostWebContents(event);
  if (!hostWebContents || !isPackageHostedProviderRequest(event)) {
    return {
      result: null,
      error: {
        code: 4100,
        message: 'Trusted provider prompt is only available for package-hosted guests',
        data: { reason: 'not_package_hosted' },
      },
    };
  }

  const origin = deriveProviderOrigin(event);
  const providerPrompt = getPackageProviderPrompt(method);
  if (PACKAGE_PROVIDER_ACCOUNT_METHODS.has(method)) {
    const existingAccounts = await getExistingPackageWalletAccounts(origin);
    return {
      result: existingAccounts || [],
      error: null,
    };
  }

  if (!providerPrompt) {
    return {
      result: null,
      error: {
        ...PACKAGE_PROVIDER_UNAVAILABLE,
        message: `${PACKAGE_PROVIDER_UNAVAILABLE.message}: ${method || 'unknown'}`,
      },
    };
  }

  const { defaultTrustedPromptBroker } = require('../trusted-prompt-broker');
  if (PACKAGE_PROVIDER_CONNECT_METHODS.has(method)) {
    const existingAccounts = await getExistingPackageWalletAccounts(origin);
    if (existingAccounts) {
      return {
        result: existingAccounts,
        error: null,
      };
    }
  }
  const promptPayload = {
    method,
    reason: origin ? `${providerPrompt.reasonPrefix} from ${origin}` : providerPrompt.reasonPrefix,
  };
  const promptDetails = await getPackageWalletApprovalDetails(method, payload.params, origin);
  if (promptDetails) {
    promptPayload.details = promptDetails;
  }
  const promptContext = {
    caller: getPackageHostIdentity(hostWebContents),
    origin,
    webContentsId: Number.isInteger(event?.sender?.id) ? event.sender.id : null,
    ownerWindow: hostWebContents.getOwnerBrowserWindow?.() || null,
    presentNativeDialog: providerPrompt.presentTrustedPrompt,
  };
  const prompt = await defaultTrustedPromptBroker[providerPrompt.brokerMethod](
    promptPayload,
    promptContext
  );

  if (prompt?.ok !== true) {
    return {
      result: null,
      error: {
        ...PACKAGE_PROVIDER_UNAVAILABLE,
        message: `${PACKAGE_PROVIDER_UNAVAILABLE.message}: ${method}`,
        data: {
          reason: 'trusted_prompt_unavailable',
          promptError: prompt?.error?.code || 'TRUSTED_PROMPT_UNAVAILABLE',
        },
      },
      trustedPrompt: prompt || null,
    };
  }

  if (
    PACKAGE_PROVIDER_CONNECT_METHODS.has(method) &&
    prompt.result?.outcome === 'accepted'
  ) {
    const grant = await grantPackageWalletConnect(origin);
    if (grant.ok === true) {
      return {
        result: grant.result,
        error: null,
        trustedPrompt: prompt,
      };
    }
    return {
      result: null,
      error: grant.error,
      trustedPrompt: prompt,
    };
  }

  if (
    PACKAGE_PROVIDER_TRANSACTION_METHODS.has(method) &&
    prompt.result?.outcome === 'accepted'
  ) {
    const { operation: transaction, vaultUnlockPrompt } =
      await runPackageProviderOperationWithVaultUnlock({
        operation: () => sendPackageProviderTransaction(origin, payload.params),
        origin,
        method,
        promptContext,
      });
    if (transaction.ok === true) {
      return {
        result: transaction.result,
        error: null,
        trustedPrompt: prompt,
        vaultUnlockPrompt,
      };
    }
    return {
      result: null,
      error: transaction.error,
      trustedPrompt: prompt,
      vaultUnlockPrompt,
    };
  }

  if (
    PACKAGE_PROVIDER_SIGNATURE_METHODS.has(method) &&
    prompt.result?.outcome === 'accepted'
  ) {
    const { operation: signature, vaultUnlockPrompt } =
      await runPackageProviderOperationWithVaultUnlock({
        operation: () => signPackageProviderRequest(origin, method, payload.params),
        origin,
        method,
        promptContext,
      });
    if (signature.ok === true) {
      return {
        result: signature.result,
        error: null,
        trustedPrompt: prompt,
        vaultUnlockPrompt,
      };
    }
    return {
      result: null,
      error: signature.error,
      trustedPrompt: prompt,
      vaultUnlockPrompt,
    };
  }

  return {
    result: null,
    error: {
      ...PACKAGE_PROVIDER_REJECTED,
      data: {
        ...PACKAGE_PROVIDER_REJECTED.data,
        prompt: {
          requestId: prompt.requestId,
          kind: prompt.kind,
          renderedBy: prompt.renderedBy,
          surfaceOwner: prompt.surfaceOwner,
          origin: prompt.context?.origin || null,
          webContentsId: prompt.context?.webContentsId || null,
        },
      },
    },
    trustedPrompt: prompt,
  };
}

async function handleSendTransaction(walletIndex, params, kind, context = {}) {
  try {
    const { to, value, data, gasLimit, maxFeePerGas, maxPriorityFeePerGas, gasPrice, chainId } = params;
    if (!to || chainId === undefined || !gasLimit) {
      return { success: false, error: 'Missing required parameters: to, chainId, gasLimit' };
    }
    const result = await withVaultPrivateKey(walletIndex, (privateKey) =>
      signAndRecord(
        { to, value, data, gasLimit, maxFeePerGas, maxPriorityFeePerGas, gasPrice, chainId },
        privateKey,
        buildTxRecordContext(kind, context),
      )
    );
    return { success: true, ...result };
  } catch (err) {
    console.error(`[WalletIPC] ${kind} transaction failed:`, err);
    if (isVaultLockedError(err)) {
      return { success: false, error: 'Vault is locked', reason: 'vault_locked' };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Register wallet IPC handlers
 */
function registerWalletIpc() {
  ipcMain.handle(IPC.DAPP_PROVIDER_READONLY_REQUEST, (_event, payload) =>
    handleReadonlyProviderRequest(payload)
  );
  ipcMain.handle(IPC.DAPP_PROVIDER_HOST_CONTEXT, handleProviderHostContext);
  ipcMain.handle(IPC.DAPP_PROVIDER_TRUSTED_PROMPT_REQUEST, handleProviderTrustedPromptRequest);

  // Get all balances for an address (always fetches fresh)
  ipcMain.handle('wallet:get-balances', async (_event, address) => {
    try {
      if (!address) {
        return { success: false, error: 'Address is required' };
      }
      const balances = await getAllBalances(address);
      return { success: true, balances, fromCache: false };
    } catch (err) {
      console.error('[WalletIPC] Failed to get balances:', err);
      return { success: false, error: err.message };
    }
  });

  // Get balances with cache-first strategy
  ipcMain.handle('wallet:get-balances-cached', async (_event, address) => {
    try {
      if (!address) {
        return { success: false, error: 'Address is required' };
      }
      const { balances, fromCache } = await getBalancesWithCache(address, true);
      return { success: true, balances, fromCache };
    } catch (err) {
      console.error('[WalletIPC] Failed to get cached balances:', err);
      return { success: false, error: err.message };
    }
  });

  // Clear balance cache
  ipcMain.handle('wallet:clear-balance-cache', async (_event, address) => {
    try {
      clearBalanceCache(address);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Get chain configuration
  ipcMain.handle('wallet:get-chain', async (_event, chainId) => {
    try {
      const chain = getChain(chainId);
      if (!chain) {
        return { success: false, error: `Chain ${chainId} not supported` };
      }
      return { success: true, chain };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Get all supported chains
  ipcMain.handle('wallet:get-chains', async () => {
    try {
      const chains = getAllChains();
      return { success: true, chains };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Test provider connectivity
  ipcMain.handle('wallet:test-provider', async (_event, chainId) => {
    try {
      const result = await testProvider(chainId);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Generate QR code as data URL
  ipcMain.handle('wallet:generate-qr', async (_event, text, options = {}) => {
    try {
      if (!text) {
        return { success: false, error: 'Text is required' };
      }
      const dataUrl = await QRCode.toDataURL(text, {
        width: options.width || 200,
        margin: options.margin || 2,
        color: {
          dark: options.dark || '#000000',
          light: options.light || '#ffffff',
        },
        errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      });
      return { success: true, dataUrl };
    } catch (err) {
      console.error('[WalletIPC] Failed to generate QR code:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================
  // Transaction handlers
  // ============================================

  // Estimate gas for a transaction
  ipcMain.handle('wallet:estimate-gas', async (_event, params) => {
    try {
      const { from, to, value, data, chainId } = params;
      if (!from || !to || chainId === undefined) {
        return { success: false, error: 'Missing required parameters: from, to, chainId' };
      }
      const result = await estimateGas({ from, to, value, data, chainId });
      return { success: true, ...result };
    } catch (err) {
      console.error('[WalletIPC] Gas estimation failed:', err);
      return { success: false, error: err.message };
    }
  });

  // Get current gas prices
  ipcMain.handle('wallet:get-gas-price', async (_event, chainId) => {
    try {
      if (chainId === undefined) {
        return { success: false, error: 'Chain ID is required' };
      }
      const prices = await getGasPrices(chainId);
      return { success: true, ...prices };
    } catch (err) {
      console.error('[WalletIPC] Failed to get gas prices:', err);
      return { success: false, error: err.message };
    }
  });

  // Build ERC-20 transfer data
  ipcMain.handle('wallet:build-erc20-data', async (_event, to, amount) => {
    try {
      if (!to || !amount) {
        return { success: false, error: 'Recipient and amount are required' };
      }
      const data = buildErc20TransferData(to, amount);
      return { success: true, data };
    } catch (err) {
      console.error('[WalletIPC] Failed to build ERC-20 data:', err);
      return { success: false, error: err.message };
    }
  });

  // Parse amount to smallest unit
  ipcMain.handle('wallet:parse-amount', async (_event, amount, decimals = 18) => {
    try {
      if (amount === undefined || amount === null || amount === '') {
        return { success: false, error: 'Amount is required' };
      }
      const parsed = parseAmount(amount.toString(), decimals);
      return { success: true, value: parsed.toString() };
    } catch (err) {
      console.error('[WalletIPC] Failed to parse amount:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('wallet:send-transaction', (_event, params, context) =>
    handleSendTransaction(getActiveWalletIndex(), params, PAYMENT_KINDS.WALLET_SEND, context));

  // Get transaction status
  ipcMain.handle('wallet:get-transaction-status', async (_event, txHash, chainId) => {
    try {
      if (!txHash || chainId === undefined) {
        return { success: false, error: 'Transaction hash and chain ID are required' };
      }
      const status = await getTransactionStatus(txHash, chainId);
      return { success: true, ...status };
    } catch (err) {
      console.error('[WalletIPC] Failed to get transaction status:', err);
      return { success: false, error: err.message };
    }
  });

  // Wait for transaction confirmation
  ipcMain.handle('wallet:wait-for-transaction', async (_event, txHash, chainId, confirmations = 1) => {
    try {
      if (!txHash || chainId === undefined) {
        return { success: false, error: 'Transaction hash and chain ID are required' };
      }
      const result = await waitForTransaction(txHash, chainId, confirmations);
      return { success: true, ...result };
    } catch (err) {
      console.error('[WalletIPC] Wait for transaction failed:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================
  // dApp-specific handlers (use specific wallet index)
  // ============================================

  // Renderer threads the dapp's permissionKey through as context.origin
  // so payment-history rows match the x402 permission store's keying.
  ipcMain.handle('wallet:dapp-send-transaction', (_event, params, walletIndex, context) =>
    handleSendTransaction(walletIndex, params, PAYMENT_KINDS.DAPP_SEND, context));

  // Sign a personal message (EIP-191) for a dApp
  ipcMain.handle('wallet:sign-message', async (_event, message, walletIndex) => {
    try {
      if (!message) {
        return { success: false, error: 'Message is required' };
      }

      const signature = await withVaultPrivateKey(walletIndex, (privateKey) =>
        signPersonalMessage(message, privateKey)
      );

      return { success: true, signature };
    } catch (err) {
      console.error('[WalletIPC] Message signing failed:', err);
      return { success: false, error: err.message };
    }
  });

  // Sign typed data (EIP-712) for a dApp
  ipcMain.handle('wallet:sign-typed-data', async (_event, typedData, walletIndex) => {
    try {
      if (!typedData) {
        return { success: false, error: 'Typed data is required' };
      }

      const signature = await withVaultPrivateKey(walletIndex, (privateKey) =>
        signTypedData(typedData, privateKey)
      );

      return { success: true, signature };
    } catch (err) {
      console.error('[WalletIPC] Typed data signing failed:', err);
      return { success: false, error: err.message };
    }
  });

  // Proxy JSON-RPC calls to external endpoints (renderer CSP blocks direct fetch)
  ipcMain.handle('wallet:proxy-rpc', async (_event, { rpcUrl, method, params }) => {
    try {
      if (!isAllowedRpcUrl(rpcUrl)) {
        return { success: false, error: { code: -32603, message: 'RPC URL not in allowlist' } };
      }

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params: params || [],
        }),
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        // Non-JSON response (e.g. "GNOSIS_MAINNET not enabled")
        return { success: false, error: { code: -32603, message: text.slice(0, 200) } };
      }
      if (data.error) {
        return { success: false, error: data.error };
      }
      return { success: true, result: data.result };
    } catch (err) {
      return { success: false, error: { code: -32603, message: err.message } };
    }
  });

  console.log('[WalletIPC] Handlers registered');
}

module.exports = {
  buildTxRecordContext,
  handleProviderHostContext,
  handleProviderTrustedPromptRequest,
  handleReadonlyProviderRequest,
  registerWalletIpc,
};
