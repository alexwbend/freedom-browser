const {
  TRUSTED_PROMPT_KINDS,
  TRUSTED_PROMPT_PRESENTATIONS,
  createTrustedPromptBroker,
} = require('./trusted-prompt-broker');

describe('trusted-prompt-broker', () => {
  test('returns a shell-owned test prompt result from main-derived context', async () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-test-1',
    });

    await expect(
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
    ).resolves.toEqual({
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

  test('routes test prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-native-1',
      presentNativeDialog,
    });
    const caller = {
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.fixture',
      packageType: 'browser-chrome',
      name: 'Fixture Chrome',
      version: '0.0.1',
      capabilities: ['trustedPrompts.test'],
    };

    await expect(
      broker.requestTestPrompt(
        {
          kind: TRUSTED_PROMPT_KINDS.TEST_CONFIRMATION,
          reason: ' Native prompt from package chrome ',
          presentation: TRUSTED_PROMPT_PRESENTATIONS.NATIVE_DIALOG,
          origin: 'https://spoofed.example',
        },
        { caller }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-native-1',
      kind: 'test.confirmation',
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'shell-native-dialog',
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
        reason: 'Native prompt from package chrome',
        presentation: 'native-dialog',
      },
      result: {
        outcome: 'accepted',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(presentNativeDialog).toHaveBeenCalledWith(
      {
        requestId: 'trusted-prompt-native-1',
        kind: 'test.confirmation',
        reason: 'Native prompt from package chrome',
      },
      { caller }
    );
  });

  test('returns structured errors when native presentation is unavailable', async () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-native-2',
    });

    await expect(
      broker.requestTestPrompt({
        kind: TRUSTED_PROMPT_KINDS.TEST_CONFIRMATION,
        presentation: TRUSTED_PROMPT_PRESENTATIONS.NATIVE_DIALOG,
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_PRESENTATION_UNAVAILABLE',
        message: 'Native trusted prompt presentation is unavailable',
      },
    });
  });

  test('returns structured errors for unsupported prompt kinds', async () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'unused',
    });

    await expect(
      broker.requestTestPrompt({
        kind: 'wallet.sign',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_UNSUPPORTED',
        message: 'Unsupported trusted prompt kind',
      },
    });
  });

  test('clones prompt results before returning them', async () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-test-2',
    });

    const result = await broker.requestTestPrompt({
      kind: TRUSTED_PROMPT_KINDS.TEST_CONFIRMATION,
      reason: 'first',
    });
    result.context.source = 'mutated';

    await expect(
      broker.requestTestPrompt({
        kind: TRUSTED_PROMPT_KINDS.TEST_CONFIRMATION,
        reason: 'second',
      })
    ).resolves.toMatchObject({
      context: {
        source: 'main',
      },
      request: {
        reason: 'second',
      },
    });
  });
});
