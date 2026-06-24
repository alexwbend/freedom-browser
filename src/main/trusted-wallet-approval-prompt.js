const crypto = require('crypto');
const path = require('path');

const { BrowserWindow, ipcMain } = require('electron');

const CHANNEL_PREFIX = 'trusted-wallet-approval';
const PROMPT_WIDTH = 540;
const PROMPT_HEIGHT = 500;
const RENDERED_BY = 'trusted-wallet-approval-window';
const PRESENTATION = 'trusted-window';

function createRequestId(request = {}) {
  if (typeof request.requestId === 'string' && request.requestId.trim()) {
    return request.requestId.trim();
  }
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `wallet-approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function addRow(rows, label, value, maxLength) {
  const safeLabel = safeString(label, 80);
  const safeValue = safeString(value, maxLength);
  if (safeLabel && safeValue) {
    rows.push({ label: safeLabel, value: safeValue });
  }
}

function normalizeWalletIndex(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const index = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function normalizeAccountChoices(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const choices = [];
  value.forEach((choice) => {
    if (!choice || typeof choice !== 'object') {
      return;
    }
    const walletIndex = normalizeWalletIndex(choice.walletIndex ?? choice.index);
    const account = safeString(choice.account || choice.address, 120);
    if (walletIndex === null || !account) {
      return;
    }
    choices.push({
      walletIndex,
      account,
      name: safeString(choice.name, 80) || `Wallet ${walletIndex}`,
      active: choice.active === true,
    });
  });
  return choices;
}

function labelsForKind(kind) {
  if (kind === 'wallet.transaction') {
    return {
      title: 'Freedom Wallet Transaction',
      heading: 'Review wallet transaction',
      summaryAction: 'requested a wallet transaction',
      acceptLabel: 'Send',
      notice: 'Send only if the account, recipient, value, and site match what you intended.',
    };
  }
  if (kind === 'wallet.signature') {
    return {
      title: 'Freedom Wallet Signature',
      heading: 'Review wallet signature',
      summaryAction: 'requested wallet signing',
      acceptLabel: 'Sign',
      notice: 'Sign only if the account, method, message, and site match what you intended.',
    };
  }
  return {
    title: 'Freedom Wallet Connection',
    heading: 'Review wallet connection',
    summaryAction: 'requested wallet account access',
    acceptLabel: 'Connect',
    notice: 'Connect only if you want to share this wallet account with the site.',
  };
}

function buildPromptContext(request = {}, context = {}) {
  const kind = safeString(request.kind, 80) || 'wallet.connect';
  const method = safeString(request.method, 120);
  const details = request.details && typeof request.details === 'object'
    ? request.details
    : {};
  const labels = labelsForKind(kind);
  const origin = safeString(request.origin || context.origin || 'Unknown site', 300);
  const rows = [];
  const accountChoices = normalizeAccountChoices(details.accountChoices || details.accounts);

  addRow(rows, 'Method', method);
  addRow(rows, 'Account', details.account || details.activeAccount);
  addRow(rows, 'Requested account', details.requestedAccount);
  addRow(rows, 'Wallet index', details.walletIndex);
  addRow(rows, 'Chain', details.chainId);
  addRow(rows, 'To', details.to);
  addRow(rows, 'Value', details.value);
  addRow(rows, 'Message', details.messagePreview, 500);
  addRow(rows, 'Typed data', details.typedDataPreview, 500);
  addRow(rows, 'Payload size', details.payloadSize);

  return {
    title: safeString(request.title || context.title, 120) || labels.title,
    heading: safeString(request.heading || context.heading, 160) || labels.heading,
    origin,
    summary: origin
      ? `${origin} ${labels.summaryAction}.`
      : `A site ${labels.summaryAction}.`,
    reason: safeString(request.reason, 500),
    rows,
    accountChoices,
    notice: labels.notice,
    actions: {
      acceptLabel: labels.acceptLabel,
      rejectLabel: 'Reject',
    },
  };
}

function removeHandlerSafe(electronIpcMain, channel) {
  if (!electronIpcMain || typeof electronIpcMain.removeHandler !== 'function') {
    return;
  }
  try {
    electronIpcMain.removeHandler(channel);
  } catch {
    // Best-effort cleanup during close/load races.
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
    renderedBy: RENDERED_BY,
    presentation: PRESENTATION,
    error: {
      code: 'TRUSTED_WALLET_APPROVAL_PRESENTATION_UNAVAILABLE',
      message,
    },
  };
}

function trustedPresentationResult(result) {
  return {
    renderedBy: RENDERED_BY,
    presentation: PRESENTATION,
    source: RENDERED_BY,
    ...result,
  };
}

function resultForDecision(action, payload = {}, contextPayload = {}) {
  if (action === 'accept') {
    const result = trustedPresentationResult({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
    const selectedWalletIndex = normalizeWalletIndex(payload.selectedWalletIndex);
    const choices = Array.isArray(contextPayload.accountChoices)
      ? contextPayload.accountChoices
      : [];
    const matchedChoice = choices.find((choice) => choice.walletIndex === selectedWalletIndex);
    if (matchedChoice) {
      result.selectedWalletIndex = matchedChoice.walletIndex;
      result.selectedAccount = matchedChoice.account;
    }
    return result;
  }
  if (action === 'reject') {
    return trustedPresentationResult({
      ok: true,
      outcome: 'rejected',
      response: 1,
    });
  }
  return {
    ok: false,
    error: {
      code: 'TRUSTED_WALLET_APPROVAL_DECISION_INVALID',
      message: 'Unsupported wallet approval decision.',
    },
  };
}

function presentTrustedWalletApprovalPrompt(request = {}, context = {}, deps = {}) {
  const ElectronBrowserWindow = deps.BrowserWindow || BrowserWindow;
  const electronIpcMain = deps.ipcMain || ipcMain;

  if (typeof ElectronBrowserWindow !== 'function') {
    return Promise.resolve(
      presentationUnavailable('Trusted wallet approval window is unavailable')
    );
  }
  if (!electronIpcMain || typeof electronIpcMain.handle !== 'function') {
    return Promise.resolve(
      presentationUnavailable('Trusted wallet approval IPC is unavailable')
    );
  }

  const requestId = createRequestId(request);
  const contextPayload = buildPromptContext(request, context);
  const contextChannel = channelFor('context', requestId);
  const decisionChannel = channelFor('decision', requestId);
  const preload = path.join(__dirname, 'trusted-wallet-approval-preload.js');
  const promptHtml = path.join(__dirname, 'trusted-wallet-approval.html');
  const ownerWindow = context.ownerWindow || null;

  return new Promise((resolve) => {
    let settled = false;
    let promptWindow = null;

    const cleanup = () => {
      removeHandlerSafe(electronIpcMain, contextChannel);
      removeHandlerSafe(electronIpcMain, decisionChannel);
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
          // The approval result is already decided.
        }
      }
      resolve(result);
    };

    try {
      promptWindow = new ElectronBrowserWindow({
        width: PROMPT_WIDTH,
        height: PROMPT_HEIGHT,
        title: 'Freedom Wallet Approval',
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
      settle(trustedPresentationResult({
        ok: false,
        error: {
          code: 'TRUSTED_WALLET_APPROVAL_WINDOW_FAILED',
          message: err?.message || 'Failed to create trusted wallet approval window',
        },
      }));
      return;
    }

    electronIpcMain.handle(contextChannel, (event) => {
      if (!senderMatchesPrompt(event, promptWindow)) {
        return {
          ok: false,
          error: {
            code: 'TRUSTED_WALLET_APPROVAL_SENDER_MISMATCH',
            message: 'Ignoring wallet approval context request from an unexpected sender',
          },
        };
      }
      return { ok: true, context: contextPayload };
    });

    electronIpcMain.handle(decisionChannel, (event, payload = {}) => {
      if (!senderMatchesPrompt(event, promptWindow)) {
        return {
          ok: false,
          error: {
            code: 'TRUSTED_WALLET_APPROVAL_SENDER_MISMATCH',
            message: 'Ignoring wallet approval decision from an unexpected sender',
          },
        };
      }
      const action = typeof payload?.action === 'string' ? payload.action : '';
      const result = resultForDecision(action, payload, contextPayload);
      if (result?.ok !== true) {
        return result;
      }
      setImmediate(() => settle(result));
      return { ok: true };
    });

    promptWindow.once('closed', () => {
      settle(trustedPresentationResult({
        ok: true,
        outcome: 'rejected',
        response: 1,
      }));
    });
    promptWindow.once('ready-to-show', () => {
      if (promptWindow && typeof promptWindow.show === 'function') {
        promptWindow.show();
      }
    });

    promptWindow.loadFile(promptHtml, { query: { requestId } }).catch((err) => {
      settle(trustedPresentationResult({
        ok: false,
        error: {
          code: 'TRUSTED_WALLET_APPROVAL_LOAD_FAILED',
          message: err?.message || 'Failed to load trusted wallet approval prompt',
        },
      }));
    });
  });
}

module.exports = {
  buildPromptContext,
  channelFor,
  normalizeAccountChoices,
  presentTrustedWalletApprovalPrompt,
};
