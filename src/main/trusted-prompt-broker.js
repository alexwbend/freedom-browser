const TRUSTED_PROMPT_KINDS = Object.freeze({
  TEST_CONFIRMATION: 'test.confirmation',
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
        context: {
          source: 'main',
          caller: describeCaller(context.caller),
          origin: context.origin || null,
          tabId: Number.isInteger(context.tabId) ? context.tabId : null,
        },
        request: {
          reason,
          presentation,
        },
        result: {
          outcome: presentationResult.outcome || 'accepted',
          source: 'shell-native-dialog',
          response:
            Number.isInteger(presentationResult.response) ? presentationResult.response : null,
        },
      };
    }

    return {
      ok: true,
      requestId,
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
        reason,
      },
      result: {
        outcome: 'accepted',
        source: 'test-only-broker',
      },
    };
  }

  return Object.freeze({
    requestTestPrompt: async (payload, context) =>
      cloneSerializable(await requestTestPrompt(payload, context)),
  });
}

const defaultTrustedPromptBroker = createTrustedPromptBroker();

module.exports = {
  TRUSTED_PROMPT_KINDS,
  TRUSTED_PROMPT_PRESENTATIONS,
  createTrustedPromptBroker,
  defaultTrustedPromptBroker,
};
