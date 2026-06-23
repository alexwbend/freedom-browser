const {
  TRUSTED_PROMPT_KINDS,
  createTrustedPromptBroker,
} = require('./trusted-prompt-broker');

describe('trusted-prompt-broker', () => {
  test('returns a shell-owned test prompt result from main-derived context', () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-test-1',
    });

    expect(
      broker.requestTestPrompt(
        {
          kind: TRUSTED_PROMPT_KINDS.TEST_CONFIRMATION,
          reason: ' Verify the broker boundary ',
          origin: 'https://spoofed.example',
        },
        {
          caller: {
            runtimeMode: 'local-package',
            source: 'local',
            packageId: 'baby.freedom.chrome.fixture',
            packageType: 'browser-chrome',
            name: 'Fixture Chrome',
            version: '0.0.1',
            capabilities: ['trustedPrompts.test'],
          },
        }
      )
    ).toEqual({
      ok: true,
      requestId: 'trusted-prompt-test-1',
      kind: 'test.confirmation',
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'trusted-prompt-broker',
      context: {
        source: 'main',
        caller: {
          runtimeMode: 'local-package',
          source: 'local',
          packageId: 'baby.freedom.chrome.fixture',
          packageType: 'browser-chrome',
          name: 'Fixture Chrome',
          version: '0.0.1',
        },
        origin: null,
        tabId: null,
      },
      request: {
        reason: 'Verify the broker boundary',
      },
      result: {
        outcome: 'accepted',
        source: 'test-only-broker',
      },
    });
  });

  test('returns structured errors for unsupported prompt kinds', () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'unused',
    });

    expect(
      broker.requestTestPrompt({
        kind: 'wallet.sign',
      })
    ).toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_UNSUPPORTED',
        message: 'Unsupported trusted prompt kind',
      },
    });
  });

  test('clones prompt results before returning them', () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-test-2',
    });

    const result = broker.requestTestPrompt({
      kind: TRUSTED_PROMPT_KINDS.TEST_CONFIRMATION,
      reason: 'first',
    });
    result.context.source = 'mutated';

    expect(
      broker.requestTestPrompt({
        kind: TRUSTED_PROMPT_KINDS.TEST_CONFIRMATION,
        reason: 'second',
      })
    ).toMatchObject({
      context: {
        source: 'main',
      },
      request: {
        reason: 'second',
      },
    });
  });
});
