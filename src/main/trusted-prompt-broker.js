const TRUSTED_PROMPT_KINDS = Object.freeze({
  TEST_CONFIRMATION: 'test.confirmation',
  WALLET_CONNECT: 'wallet.connect',
  SWARM_PUBLISH: 'swarm.publish',
});
const TRUSTED_PROMPT_PRESENTATIONS = Object.freeze({
  SYNTHETIC: 'synthetic',
  NATIVE_DIALOG: 'native-dialog',
});

function cloneSerializable(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function describeCaller(caller = null) {
  if (!caller) {
    return null;
  }

  return {
    runtimeMode: caller.runtimeMode,
    source: caller.source,
    packageId: caller.packageId,
    packageType: caller.packageType,
    name: caller.name,
    version: caller.version,
  };
}

function normalizeReason(reason) {
  if (typeof reason !== 'string') {
    return '';
  }
  return reason.trim().slice(0, 200);
}

function normalizePresentation(presentation) {
  return presentation === TRUSTED_PROMPT_PRESENTATIONS.NATIVE_DIALOG
    ? TRUSTED_PROMPT_PRESENTATIONS.NATIVE_DIALOG
    : TRUSTED_PROMPT_PRESENTATIONS.SYNTHETIC;
}

function describeTrustedContext(context = {}) {
  const trustedContext = {
    source: 'main',
    caller: describeCaller(context.caller),
    origin: context.origin || null,
    tabId: Number.isInteger(context.tabId) ? context.tabId : null,
  };
  if (Number.isInteger(context.webContentsId)) {
    trustedContext.webContentsId = context.webContentsId;
  }
  return trustedContext;
}

function describeNativeDialogResult(presentationResult = {}) {
  return {
    outcome: presentationResult.outcome || 'accepted',
    source: 'shell-native-dialog',
    response: Number.isInteger(presentationResult.response) ? presentationResult.response : null,
  };
}

function createTrustedPromptBroker(options = {}) {
  const createRequestId =
    options.createRequestId ||
    (() => `trusted-prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const defaultPresentNativeDialog = options.presentNativeDialog || null;

  async function requestTestPrompt(payload = {}, context = {}) {
    const kind = typeof payload?.kind === 'string' ? payload.kind : '';
    if (kind !== TRUSTED_PROMPT_KINDS.TEST_CONFIRMATION) {
      return {
        ok: false,
        error: {
          code: 'TRUSTED_PROMPT_UNSUPPORTED',
          message: 'Unsupported trusted prompt kind',
        },
      };
    }

    const reason = normalizeReason(payload.reason);
    const presentation = normalizePresentation(payload.presentation);
    const requestId = createRequestId();
    if (presentation === TRUSTED_PROMPT_PRESENTATIONS.NATIVE_DIALOG) {
      const presentNativeDialog = context.presentNativeDialog || defaultPresentNativeDialog;
      if (typeof presentNativeDialog !== 'function') {
        return {
          ok: false,
          error: {
            code: 'TRUSTED_PROMPT_PRESENTATION_UNAVAILABLE',
            message: 'Native trusted prompt presentation is unavailable',
          },
        };
      }
      const presentationResult = await presentNativeDialog(
        {
          requestId,
          kind,
          reason,
        },
        context
      );
      if (presentationResult?.ok !== true) {
        return {
          ok: false,
          requestId,
          kind,
          trusted: true,
          surfaceOwner: 'shell',
          renderedBy: 'shell-native-dialog',
          error: presentationResult?.error || {
            code: 'TRUSTED_PROMPT_PRESENTATION_FAILED',
            message: 'Native trusted prompt presentation failed',
          },
        };
      }
      return {
        ok: true,
        requestId,
        kind,
        trusted: true,
        surfaceOwner: 'shell',
        renderedBy: 'shell-native-dialog',
        context: describeTrustedContext(context),
        request: {
          reason,
          presentation,
        },
        result: describeNativeDialogResult(presentationResult),
      };
    }

    return {
      ok: true,
      requestId,
      kind,
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'trusted-prompt-broker',
      context: describeTrustedContext(context),
      request: {
        reason,
      },
      result: {
        outcome: 'accepted',
        source: 'test-only-broker',
      },
    };
  }

  async function requestWalletConnectPrompt(payload = {}, context = {}) {
    const method = typeof payload?.method === 'string' ? payload.method : '';
    if (method !== 'eth_requestAccounts') {
      return {
        ok: false,
        error: {
          code: 'TRUSTED_PROMPT_UNSUPPORTED',
          message: 'Unsupported wallet trusted prompt method',
        },
      };
    }

    const requestId = createRequestId();
    const reason =
      normalizeReason(payload.reason) ||
      `Wallet connection request from ${context.origin || 'unknown origin'}`;
    const presentNativeDialog = context.presentNativeDialog || defaultPresentNativeDialog;
    if (typeof presentNativeDialog !== 'function') {
      return {
        ok: false,
        error: {
          code: 'TRUSTED_PROMPT_PRESENTATION_UNAVAILABLE',
          message: 'Native trusted prompt presentation is unavailable',
        },
      };
    }

    const presentationResult = await presentNativeDialog(
      {
        requestId,
        kind: TRUSTED_PROMPT_KINDS.WALLET_CONNECT,
        method,
        reason,
        origin: context.origin || null,
        webContentsId: Number.isInteger(context.webContentsId) ? context.webContentsId : null,
      },
      context
    );
    if (presentationResult?.ok !== true) {
      return {
        ok: false,
        requestId,
        kind: TRUSTED_PROMPT_KINDS.WALLET_CONNECT,
        trusted: true,
        surfaceOwner: 'shell',
        renderedBy: 'shell-native-dialog',
        error: presentationResult?.error || {
          code: 'TRUSTED_PROMPT_PRESENTATION_FAILED',
          message: 'Native trusted prompt presentation failed',
        },
      };
    }

    return {
      ok: true,
      requestId,
      kind: TRUSTED_PROMPT_KINDS.WALLET_CONNECT,
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'shell-native-dialog',
      context: describeTrustedContext(context),
      request: {
        method,
        reason,
        presentation: TRUSTED_PROMPT_PRESENTATIONS.NATIVE_DIALOG,
      },
      result: describeNativeDialogResult({
        ...presentationResult,
        outcome: presentationResult.outcome || 'rejected',
      }),
    };
  }

  async function requestSwarmPublishPrompt(payload = {}, context = {}) {
    const method = typeof payload?.method === 'string' ? payload.method : '';
    if (method !== 'swarm_publishData') {
      return {
        ok: false,
        error: {
          code: 'TRUSTED_PROMPT_UNSUPPORTED',
          message: 'Unsupported Swarm trusted prompt method',
        },
      };
    }

    const requestId = createRequestId();
    const reason =
      normalizeReason(payload.reason) ||
      `Swarm publish request from ${context.origin || 'unknown origin'}`;
    const presentNativeDialog = context.presentNativeDialog || defaultPresentNativeDialog;
    if (typeof presentNativeDialog !== 'function') {
      return {
        ok: false,
        error: {
          code: 'TRUSTED_PROMPT_PRESENTATION_UNAVAILABLE',
          message: 'Native trusted prompt presentation is unavailable',
        },
      };
    }

    const presentationResult = await presentNativeDialog(
      {
        requestId,
        kind: TRUSTED_PROMPT_KINDS.SWARM_PUBLISH,
        method,
        reason,
        origin: context.origin || null,
        webContentsId: Number.isInteger(context.webContentsId) ? context.webContentsId : null,
      },
      context
    );
    if (presentationResult?.ok !== true) {
      return {
        ok: false,
        requestId,
        kind: TRUSTED_PROMPT_KINDS.SWARM_PUBLISH,
        trusted: true,
        surfaceOwner: 'shell',
        renderedBy: 'shell-native-dialog',
        error: presentationResult?.error || {
          code: 'TRUSTED_PROMPT_PRESENTATION_FAILED',
          message: 'Native trusted prompt presentation failed',
        },
      };
    }

    return {
      ok: true,
      requestId,
      kind: TRUSTED_PROMPT_KINDS.SWARM_PUBLISH,
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'shell-native-dialog',
      context: describeTrustedContext(context),
      request: {
        method,
        reason,
        presentation: TRUSTED_PROMPT_PRESENTATIONS.NATIVE_DIALOG,
      },
      result: describeNativeDialogResult({
        ...presentationResult,
        outcome: presentationResult.outcome || 'rejected',
      }),
    };
  }

  return Object.freeze({
    requestTestPrompt: async (payload, context) =>
      cloneSerializable(await requestTestPrompt(payload, context)),
    requestWalletConnectPrompt: async (payload, context) =>
      cloneSerializable(await requestWalletConnectPrompt(payload, context)),
    requestSwarmPublishPrompt: async (payload, context) =>
      cloneSerializable(await requestSwarmPublishPrompt(payload, context)),
  });
}

const defaultTrustedPromptBroker = createTrustedPromptBroker();

module.exports = {
  TRUSTED_PROMPT_KINDS,
  TRUSTED_PROMPT_PRESENTATIONS,
  createTrustedPromptBroker,
  defaultTrustedPromptBroker,
};
