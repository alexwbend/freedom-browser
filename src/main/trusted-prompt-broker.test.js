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

  test('routes wallet connect prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'rejected',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-wallet-1',
      presentNativeDialog,
    });
    const caller = {
      runtimeMode: 'local-package',
      source: 'local',
      packageId: 'baby.freedom.chrome.official',
      packageType: 'browser-chrome',
      name: 'Freedom Official Chrome',
      version: '0.7.5',
    };

    await expect(
      broker.requestWalletConnectPrompt(
        {
          method: 'eth_requestAccounts',
          origin: 'https://spoofed.example',
        },
        {
          caller,
          origin: 'https://app.example',
          webContentsId: 42,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-wallet-1',
      kind: 'wallet.connect',
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'shell-native-dialog',
      context: {
        source: 'main',
        caller: {
          runtimeMode: 'local-package',
          source: 'local',
          packageId: 'baby.freedom.chrome.official',
          packageType: 'browser-chrome',
          name: 'Freedom Official Chrome',
          version: '0.7.5',
        },
        origin: 'https://app.example',
        tabId: null,
        webContentsId: 42,
      },
      request: {
        method: 'eth_requestAccounts',
        reason: 'Wallet connection request from https://app.example',
        presentation: 'native-dialog',
      },
      result: {
        outcome: 'rejected',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(presentNativeDialog).toHaveBeenCalledWith(
      {
        requestId: 'trusted-prompt-wallet-1',
        kind: TRUSTED_PROMPT_KINDS.WALLET_CONNECT,
        method: 'eth_requestAccounts',
        reason: 'Wallet connection request from https://app.example',
        origin: 'https://app.example',
        webContentsId: 42,
      },
      {
        caller,
        origin: 'https://app.example',
        webContentsId: 42,
      }
    );
  });

  test('rejects unsupported wallet prompt methods', async () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'unused-wallet',
    });

    await expect(
      broker.requestWalletConnectPrompt({
        method: 'eth_sendTransaction',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_UNSUPPORTED',
        message: 'Unsupported wallet trusted prompt method',
      },
    });
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
