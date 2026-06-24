const crypto = require('crypto');
const path = require('path');

const { BrowserWindow, ipcMain } = require('electron');

const CHANNEL_PREFIX = 'trusted-swarm-approval';
const PROMPT_WIDTH = 560;
const PROMPT_HEIGHT = 520;
const RENDERED_BY = 'trusted-swarm-approval-window';
const PRESENTATION = 'trusted-window';

function createRequestId(request = {}) {
  if (typeof request.requestId === 'string' && request.requestId.trim()) {
    return request.requestId.trim();
  }
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `swarm-approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
  const rowLabel = safeString(label, 80);
  const rowValue = safeString(value, maxLength);
  if (rowLabel && rowValue) {
    rows.push({ label: rowLabel, value: rowValue });
  }
}

function labelsForKind(kind) {
  if (kind === 'swarm.publish') {
    return {
      title: 'Freedom Swarm Publish',
      heading: 'Review Swarm publish',
      summaryAction: 'requested to publish to Swarm',
      acceptLabel: 'Publish',
      notice: 'Publish only if the target, size, and site match what you intended.',
    };
  }
  if (kind === 'swarm.feed') {
    return {
      title: 'Freedom Swarm Feed',
      heading: 'Review Swarm feed request',
      summaryAction: 'requested a Swarm feed operation',
      acceptLabel: 'Allow',
      notice: 'Allow only if the feed operation and site match what you intended.',
    };
  }
  if (kind === 'swarm.signing') {
    return {
      title: 'Freedom Swarm Publisher Signing',
      heading: 'Review Swarm publisher signing',
      summaryAction: 'requested Swarm publisher signing',
      acceptLabel: 'Allow',
      notice: 'Allow only if this signing request matches what you intended.',
    };
  }
  return {
    title: 'Freedom Swarm Connection',
    heading: 'Review Swarm connection',
    summaryAction: 'requested Swarm publishing access',
    acceptLabel: 'Allow',
    notice: 'Allow only if you want this site to publish through the Swarm provider.',
  };
}

function buildPromptContext(request = {}, context = {}) {
  const kind = safeString(request.kind, 80) || 'swarm.connect';
  const method = safeString(request.method, 120);
  const details = request.details && typeof request.details === 'object'
    ? request.details
    : {};
  const labels = labelsForKind(kind);
  const origin = safeString(request.origin || context.origin || 'Unknown site', 300);
  const rows = [];

  addRow(rows, 'Method', method);
  addRow(rows, 'Target', details.target);
  addRow(rows, 'Action', details.action);
  addRow(rows, 'Content type', details.contentType);
  addRow(rows, 'Name', details.name);
  addRow(rows, 'Files', details.fileCount);
  addRow(rows, 'Size', Number.isFinite(details.sizeBytes) ? `${details.sizeBytes} bytes` : null);
  addRow(rows, 'Span', details.span);
  addRow(rows, 'Index document', details.indexDocument);
  addRow(rows, 'Feed', details.feedName);
  addRow(rows, 'Reference', details.reference);
  addRow(rows, 'Current reference', details.currentReference);
  addRow(rows, 'Manifest', details.manifestReference);
  addRow(rows, 'Owner', details.feedOwner);
  addRow(rows, 'Feed identity', details.feedIdentityId);
  addRow(rows, 'Index', Number.isInteger(details.index) ? details.index : null);
  addRow(rows, 'Payload preview', details.payloadPreview, 220);
  addRow(rows, 'Identity', details.identityMode);
  addRow(rows, 'Identifier', details.identifier);

  return {
    title: safeString(request.title || context.title, 120) || labels.title,
    heading: safeString(request.heading || context.heading, 160) || labels.heading,
    origin,
    summary: origin
      ? `${origin} ${labels.summaryAction}.`
      : `A site ${labels.summaryAction}.`,
    reason: safeString(request.reason, 500),
    rows,
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
      code: 'TRUSTED_SWARM_APPROVAL_PRESENTATION_UNAVAILABLE',
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

function resultForDecision(action) {
  if (action === 'accept') {
    return trustedPresentationResult({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
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
      code: 'TRUSTED_SWARM_APPROVAL_DECISION_INVALID',
      message: 'Unsupported Swarm approval decision.',
    },
  };
}

function presentTrustedSwarmApprovalPrompt(request = {}, context = {}, deps = {}) {
  const ElectronBrowserWindow = deps.BrowserWindow || BrowserWindow;
  const electronIpcMain = deps.ipcMain || ipcMain;

  if (typeof ElectronBrowserWindow !== 'function') {
    return Promise.resolve(
      presentationUnavailable('Trusted Swarm approval window is unavailable')
    );
  }
  if (!electronIpcMain || typeof electronIpcMain.handle !== 'function') {
    return Promise.resolve(
      presentationUnavailable('Trusted Swarm approval IPC is unavailable')
    );
  }

  const requestId = createRequestId(request);
  const contextPayload = buildPromptContext(request, context);
  const contextChannel = channelFor('context', requestId);
  const decisionChannel = channelFor('decision', requestId);
  const preload = path.join(__dirname, 'trusted-swarm-approval-preload.js');
  const promptHtml = path.join(__dirname, 'trusted-swarm-approval.html');
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
        title: 'Freedom Swarm Approval',
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
          code: 'TRUSTED_SWARM_APPROVAL_WINDOW_FAILED',
          message: err?.message || 'Failed to create trusted Swarm approval window',
        },
      }));
      return;
    }

    electronIpcMain.handle(contextChannel, (event) => {
      if (!senderMatchesPrompt(event, promptWindow)) {
        return {
          ok: false,
          error: {
            code: 'TRUSTED_SWARM_APPROVAL_SENDER_MISMATCH',
            message: 'Ignoring Swarm approval context request from an unexpected sender',
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
            code: 'TRUSTED_SWARM_APPROVAL_SENDER_MISMATCH',
            message: 'Ignoring Swarm approval decision from an unexpected sender',
          },
        };
      }
      const action = typeof payload?.action === 'string' ? payload.action : '';
      const result = resultForDecision(action);
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
          code: 'TRUSTED_SWARM_APPROVAL_LOAD_FAILED',
          message: err?.message || 'Failed to load trusted Swarm approval prompt',
        },
      }));
    });
  });
}

module.exports = {
  buildPromptContext,
  channelFor,
  presentTrustedSwarmApprovalPrompt,
};
