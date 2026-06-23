const TRUSTED_PROMPT_KINDS = Object.freeze({
  TEST_CONFIRMATION: 'test.confirmation',
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

function createTrustedPromptBroker(options = {}) {
  const createRequestId =
    options.createRequestId ||
    (() => `trusted-prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  function requestTestPrompt(payload = {}, context = {}) {
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

    return {
      ok: true,
      requestId: createRequestId(),
      kind,
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'trusted-prompt-broker',
      context: {
        source: 'main',
        caller: describeCaller(context.caller),
        origin: context.origin || null,
        tabId: Number.isInteger(context.tabId) ? context.tabId : null,
      },
      request: {
        reason: normalizeReason(payload.reason),
      },
      result: {
        outcome: 'accepted',
        source: 'test-only-broker',
      },
    };
  }

  return Object.freeze({
    requestTestPrompt: (payload, context) => cloneSerializable(requestTestPrompt(payload, context)),
  });
}

const defaultTrustedPromptBroker = createTrustedPromptBroker();

module.exports = {
  TRUSTED_PROMPT_KINDS,
  createTrustedPromptBroker,
  defaultTrustedPromptBroker,
};
