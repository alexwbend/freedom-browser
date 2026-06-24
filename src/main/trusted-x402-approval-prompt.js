const crypto = require('crypto');
const path = require('path');

const { BrowserWindow, ipcMain } = require('electron');

const CHANNEL_PREFIX = 'trusted-x402-approval';
const PROMPT_WIDTH = 520;
const PROMPT_HEIGHT = 460;
const RENDERED_BY = 'trusted-x402-approval-window';
const PRESENTATION = 'trusted-window';

function createRequestId(request = {}) {
  if (typeof request.requestId === 'string' && request.requestId.trim()) {
    return request.requestId.trim();
  }
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `x402-approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function normalizeGrant(grant) {
  if (!grant || typeof grant !== 'object') {
    return null;
  }
  const capAmount = typeof grant.capAmount === 'string' ? grant.capAmount.trim() : '';
  const windowSeconds = Number(grant.windowSeconds);
  const selectedAcceptIndex = Number(grant.selectedAcceptIndex);
  const label = safeString(grant.label, 120);
  if (!/^\d+$/.test(capAmount) || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return null;
  }
  return {
    capAmount,
    windowSeconds,
    selectedAcceptIndex: Number.isInteger(selectedAcceptIndex) ? selectedAcceptIndex : 0,
    label: label || 'bounded payment cap',
  };
}

function buildPromptContext(request = {}, context = {}) {
  const details = request.details && typeof request.details === 'object'
    ? request.details
    : {};
  const defaultGrant = normalizeGrant(details.defaultGrant);
  const rows = [
    ['Amount', details.amount],
    ['Asset', details.asset],
    ['Network', details.network],
    ['Pay to', details.payTo],
    ['Resource', details.resource],
  ]
    .map(([label, value]) => ({
      label: safeString(label, 80),
      value: safeString(value, 500),
    }))
    .filter((row) => row.label && row.value);

  return {
    title: safeString(request.title || context.title, 120) || 'Freedom x402 Payment',
    heading: safeString(request.heading || context.heading, 160) || 'Review x402 payment',
    origin: safeString(request.origin || context.origin || 'Unknown site', 300),
    reason: safeString(request.reason, 500),
    rows,
    actions: {
      payOnceLabel: 'Pay once',
      rejectLabel: 'Reject',
      ...(defaultGrant ? { allowLabel: `Pay and allow ${defaultGrant.label}` } : {}),
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
      code: 'TRUSTED_X402_APPROVAL_PRESENTATION_UNAVAILABLE',
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

function resultForDecision(action, defaultGrant) {
  if (action === 'reject') {
    return trustedPresentationResult({
      ok: true,
      outcome: 'rejected',
      response: defaultGrant ? 2 : 1,
    });
  }
  if (action === 'pay-once') {
    return trustedPresentationResult({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
  }
  if (action === 'allow') {
    if (!defaultGrant) {
      return {
        ok: false,
        error: {
          code: 'TRUSTED_X402_APPROVAL_DECISION_INVALID',
          message: 'This payment request does not include a bounded cap option.',
        },
      };
    }
    return trustedPresentationResult({
      ok: true,
      outcome: 'accepted',
      response: 1,
      grant: {
        capAmount: defaultGrant.capAmount,
        windowSeconds: defaultGrant.windowSeconds,
      },
      selectedAcceptIndex: defaultGrant.selectedAcceptIndex,
    });
  }
  return {
    ok: false,
    error: {
      code: 'TRUSTED_X402_APPROVAL_DECISION_INVALID',
      message: 'Unsupported x402 approval decision.',
    },
  };
}

function presentTrustedX402ApprovalPrompt(request = {}, context = {}, deps = {}) {
  const ElectronBrowserWindow = deps.BrowserWindow || BrowserWindow;
  const electronIpcMain = deps.ipcMain || ipcMain;

  if (typeof ElectronBrowserWindow !== 'function') {
    return Promise.resolve(
      presentationUnavailable('Trusted x402 approval window is unavailable')
    );
  }
  if (!electronIpcMain || typeof electronIpcMain.handle !== 'function') {
    return Promise.resolve(
      presentationUnavailable('Trusted x402 approval IPC is unavailable')
    );
  }

  const requestId = createRequestId(request);
  const contextPayload = buildPromptContext(request, context);
  const defaultGrant = normalizeGrant(request.details?.defaultGrant);
  const contextChannel = channelFor('context', requestId);
  const decisionChannel = channelFor('decision', requestId);
  const preload = path.join(__dirname, 'trusted-x402-approval-preload.js');
  const promptHtml = path.join(__dirname, 'trusted-x402-approval.html');
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
        title: 'Freedom x402 Payment',
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
          code: 'TRUSTED_X402_APPROVAL_WINDOW_FAILED',
          message: err?.message || 'Failed to create trusted x402 approval window',
        },
      }));
      return;
    }

    electronIpcMain.handle(contextChannel, (event) => {
      if (!senderMatchesPrompt(event, promptWindow)) {
        return {
          ok: false,
          error: {
            code: 'TRUSTED_X402_APPROVAL_SENDER_MISMATCH',
            message: 'Ignoring x402 approval context request from an unexpected sender',
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
            code: 'TRUSTED_X402_APPROVAL_SENDER_MISMATCH',
            message: 'Ignoring x402 approval decision from an unexpected sender',
          },
        };
      }
      const action = typeof payload?.action === 'string' ? payload.action : '';
      const result = resultForDecision(action, defaultGrant);
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
        response: defaultGrant ? 2 : 1,
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
          code: 'TRUSTED_X402_APPROVAL_LOAD_FAILED',
          message: err?.message || 'Failed to load trusted x402 approval prompt',
        },
      }));
    });
  });
}

module.exports = {
  buildPromptContext,
  channelFor,
  presentTrustedX402ApprovalPrompt,
};
