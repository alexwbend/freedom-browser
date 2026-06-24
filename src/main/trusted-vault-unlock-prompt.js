const crypto = require('crypto');
const path = require('path');

const { BrowserWindow, ipcMain } = require('electron');
const identityManager = require('./identity-manager');

const CHANNEL_PREFIX = 'trusted-vault-unlock';
const PROMPT_WIDTH = 460;
const PROMPT_HEIGHT = 390;

function createRequestId(request = {}) {
  if (typeof request.requestId === 'string' && request.requestId.trim()) {
    return request.requestId.trim();
  }
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `vault-unlock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function channelFor(kind, requestId) {
  return `${CHANNEL_PREFIX}:${kind}:${requestId}`;
}

function safeString(value, maxLength = 500) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function normalizeKind(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isWalletTransactionRequest(request = {}) {
  return (
    normalizeKind(request.kind) === 'wallet.transaction' ||
    normalizeKind(request.method) === 'eth_sendTransaction'
  );
}

function isWalletSignatureRequest(request = {}) {
  const kind = normalizeKind(request.kind);
  const method = normalizeKind(request.method);
  return (
    kind === 'wallet.signature' ||
    method === 'personal_sign' ||
    method === 'eth_signTypedData' ||
    method === 'eth_signTypedData_v3' ||
    method === 'eth_signTypedData_v4'
  );
}

function getDefaultHeading(request = {}) {
  if (isWalletTransactionRequest(request)) {
    return 'Unlock vault for wallet transaction';
  }
  if (isWalletSignatureRequest(request)) {
    return 'Unlock vault for wallet signature';
  }
  return 'Unlock vault for x402 payment';
}

function buildPromptContext(request = {}, context = {}) {
  const details = request.details && typeof request.details === 'object'
    ? request.details
    : {};
  const origin = safeString(request.origin || context.origin || 'Unknown site', 300);
  let explicitRows = [];
  if (Array.isArray(request.rows)) {
    explicitRows = request.rows;
  } else if (Array.isArray(details.rows)) {
    explicitRows = details.rows;
  }
  const rows = [
    ...explicitRows
      .filter((row) => row && typeof row === 'object')
      .map((row) => [row.label, row.value]),
    ['Amount', details.amount],
    ['Asset', details.asset],
    ['Network', details.network],
    ['Pay to', details.payTo],
    ['Resource', details.resource],
    ['Method', details.method || request.method],
    ['Account', details.account],
    ['To', details.to],
    ['Value', details.value],
    ['Chain', details.chainId || details.chain],
  ]
    .map(([label, value]) => ({
      label: safeString(label, 80),
      value: safeString(value, 500),
    }))
    .filter((row) => row.label && row.value);

  return {
    title: safeString(request.title || context.title, 120) || 'Unlock Vault',
    heading: safeString(request.heading || context.heading, 160) || getDefaultHeading(request),
    origin,
    reason: safeString(request.reason, 500),
    rows,
  };
}

function removeHandlerSafe(electronIpcMain, channel) {
  if (!electronIpcMain || typeof electronIpcMain.removeHandler !== 'function') {
    return;
  }
  try {
    electronIpcMain.removeHandler(channel);
  } catch {
    // Best-effort cleanup; older Electron builds may throw if the handler
    // was already removed during a close/error race.
  }
}

function senderMatchesPrompt(event, promptWindow) {
  return Boolean(
    event &&
      promptWindow &&
      event.sender &&
      promptWindow.webContents &&
      event.sender === promptWindow.webContents
  );
}

function presentationUnavailable(message) {
  return {
    ok: false,
    error: {
      code: 'TRUSTED_VAULT_UNLOCK_PRESENTATION_UNAVAILABLE',
      message,
    },
  };
}

function presentTrustedVaultUnlockPrompt(request = {}, context = {}, deps = {}) {
  const ElectronBrowserWindow = deps.BrowserWindow || BrowserWindow;
  const electronIpcMain = deps.ipcMain || ipcMain;
  const unlockVault = deps.unlockVault || identityManager.unlockVault;

  if (typeof ElectronBrowserWindow !== 'function') {
    return Promise.resolve(
      presentationUnavailable('Trusted vault unlock window is unavailable')
    );
  }
  if (!electronIpcMain || typeof electronIpcMain.handle !== 'function') {
    return Promise.resolve(
      presentationUnavailable('Trusted vault unlock IPC is unavailable')
    );
  }
  if (typeof unlockVault !== 'function') {
    return Promise.resolve(
      presentationUnavailable('Vault unlock service is unavailable')
    );
  }

  const requestId = createRequestId(request);
  const contextPayload = buildPromptContext(request, context);
  const contextChannel = channelFor('context', requestId);
  const submitChannel = channelFor('submit', requestId);
  const cancelChannel = channelFor('cancel', requestId);
  const preload = path.join(__dirname, 'trusted-vault-unlock-preload.js');
  const promptHtml = path.join(__dirname, 'trusted-vault-unlock.html');
  const ownerWindow = context.ownerWindow || null;

  return new Promise((resolve) => {
    let settled = false;
    let promptWindow = null;

    const cleanup = () => {
      removeHandlerSafe(electronIpcMain, contextChannel);
      removeHandlerSafe(electronIpcMain, submitChannel);
      removeHandlerSafe(electronIpcMain, cancelChannel);
    };

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const windowToClose = promptWindow;
      promptWindow = null;
      if (
        windowToClose &&
        typeof windowToClose.isDestroyed === 'function' &&
        !windowToClose.isDestroyed()
      ) {
        try {
          windowToClose.close();
        } catch {
          // The prompt result is already decided; closing failures should not
          // leak into the caller or package chrome.
        }
      }
      resolve(result);
    };

    try {
      promptWindow = new ElectronBrowserWindow({
        width: PROMPT_WIDTH,
        height: PROMPT_HEIGHT,
        title: 'Freedom Vault Unlock',
        show: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        autoHideMenuBar: true,
        backgroundColor: '#f8f7f3',
        ...(ownerWindow ? { parent: ownerWindow, modal: true } : {}),
        webPreferences: {
          preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
    } catch (err) {
      settle({
        ok: false,
        error: {
          code: 'TRUSTED_VAULT_UNLOCK_WINDOW_FAILED',
          message: err?.message || 'Failed to create trusted vault unlock window',
        },
      });
      return;
    }

    electronIpcMain.handle(contextChannel, (event) => {
      if (!senderMatchesPrompt(event, promptWindow)) {
        return {
          ok: false,
          error: {
            code: 'TRUSTED_VAULT_UNLOCK_SENDER_MISMATCH',
            message: 'Ignoring vault unlock context request from an unexpected sender',
          },
        };
      }
      return { ok: true, context: contextPayload };
    });

    electronIpcMain.handle(submitChannel, async (event, password) => {
      if (!senderMatchesPrompt(event, promptWindow)) {
        return {
          ok: false,
          error: {
            code: 'TRUSTED_VAULT_UNLOCK_SENDER_MISMATCH',
            message: 'Ignoring vault unlock request from an unexpected sender',
          },
        };
      }
      const normalizedPassword = typeof password === 'string' ? password : '';
      if (!normalizedPassword) {
        return {
          ok: false,
          error: {
            code: 'TRUSTED_VAULT_UNLOCK_PASSWORD_REQUIRED',
            message: 'Enter your vault password.',
          },
        };
      }
      try {
        await unlockVault(normalizedPassword);
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'TRUSTED_VAULT_UNLOCK_FAILED',
            message: err?.message || 'Vault unlock failed.',
          },
        };
      }

      const result = { ok: true, outcome: 'accepted', response: 0 };
      setImmediate(() => settle(result));
      return { ok: true };
    });

    electronIpcMain.handle(cancelChannel, (event) => {
      if (!senderMatchesPrompt(event, promptWindow)) {
        return {
          ok: false,
          error: {
            code: 'TRUSTED_VAULT_UNLOCK_SENDER_MISMATCH',
            message: 'Ignoring vault unlock cancellation from an unexpected sender',
          },
        };
      }
      const result = { ok: true, outcome: 'rejected', response: 1 };
      setImmediate(() => settle(result));
      return { ok: true };
    });

    promptWindow.once('closed', () => {
      settle({ ok: true, outcome: 'rejected', response: 1 });
    });
    promptWindow.once('ready-to-show', () => {
      if (promptWindow && typeof promptWindow.show === 'function') {
        promptWindow.show();
      }
    });

    promptWindow.loadFile(promptHtml, { query: { requestId } }).catch((err) => {
      settle({
        ok: false,
        error: {
          code: 'TRUSTED_VAULT_UNLOCK_LOAD_FAILED',
          message: err?.message || 'Failed to load trusted vault unlock prompt',
        },
      });
    });
  });
}

module.exports = {
  buildPromptContext,
  channelFor,
  presentTrustedVaultUnlockPrompt,
};
