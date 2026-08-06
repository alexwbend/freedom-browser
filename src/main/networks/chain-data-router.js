const log = require('../logger');
const registry = require('./network-registry');
const myotis = require('../myotis/myotis-manager');

const READ_METHODS = new Set([
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionCount',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_feeHistory',
  'eth_maxPriorityFeePerGas',
  'eth_getLogs',
]);

const COLIBRI_UNSUPPORTED = new Set([
  'eth_getFilterChanges',
  'eth_getFilterLogs',
  'eth_newFilter',
  'eth_newBlockFilter',
  'eth_newPendingTransactionFilter',
  'eth_uninstallFilter',
]);
const DIRECT_ONLY_METHODS = new Set([
  ...COLIBRI_UNSUPPORTED,
  'web3_clientVersion',
  'web3_sha3',
]);
READ_METHODS.add('web3_clientVersion');
READ_METHODS.add('web3_sha3');

const DEFAULT_READ_ORDER = ['myotis', 'colibri', 'quorum', 'direct'];
const DEFAULT_BROADCAST_ORDER = ['myotis', 'direct'];

class SourceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

function isReadMethod(method) {
  return READ_METHODS.has(method) || COLIBRI_UNSUPPORTED.has(method);
}

function quantity(value) {
  if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) {
    return `0x${BigInt(value).toString(16)}`;
  }
  return `0x${BigInt(value || 0).toString(16)}`;
}

function decimal(value) {
  if (value == null || value === '') return '0';
  return BigInt(value).toString(10);
}

function nativeResult(payload, ...keys) {
  if (!payload || payload.error || payload.status === 'error') {
    throw new Error(payload?.error || payload?.message || 'Myotis request failed');
  }
  for (const key of keys) {
    if (payload[key] != null) return payload[key];
  }
  throw new Error('Myotis returned an unexpected response');
}

function optionalNativeResult(payload, ...keys) {
  for (const key of keys) {
    if (payload?.[key] != null) return payload[key];
  }
  return null;
}

function feeQuote(source, gasPriceValue, priorityValue = null) {
  const gasPrice = BigInt(gasPriceValue);
  if (gasPrice <= 0n) throw new Error(`${source} returned a non-positive gas price`);

  const metadata = {
    source,
    verified: source === 'myotis' || source === 'colibri' || source === 'quorum',
  };
  if (priorityValue == null) {
    return {
      type: 'legacy',
      gasPrice: gasPrice.toString(),
      effectiveGasPrice: gasPrice.toString(),
      ...metadata,
    };
  }

  const priority = BigInt(priorityValue);
  // A provider can implement both methods yet return fee hints that cannot
  // form a valid type-2 transaction. Keep the usable gas price from that same
  // source and fall back to a legacy transaction instead of combining it with
  // another provider's priority fee.
  if (priority < 0n || priority > gasPrice) {
    log.verbose(
      `[chain-data] ${source} returned an inconsistent fee quote ` +
        `(gasPrice=${gasPrice}, priorityFee=${priority}); using legacy fees`
    );
    return {
      type: 'legacy',
      gasPrice: gasPrice.toString(),
      effectiveGasPrice: gasPrice.toString(),
      ...metadata,
    };
  }

  return {
    type: 'eip1559',
    baseFee: (gasPrice - priority).toString(),
    maxPriorityFeePerGas: priority.toString(),
    maxFeePerGas: gasPrice.toString(),
    effectiveGasPrice: gasPrice.toString(),
    ...metadata,
  };
}

async function requestMyotis(chainId, method, params) {
  if (!myotis.isReady(chainId)) throw new SourceUnavailableError('Myotis is not ready');

  if (method === 'eth_getBalance' || method === 'eth_getTransactionCount') {
    const account = await myotis.getAccount(params[0], chainId);
    const value = method === 'eth_getBalance'
      ? nativeResult(account, 'balanceWei', 'balance')
      : nativeResult(account, 'nonce');
    return quantity(value);
  }

  if (method === 'eth_call') {
    const call = params[0] || {};
    const result = await myotis.ethCall({
      chainId,
      from: call.from || '',
      to: call.to,
      data: call.data || '0x',
      value: decimal(call.value),
      block: params[1] || 'latest',
    });
    return nativeResult(result, 'resultHex', 'result');
  }

  if (method === 'eth_estimateGas') {
    const call = params[0] || {};
    const result = await myotis.estimateGas({
      chainId,
      from: call.from || '',
      to: call.to,
      data: call.data || '0x',
      value: decimal(call.value),
    });
    return quantity(nativeResult(result, 'gasLimit', 'result'));
  }

  if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') {
    const result = await myotis.feeEstimate(chainId);
    return quantity(
      method === 'eth_gasPrice'
        ? nativeResult(result, 'gasPriceWei', 'gasPrice')
        : nativeResult(result, 'maxPriorityFeePerGasWei', 'maxPriorityFeePerGas')
    );
  }

  throw new SourceUnavailableError(`Myotis does not support ${method}`);
}

async function requestColibri(chainId, method, params) {
  if (COLIBRI_UNSUPPORTED.has(method)) {
    throw new SourceUnavailableError(`Colibri does not support ${method}`);
  }
  if (!registry.getEndpoints(chainId, 'prover').length) {
    throw new SourceUnavailableError('No Colibri prover configured');
  }
  // Keep the WASM-backed verifier lazy; most startup paths do not need it.
  const { requestViaColibri } = require('../ens/colibri-resolver');
  return requestViaColibri(chainId, method, params);
}

async function requestRpcUrl(url, method, params, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) {
      const error = new Error(data.error.message || 'RPC request failed');
      error.code = data.error.code;
      error.data = data.error.data;
      throw error;
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function requestQuorum(chainId, method, params) {
  const network = registry.getNetwork(chainId) || {};
  const quorum = network.quorum || {};
  const k = Math.max(1, Number(quorum.k) || 3);
  const m = Math.max(1, Math.min(k, Number(quorum.m) || 2));
  const timeoutMs = Math.max(500, Number(quorum.timeoutMs) || 5000);
  const urls = registry.getEndpoints(chainId, 'rpc').slice(0, k);
  if (urls.length < m) throw new SourceUnavailableError(`RPC quorum needs ${m} endpoints`);

  const settled = await Promise.allSettled(
    urls.map((url) => requestRpcUrl(url, method, params, timeoutMs))
  );
  const groups = new Map();
  for (const entry of settled) {
    if (entry.status !== 'fulfilled') continue;
    const key = stableValue(entry.value);
    const group = groups.get(key) || { count: 0, value: entry.value };
    group.count += 1;
    groups.set(key, group);
    if (group.count >= m) return group.value;
  }
  throw new SourceUnavailableError(`RPC quorum did not reach ${m} matching responses`);
}

async function requestDirect(chainId, method, params) {
  const network = registry.getNetwork(chainId) || {};
  const timeoutMs = Math.max(500, Number(network.quorum?.timeoutMs) || 5000);
  const urls = registry.getEndpoints(chainId, 'rpc');
  if (!urls.length) throw new SourceUnavailableError('No RPC endpoint configured');
  let lastError;
  for (const url of urls) {
    try {
      return await requestRpcUrl(url, method, params, timeoutMs);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new SourceUnavailableError('All RPC endpoints failed');
}

async function requestDirectFeeQuote(chainId) {
  const network = registry.getNetwork(chainId) || {};
  const timeoutMs = Math.max(500, Number(network.quorum?.timeoutMs) || 5000);
  const urls = registry.getEndpoints(chainId, 'rpc');
  if (!urls.length) throw new SourceUnavailableError('No RPC endpoint configured');
  let lastError;
  for (const url of urls) {
    try {
      const gasPrice = await requestRpcUrl(url, 'eth_gasPrice', [], timeoutMs);
      let priority = null;
      try {
        // Deliberately use the same URL as eth_gasPrice. Falling through the
        // endpoint list independently is what produced mixed, invalid quotes.
        priority = await requestRpcUrl(url, 'eth_maxPriorityFeePerGas', [], timeoutMs);
      } catch {
        // Legacy transactions remain valid when this endpoint does not expose
        // an EIP-1559 priority-fee hint.
      }
      return feeQuote('direct', gasPrice, priority);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new SourceUnavailableError('All RPC endpoints failed');
}

async function requestSource(source, chainId, method, params) {
  if (source === 'myotis') return requestMyotis(chainId, method, params);
  if (source === 'colibri') return requestColibri(chainId, method, params);
  if (source === 'quorum') return requestQuorum(chainId, method, params);
  if (source === 'direct') return requestDirect(chainId, method, params);
  throw new SourceUnavailableError(`Unknown chain source: ${source}`);
}

async function request(chainId, method, params = []) {
  if (!isReadMethod(method)) throw new Error(`Unsupported read method: ${method}`);
  const network = registry.getNetwork(chainId);
  if (!network) throw new Error(`Unsupported chain ID: ${chainId}`);
  const order = network.access?.readOrder || DEFAULT_READ_ORDER;
  const failures = [];
  for (const source of order) {
    if (DIRECT_ONLY_METHODS.has(method) && source !== 'direct') continue;
    try {
      const result = await requestSource(source, Number(chainId), method, params);
      return {
        result,
        source,
        verified: source === 'myotis' || source === 'colibri' || source === 'quorum',
      };
    } catch (err) {
      failures.push(`${source}: ${err.message}`);
      log.verbose(`[chain-data] ${chainId} ${method} via ${source} failed: ${err.message}`);
    }
  }
  throw new Error(`All chain sources failed for ${method} (${failures.join('; ')})`);
}

async function getFeeQuote(chainId) {
  const network = registry.getNetwork(chainId);
  if (!network) throw new Error(`Unsupported chain ID: ${chainId}`);
  const order = network.access?.readOrder || DEFAULT_READ_ORDER;
  const failures = [];

  for (const source of order) {
    try {
      if (source === 'myotis') {
        if (!myotis.isReady(chainId)) throw new SourceUnavailableError('Myotis is not ready');
        const result = await myotis.feeEstimate(chainId);
        const gasPrice = nativeResult(result, 'gasPriceWei', 'gasPrice');
        const priority = optionalNativeResult(
          result,
          'maxPriorityFeePerGasWei',
          'maxPriorityFeePerGas'
        );
        return feeQuote(source, gasPrice, priority);
      }

      if (source === 'direct') return await requestDirectFeeQuote(chainId);

      const gasPrice = await requestSource(source, chainId, 'eth_gasPrice', []);
      let priority = null;
      try {
        priority = await requestSource(source, chainId, 'eth_maxPriorityFeePerGas', []);
      } catch {
        // Preserve source coherence by using this source's gas price as a
        // legacy quote rather than asking the next source for half a quote.
      }
      return feeQuote(source, gasPrice, priority);
    } catch (err) {
      failures.push(`${source}: ${err.message}`);
      log.verbose(`[chain-data] ${chainId} fee quote via ${source} failed: ${err.message}`);
    }
  }

  throw new Error(`All chain sources failed for fee quote (${failures.join('; ')})`);
}

async function broadcastRawTransaction(chainId, rawTransaction) {
  const network = registry.getNetwork(chainId);
  if (!network) throw new Error(`Unsupported chain ID: ${chainId}`);
  const order = network.access?.broadcastOrder || DEFAULT_BROADCAST_ORDER;
  const failures = [];
  for (const source of order) {
    try {
      let result;
      if (source === 'myotis') {
        if (!myotis.isReady(chainId)) throw new SourceUnavailableError('Myotis is not ready');
        const payload = await myotis.sendRawTransaction(rawTransaction, chainId);
        result = nativeResult(payload, 'txHash', 'result');
      } else if (source === 'direct') {
        result = await requestDirect(chainId, 'eth_sendRawTransaction', [rawTransaction]);
      } else {
        throw new SourceUnavailableError(`${source} cannot broadcast transactions`);
      }
      return { result, source };
    } catch (err) {
      failures.push(`${source}: ${err.message}`);
      log.verbose(`[chain-data] ${chainId} transaction broadcast via ${source} failed: ${err.message}`);
    }
  }
  throw new Error(`All transaction broadcasters failed (${failures.join('; ')})`);
}

module.exports = {
  isReadMethod,
  request,
  getFeeQuote,
  broadcastRawTransaction,
  requestRpcUrl,
  SourceUnavailableError,
};
