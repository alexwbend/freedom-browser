const TRUSTED_PROMPT_KINDS = Object.freeze({
  TEST_CONFIRMATION: 'test.confirmation',
  WALLET_CONNECT: 'wallet.connect',
  WALLET_TRANSACTION: 'wallet.transaction',
  WALLET_SIGNATURE: 'wallet.signature',
  X402_APPROVAL: 'x402.approval',
  X402_VAULT_UNLOCK: 'x402.vaultUnlock',
  SWARM_CONNECT: 'swarm.connect',
  SWARM_PUBLISH: 'swarm.publish',
  SWARM_FEED: 'swarm.feed',
});
const TRUSTED_PROMPT_PRESENTATIONS = Object.freeze({
  SYNTHETIC: 'synthetic',
  NATIVE_DIALOG: 'native-dialog',
});
const WALLET_CONNECT_METHODS = new Set(['eth_requestAccounts']);
const WALLET_TRANSACTION_METHODS = new Set(['eth_sendTransaction']);
const WALLET_SIGNATURE_METHODS = new Set([
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
]);
const X402_APPROVAL_METHODS = new Set(['x402_approval']);
const X402_VAULT_UNLOCK_METHODS = new Set(['x402_vaultUnlock']);
const SWARM_CONNECT_METHODS = new Set(['swarm_requestAccess']);
const SWARM_PUBLISH_METHODS = new Set(['swarm_publishData', 'swarm_publishFiles']);
const SWARM_FEED_METHODS = new Set(['swarm_createFeed', 'swarm_updateFeed', 'swarm_writeFeedEntry']);

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

function unsupportedPrompt(message) {
  return {
    ok: false,
    error: {
      code: 'TRUSTED_PROMPT_UNSUPPORTED',
      message,
    },
  };
}

async function requestNativeProviderPrompt({
  payload,
  context,
  createRequestId,
  defaultPresentNativeDialog,
  kind,
  supportedMethods,
  unsupportedMessage,
  defaultReason,
}) {
  const method = typeof payload?.method === 'string' ? payload.method : '';
  if (!supportedMethods.has(method)) {
    return unsupportedPrompt(unsupportedMessage);
  }

  const requestId = createRequestId();
  const reason = normalizeReason(payload.reason) || defaultReason(context);
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

  const details = cloneSerializable(payload.details || null);
  const nativeRequest = {
    requestId,
    kind,
    method,
    reason,
    origin: context.origin || null,
    webContentsId: Number.isInteger(context.webContentsId) ? context.webContentsId : null,
  };
  if (details) {
    nativeRequest.details = details;
  }
  const presentationResult = await presentNativeDialog(nativeRequest, context);
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

  const request = {
    method,
    reason,
    presentation: TRUSTED_PROMPT_PRESENTATIONS.NATIVE_DIALOG,
  };
  if (details) {
    request.details = details;
  }

  return {
    ok: true,
    requestId,
    kind,
    trusted: true,
    surfaceOwner: 'shell',
    renderedBy: 'shell-native-dialog',
    context: describeTrustedContext(context),
    request,
    result: describeNativeDialogResult({
      ...presentationResult,
      outcome: presentationResult.outcome || 'rejected',
    }),
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
    return requestNativeProviderPrompt({
      payload,
      context,
      createRequestId,
      defaultPresentNativeDialog,
      kind: TRUSTED_PROMPT_KINDS.WALLET_CONNECT,
      supportedMethods: WALLET_CONNECT_METHODS,
      unsupportedMessage: 'Unsupported wallet trusted prompt method',
      defaultReason: (trustedContext) =>
        `Wallet connection request from ${trustedContext.origin || 'unknown origin'}`,
    });
  }

  async function requestWalletTransactionPrompt(payload = {}, context = {}) {
    return requestNativeProviderPrompt({
      payload,
      context,
      createRequestId,
      defaultPresentNativeDialog,
      kind: TRUSTED_PROMPT_KINDS.WALLET_TRANSACTION,
      supportedMethods: WALLET_TRANSACTION_METHODS,
      unsupportedMessage: 'Unsupported wallet transaction trusted prompt method',
      defaultReason: (trustedContext) =>
        `Wallet transaction request from ${trustedContext.origin || 'unknown origin'}`,
    });
  }

  async function requestWalletSignaturePrompt(payload = {}, context = {}) {
    return requestNativeProviderPrompt({
      payload,
      context,
      createRequestId,
      defaultPresentNativeDialog,
      kind: TRUSTED_PROMPT_KINDS.WALLET_SIGNATURE,
      supportedMethods: WALLET_SIGNATURE_METHODS,
      unsupportedMessage: 'Unsupported wallet signature trusted prompt method',
      defaultReason: (trustedContext) =>
        `Wallet signature request from ${trustedContext.origin || 'unknown origin'}`,
    });
  }

  async function requestX402ApprovalPrompt(payload = {}, context = {}) {
    return requestNativeProviderPrompt({
      payload,
      context,
      createRequestId,
      defaultPresentNativeDialog,
      kind: TRUSTED_PROMPT_KINDS.X402_APPROVAL,
      supportedMethods: X402_APPROVAL_METHODS,
      unsupportedMessage: 'Unsupported x402 approval trusted prompt method',
      defaultReason: (trustedContext) =>
        `x402 payment approval request from ${trustedContext.origin || 'unknown origin'}`,
    });
  }

  async function requestX402VaultUnlockPrompt(payload = {}, context = {}) {
    return requestNativeProviderPrompt({
      payload,
      context,
      createRequestId,
      defaultPresentNativeDialog,
      kind: TRUSTED_PROMPT_KINDS.X402_VAULT_UNLOCK,
      supportedMethods: X402_VAULT_UNLOCK_METHODS,
      unsupportedMessage: 'Unsupported x402 vault unlock trusted prompt method',
      defaultReason: (trustedContext) =>
        `x402 vault unlock request from ${trustedContext.origin || 'unknown origin'}`,
    });
  }

  async function requestSwarmPublishPrompt(payload = {}, context = {}) {
    const method = typeof payload?.method === 'string' ? payload.method : '';
    if (!SWARM_PUBLISH_METHODS.has(method)) {
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
    const details = cloneSerializable(payload.details || null);
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
        ...(details ? { details } : {}),
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
        ...(details ? { details } : {}),
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
    requestWalletTransactionPrompt: async (payload, context) =>
      cloneSerializable(await requestWalletTransactionPrompt(payload, context)),
    requestWalletSignaturePrompt: async (payload, context) =>
      cloneSerializable(await requestWalletSignaturePrompt(payload, context)),
    requestX402ApprovalPrompt: async (payload, context) =>
      cloneSerializable(await requestX402ApprovalPrompt(payload, context)),
    requestX402VaultUnlockPrompt: async (payload, context) =>
      cloneSerializable(await requestX402VaultUnlockPrompt(payload, context)),
    requestSwarmConnectPrompt: async (payload, context) =>
      cloneSerializable(await requestNativeProviderPrompt({
        payload,
        context,
        createRequestId,
        defaultPresentNativeDialog,
        kind: TRUSTED_PROMPT_KINDS.SWARM_CONNECT,
        supportedMethods: SWARM_CONNECT_METHODS,
        unsupportedMessage: 'Unsupported Swarm connect trusted prompt method',
        defaultReason: (trustedContext) =>
          `Swarm connection request from ${trustedContext.origin || 'unknown origin'}`,
      })),
    requestSwarmPublishPrompt: async (payload, context) =>
      cloneSerializable(await requestSwarmPublishPrompt(payload, context)),
    requestSwarmFeedPrompt: async (payload, context) =>
      cloneSerializable(await requestNativeProviderPrompt({
        payload,
        context,
        createRequestId,
        defaultPresentNativeDialog,
        kind: TRUSTED_PROMPT_KINDS.SWARM_FEED,
        supportedMethods: SWARM_FEED_METHODS,
        unsupportedMessage: 'Unsupported Swarm feed trusted prompt method',
        defaultReason: (trustedContext) =>
          `Swarm feed request from ${trustedContext.origin || 'unknown origin'}`,
      })),
  });
}

const defaultTrustedPromptBroker = createTrustedPromptBroker();

module.exports = {
  TRUSTED_PROMPT_KINDS,
  TRUSTED_PROMPT_PRESENTATIONS,
  createTrustedPromptBroker,
  defaultTrustedPromptBroker,
};
