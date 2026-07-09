/**
 * Freedom wallet bridge page.
 *
 * The other half of freedom's dual-purpose connection QR: phones without
 * an openlv-native wallet land here (inside a wallet app's in-app
 * browser). The page joins the openlv session encoded in the URL
 * fragment (client/wallet role) and forwards the browser's JSON-RPC
 * requests to this browser's injected `window.ethereum` provider — the
 * wallet app still shows its own confirmation UI for every request.
 *
 * Static and self-contained: no backend, no analytics, no external
 * requests beyond the signaling relay named in the code (ciphertext
 * only) and WebRTC. The session secret lives in `location.hash`, which
 * browsers do not send to the web server.
 */

import { createSession, decodeConnectionURL, mqtt, webrtc } from './openlv.esm.js';

// Only the wallet methods freedom actually tunnels; everything else is
// refused so a malicious QR cannot turn this page into a generic proxy.
const ALLOWED_METHODS = new Set([
  'eth_requestAccounts',
  'eth_accounts',
  'eth_chainId',
  'personal_sign',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  // Freedom switches the wallet onto the tx's chain before sending —
  // in-app wallet sessions default to mainnet otherwise.
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
]);

const el = (id) => document.getElementById(id);

function setStatus(text, state) {
  el('status-text').textContent = text;
  const spinner = el('status-spinner');
  spinner.classList.toggle('done', state === 'done');
  spinner.classList.toggle('failed', state === 'failed');
}

function fatal(message) {
  el('flow').classList.add('hidden');
  el('no-wallet').classList.add('hidden');
  const box = el('fatal');
  box.textContent = message;
  box.classList.remove('hidden');
}

function logRequest(method, outcome) {
  const item = document.createElement('li');
  item.textContent = `${method} — ${outcome}`;
  el('request-log').appendChild(item);
}

async function handleRequest(payload) {
  const { method, params } = payload || {};
  if (!ALLOWED_METHODS.has(method)) {
    logRequest(method || '(unknown)', 'refused');
    return { error: { code: -32601, message: 'Method not supported by this bridge' } };
  }

  setStatus(`Confirm in your wallet: ${method}`, null);
  try {
    const result = await window.ethereum.request({ method, params });
    logRequest(method, 'approved');
    return { result };
  } catch (err) {
    logRequest(method, 'rejected');
    return { error: { code: typeof err?.code === 'number' ? err.code : -32603, message: err?.message || 'Request failed' } };
  } finally {
    setStatus('Waiting for the next request…', 'done');
  }
}

async function main() {
  const uri = decodeURIComponent(location.hash.slice(1));
  if (!uri.startsWith('openlv://')) {
    fatal('This page needs a connection code — scan the QR code in Freedom browser again.');
    return;
  }

  if (!window.ethereum) {
    el('no-wallet').classList.remove('hidden');
    el('copy-link').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        el('copy-link').textContent = 'Copied!';
      } catch {
        el('copy-link').textContent = 'Copy failed — use the share menu';
      }
    });
    return;
  }

  el('flow').classList.remove('hidden');

  let params;
  try {
    params = decodeConnectionURL(uri);
  } catch {
    fatal('This connection code is invalid. Generate a new QR code in Freedom browser.');
    return;
  }
  if (params.p !== 'mqtt') {
    fatal(`Unsupported signaling protocol "${params.p}".`);
    return;
  }

  try {
    setStatus('Connecting to Freedom browser…', null);
    const session = await createSession(params, mqtt, [webrtc()], handleRequest);

    session.emitter.on('state_change', (state) => {
      if (state?.status === 'connected') {
        setStatus('Connected — approve requests in your wallet.', 'done');
      } else if (state?.status === 'disconnected') {
        setStatus('Disconnected. Scan a new QR code in Freedom browser to reconnect.', 'failed');
      }
    });

    await session.connect();
    window.addEventListener('pagehide', () => session.close());
  } catch (err) {
    console.error('[Bridge] connection failed:', err);
    fatal(`Connection failed: ${err.message}. Generate a new QR code and try again.`);
  }
}

main();
