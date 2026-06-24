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

  test('routes wallet transaction prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'rejected',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-wallet-transaction-1',
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
      broker.requestWalletTransactionPrompt(
        {
          method: 'eth_sendTransaction',
          origin: 'https://spoofed.example',
        },
        {
          caller,
          origin: 'https://app.example',
          webContentsId: 43,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-wallet-transaction-1',
      kind: 'wallet.transaction',
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
        webContentsId: 43,
      },
      request: {
        method: 'eth_sendTransaction',
        reason: 'Wallet transaction request from https://app.example',
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
        requestId: 'trusted-prompt-wallet-transaction-1',
        kind: TRUSTED_PROMPT_KINDS.WALLET_TRANSACTION,
        method: 'eth_sendTransaction',
        reason: 'Wallet transaction request from https://app.example',
        origin: 'https://app.example',
        webContentsId: 43,
      },
      {
        caller,
        origin: 'https://app.example',
        webContentsId: 43,
      }
    );
  });

  test('preserves trusted wallet account selection from the shell-owned presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
      selectedWalletIndex: 1,
      selectedAccount: '0x2222222222222222222222222222222222222222',
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-wallet-selection-1',
      presentNativeDialog,
    });

    await expect(
      broker.requestWalletConnectPrompt(
        {
          method: 'eth_requestAccounts',
          details: {
            accountChoices: [
              {
                walletIndex: 0,
                account: '0x1111111111111111111111111111111111111111',
                active: true,
              },
              {
                walletIndex: 1,
                account: '0x2222222222222222222222222222222222222222',
              },
            ],
          },
        },
        {
          origin: 'https://app.example',
          webContentsId: 45,
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      kind: 'wallet.connect',
      result: {
        outcome: 'accepted',
        source: 'shell-native-dialog',
        response: 0,
        selectedWalletIndex: 1,
        selectedAccount: '0x2222222222222222222222222222222222222222',
      },
    });
  });

  test('routes wallet signature prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'rejected',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-wallet-signature-1',
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
      broker.requestWalletSignaturePrompt(
        {
          method: 'personal_sign',
          origin: 'https://spoofed.example',
        },
        {
          caller,
          origin: 'https://app.example',
          webContentsId: 44,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-wallet-signature-1',
      kind: 'wallet.signature',
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
        webContentsId: 44,
      },
      request: {
        method: 'personal_sign',
        reason: 'Wallet signature request from https://app.example',
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
        requestId: 'trusted-prompt-wallet-signature-1',
        kind: TRUSTED_PROMPT_KINDS.WALLET_SIGNATURE,
        method: 'personal_sign',
        reason: 'Wallet signature request from https://app.example',
        origin: 'https://app.example',
        webContentsId: 44,
      },
      {
        caller,
        origin: 'https://app.example',
        webContentsId: 44,
      }
    );
  });

  test('propagates shell-owned trusted window metadata for wallet prompts', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
      renderedBy: 'trusted-wallet-approval-window',
      presentation: 'trusted-window',
      source: 'trusted-wallet-approval-window',
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-wallet-window-1',
      presentNativeDialog,
    });

    await expect(
      broker.requestWalletSignaturePrompt(
        {
          method: 'personal_sign',
          reason: 'Wallet signature request from https://app.example',
          details: {
            account: '0x1111111111111111111111111111111111111111',
            messagePreview: '0x68656c6c6f',
          },
        },
        {
          origin: 'https://app.example',
          webContentsId: 44,
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      requestId: 'trusted-prompt-wallet-window-1',
      kind: TRUSTED_PROMPT_KINDS.WALLET_SIGNATURE,
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'trusted-wallet-approval-window',
      request: {
        method: 'personal_sign',
        presentation: 'trusted-window',
        details: {
          account: '0x1111111111111111111111111111111111111111',
          messagePreview: '0x68656c6c6f',
        },
      },
      result: {
        outcome: 'accepted',
        source: 'trusted-wallet-approval-window',
        response: 0,
      },
    });
  });

  test('routes x402 approval prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'rejected',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-x402-approval-1',
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
      broker.requestX402ApprovalPrompt(
        {
          method: 'x402_approval',
          origin: 'https://spoofed.example',
        },
        {
          caller,
          origin: 'https://pay.example',
          webContentsId: 45,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-x402-approval-1',
      kind: 'x402.approval',
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
        origin: 'https://pay.example',
        tabId: null,
        webContentsId: 45,
      },
      request: {
        method: 'x402_approval',
        reason: 'x402 payment approval request from https://pay.example',
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
        requestId: 'trusted-prompt-x402-approval-1',
        kind: TRUSTED_PROMPT_KINDS.X402_APPROVAL,
        method: 'x402_approval',
        reason: 'x402 payment approval request from https://pay.example',
        origin: 'https://pay.example',
        webContentsId: 45,
      },
      {
        caller,
        origin: 'https://pay.example',
        webContentsId: 45,
      }
    );
  });

  test('propagates shell-owned trusted window metadata for x402 approval prompts', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 1,
      renderedBy: 'trusted-x402-approval-window',
      presentation: 'trusted-window',
      source: 'trusted-x402-approval-window',
      grant: {
        capAmount: '10000000',
        windowSeconds: 2592000,
      },
      selectedAcceptIndex: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-x402-approval-window-1',
      presentNativeDialog,
    });

    await expect(
      broker.requestX402ApprovalPrompt(
        {
          method: 'x402_approval',
          reason: 'x402 payment approval request from https://pay.example',
          details: {
            amount: '10000',
          },
        },
        {
          origin: 'https://pay.example',
          webContentsId: 45,
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      requestId: 'trusted-prompt-x402-approval-window-1',
      kind: TRUSTED_PROMPT_KINDS.X402_APPROVAL,
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'trusted-x402-approval-window',
      request: {
        method: 'x402_approval',
        presentation: 'trusted-window',
        details: {
          amount: '10000',
        },
      },
      result: {
        outcome: 'accepted',
        source: 'trusted-x402-approval-window',
        response: 1,
        grant: {
          capAmount: '10000000',
          windowSeconds: 2592000,
        },
        selectedAcceptIndex: 0,
      },
    });
  });

  test('routes x402 vault unlock prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'rejected',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-x402-vault-1',
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
      broker.requestX402VaultUnlockPrompt(
        {
          method: 'x402_vaultUnlock',
          origin: 'https://spoofed.example',
        },
        {
          caller,
          origin: 'https://pay.example',
          webContentsId: 46,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-x402-vault-1',
      kind: 'x402.vaultUnlock',
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
        origin: 'https://pay.example',
        tabId: null,
        webContentsId: 46,
      },
      request: {
        method: 'x402_vaultUnlock',
        reason: 'x402 vault unlock request from https://pay.example',
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
        requestId: 'trusted-prompt-x402-vault-1',
        kind: TRUSTED_PROMPT_KINDS.X402_VAULT_UNLOCK,
        method: 'x402_vaultUnlock',
        reason: 'x402 vault unlock request from https://pay.example',
        origin: 'https://pay.example',
        webContentsId: 46,
      },
      {
        caller,
        origin: 'https://pay.example',
        webContentsId: 46,
      }
    );
  });

  test('routes Swarm publish prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'rejected',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-swarm-1',
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
      broker.requestSwarmPublishPrompt(
        {
          method: 'swarm_publishData',
          origin: 'https://spoofed.example',
          details: {
            contentType: 'text/plain',
            sizeBytes: 5,
            name: 'note.txt',
          },
        },
        {
          caller,
          origin: 'ipfs://bafyapp',
          webContentsId: 52,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-swarm-1',
      kind: 'swarm.publish',
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
        origin: 'ipfs://bafyapp',
        tabId: null,
        webContentsId: 52,
      },
      request: {
        method: 'swarm_publishData',
        reason: 'Swarm publish request from ipfs://bafyapp',
        presentation: 'native-dialog',
        details: {
          contentType: 'text/plain',
          sizeBytes: 5,
          name: 'note.txt',
        },
      },
      result: {
        outcome: 'rejected',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(presentNativeDialog).toHaveBeenCalledWith(
      {
        requestId: 'trusted-prompt-swarm-1',
        kind: TRUSTED_PROMPT_KINDS.SWARM_PUBLISH,
        method: 'swarm_publishData',
        reason: 'Swarm publish request from ipfs://bafyapp',
        origin: 'ipfs://bafyapp',
        webContentsId: 52,
        details: {
          contentType: 'text/plain',
          sizeBytes: 5,
          name: 'note.txt',
        },
      },
      {
        caller,
        origin: 'ipfs://bafyapp',
        webContentsId: 52,
      }
    );
  });

  test('propagates shell-owned trusted window metadata for Swarm publish prompts', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
      renderedBy: 'trusted-swarm-approval-window',
      presentation: 'trusted-window',
      source: 'trusted-swarm-approval-window',
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-swarm-window-1',
      presentNativeDialog,
    });

    await expect(
      broker.requestSwarmPublishPrompt(
        {
          method: 'swarm_publishFiles',
          reason: 'Swarm publish request from ipfs://bafyapp',
          details: {
            target: 'files',
            fileCount: 2,
            sizeBytes: 8,
            indexDocument: 'index.html',
          },
        },
        {
          origin: 'ipfs://bafyapp',
          webContentsId: 52,
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      requestId: 'trusted-prompt-swarm-window-1',
      kind: TRUSTED_PROMPT_KINDS.SWARM_PUBLISH,
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'trusted-swarm-approval-window',
      request: {
        method: 'swarm_publishFiles',
        presentation: 'trusted-window',
        details: {
          target: 'files',
          fileCount: 2,
          sizeBytes: 8,
          indexDocument: 'index.html',
        },
      },
      result: {
        outcome: 'accepted',
        source: 'trusted-swarm-approval-window',
        response: 0,
      },
    });
  });

  test('routes Swarm connection prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-swarm-connect-1',
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
      broker.requestSwarmConnectPrompt(
        {
          method: 'swarm_requestAccess',
          origin: 'https://spoofed.example',
        },
        {
          caller,
          origin: 'ipfs://bafyapp',
          webContentsId: 53,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-swarm-connect-1',
      kind: 'swarm.connect',
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
        origin: 'ipfs://bafyapp',
        tabId: null,
        webContentsId: 53,
      },
      request: {
        method: 'swarm_requestAccess',
        reason: 'Swarm connection request from ipfs://bafyapp',
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
        requestId: 'trusted-prompt-swarm-connect-1',
        kind: TRUSTED_PROMPT_KINDS.SWARM_CONNECT,
        method: 'swarm_requestAccess',
        reason: 'Swarm connection request from ipfs://bafyapp',
        origin: 'ipfs://bafyapp',
        webContentsId: 53,
      },
      {
        caller,
        origin: 'ipfs://bafyapp',
        webContentsId: 53,
      }
    );
  });

  test('routes Swarm file publish prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-swarm-files-1',
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
      broker.requestSwarmPublishPrompt(
        {
          method: 'swarm_publishFiles',
          origin: 'https://spoofed.example',
          details: {
            fileCount: 2,
            sizeBytes: 8,
            indexDocument: 'index.html',
          },
        },
        {
          caller,
          origin: 'ipfs://bafyapp',
          webContentsId: 54,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-swarm-files-1',
      kind: 'swarm.publish',
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
        origin: 'ipfs://bafyapp',
        tabId: null,
        webContentsId: 54,
      },
      request: {
        method: 'swarm_publishFiles',
        reason: 'Swarm publish request from ipfs://bafyapp',
        presentation: 'native-dialog',
        details: {
          fileCount: 2,
          sizeBytes: 8,
          indexDocument: 'index.html',
        },
      },
      result: {
        outcome: 'accepted',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(presentNativeDialog).toHaveBeenCalledWith(
      {
        requestId: 'trusted-prompt-swarm-files-1',
        kind: TRUSTED_PROMPT_KINDS.SWARM_PUBLISH,
        method: 'swarm_publishFiles',
        reason: 'Swarm publish request from ipfs://bafyapp',
        origin: 'ipfs://bafyapp',
        webContentsId: 54,
        details: {
          fileCount: 2,
          sizeBytes: 8,
          indexDocument: 'index.html',
        },
      },
      {
        caller,
        origin: 'ipfs://bafyapp',
        webContentsId: 54,
      }
    );
  });

  test('routes Swarm feed prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-swarm-feed-1',
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
      broker.requestSwarmFeedPrompt(
        {
          method: 'swarm_createFeed',
          origin: 'https://spoofed.example',
          details: {
            feedName: 'blog',
            identityMode: 'app-scoped',
          },
        },
        {
          caller,
          origin: 'ipfs://bafyapp',
          webContentsId: 55,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-swarm-feed-1',
      kind: 'swarm.feed',
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
        origin: 'ipfs://bafyapp',
        tabId: null,
        webContentsId: 55,
      },
      request: {
        method: 'swarm_createFeed',
        reason: 'Swarm feed request from ipfs://bafyapp',
        presentation: 'native-dialog',
        details: {
          feedName: 'blog',
          identityMode: 'app-scoped',
        },
      },
      result: {
        outcome: 'accepted',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(presentNativeDialog).toHaveBeenCalledWith(
      {
        requestId: 'trusted-prompt-swarm-feed-1',
        kind: TRUSTED_PROMPT_KINDS.SWARM_FEED,
        method: 'swarm_createFeed',
        reason: 'Swarm feed request from ipfs://bafyapp',
        origin: 'ipfs://bafyapp',
        webContentsId: 55,
        details: {
          feedName: 'blog',
          identityMode: 'app-scoped',
        },
      },
      {
        caller,
        origin: 'ipfs://bafyapp',
        webContentsId: 55,
      }
    );
  });

  test('routes Swarm feed update prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-swarm-feed-update-1',
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
    const reference = 'aa'.repeat(32);
    const currentReference = 'bb'.repeat(32);

    await expect(
      broker.requestSwarmFeedPrompt(
        {
          method: 'swarm_updateFeed',
          details: {
            action: 'update',
            feedName: 'blog',
            reference,
            currentReference,
            manifestReference: 'manifesthex',
            feedOwner: '0xOwnerAddr',
            feedIdentityId: 'app-scoped:0',
            identityMode: 'app-scoped',
          },
        },
        {
          caller,
          origin: 'ipfs://bafyapp',
          webContentsId: 56,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-swarm-feed-update-1',
      kind: 'swarm.feed',
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
        origin: 'ipfs://bafyapp',
        tabId: null,
        webContentsId: 56,
      },
      request: {
        method: 'swarm_updateFeed',
        reason: 'Swarm feed request from ipfs://bafyapp',
        presentation: 'native-dialog',
        details: {
          action: 'update',
          feedName: 'blog',
          reference,
          currentReference,
          manifestReference: 'manifesthex',
          feedOwner: '0xOwnerAddr',
          feedIdentityId: 'app-scoped:0',
          identityMode: 'app-scoped',
        },
      },
      result: {
        outcome: 'accepted',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(presentNativeDialog).toHaveBeenCalledWith(
      {
        requestId: 'trusted-prompt-swarm-feed-update-1',
        kind: TRUSTED_PROMPT_KINDS.SWARM_FEED,
        method: 'swarm_updateFeed',
        reason: 'Swarm feed request from ipfs://bafyapp',
        origin: 'ipfs://bafyapp',
        webContentsId: 56,
        details: {
          action: 'update',
          feedName: 'blog',
          reference,
          currentReference,
          manifestReference: 'manifesthex',
          feedOwner: '0xOwnerAddr',
          feedIdentityId: 'app-scoped:0',
          identityMode: 'app-scoped',
        },
      },
      {
        caller,
        origin: 'ipfs://bafyapp',
        webContentsId: 56,
      }
    );
  });

  test('routes Swarm feed entry write prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-swarm-feed-write-1',
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
      broker.requestSwarmFeedPrompt(
        {
          method: 'swarm_writeFeedEntry',
          details: {
            action: 'write',
            feedName: 'blog',
            sizeBytes: 5,
            currentReference: 'bb'.repeat(32),
            manifestReference: 'manifesthex',
            feedOwner: '0xOwnerAddr',
            feedIdentityId: 'app-scoped:0',
            payloadPreview: 'hello',
            index: 2,
            identityMode: 'app-scoped',
          },
        },
        {
          caller,
          origin: 'ipfs://bafyapp',
          webContentsId: 57,
        }
      )
    ).resolves.toEqual({
      ok: true,
      requestId: 'trusted-prompt-swarm-feed-write-1',
      kind: 'swarm.feed',
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
        origin: 'ipfs://bafyapp',
        tabId: null,
        webContentsId: 57,
      },
      request: {
        method: 'swarm_writeFeedEntry',
        reason: 'Swarm feed request from ipfs://bafyapp',
        presentation: 'native-dialog',
        details: {
          action: 'write',
          feedName: 'blog',
          sizeBytes: 5,
          currentReference: 'bb'.repeat(32),
          manifestReference: 'manifesthex',
          feedOwner: '0xOwnerAddr',
          feedIdentityId: 'app-scoped:0',
          payloadPreview: 'hello',
          index: 2,
          identityMode: 'app-scoped',
        },
      },
      result: {
        outcome: 'accepted',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(presentNativeDialog).toHaveBeenCalledWith(
      {
        requestId: 'trusted-prompt-swarm-feed-write-1',
        kind: TRUSTED_PROMPT_KINDS.SWARM_FEED,
        method: 'swarm_writeFeedEntry',
        reason: 'Swarm feed request from ipfs://bafyapp',
        origin: 'ipfs://bafyapp',
        webContentsId: 57,
        details: {
          action: 'write',
          feedName: 'blog',
          sizeBytes: 5,
          currentReference: 'bb'.repeat(32),
          manifestReference: 'manifesthex',
          feedOwner: '0xOwnerAddr',
          feedIdentityId: 'app-scoped:0',
          payloadPreview: 'hello',
          index: 2,
          identityMode: 'app-scoped',
        },
      },
      {
        caller,
        origin: 'ipfs://bafyapp',
        webContentsId: 57,
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

  test('rejects unsupported wallet transaction and signature prompt methods', async () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'unused-wallet-specific',
    });

    await expect(
      broker.requestWalletTransactionPrompt({
        method: 'personal_sign',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_UNSUPPORTED',
        message: 'Unsupported wallet transaction trusted prompt method',
      },
    });
    await expect(
      broker.requestWalletSignaturePrompt({
        method: 'eth_sendTransaction',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_UNSUPPORTED',
        message: 'Unsupported wallet signature trusted prompt method',
      },
    });
  });

  test('rejects unsupported x402 prompt methods', async () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'unused-x402',
    });

    await expect(
      broker.requestX402ApprovalPrompt({
        method: 'x402_vaultUnlock',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_UNSUPPORTED',
        message: 'Unsupported x402 approval trusted prompt method',
      },
    });
    await expect(
      broker.requestX402VaultUnlockPrompt({
        method: 'x402_approval',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_UNSUPPORTED',
        message: 'Unsupported x402 vault unlock trusted prompt method',
      },
    });
  });

  test('rejects unsupported Swarm prompt methods', async () => {
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'unused-swarm',
    });

    await expect(
      broker.requestSwarmPublishPrompt({
        method: 'swarm_updateFeed',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_UNSUPPORTED',
        message: 'Unsupported Swarm trusted prompt method',
      },
    });
    await expect(
      broker.requestSwarmFeedPrompt({
        method: 'swarm_writeSingleOwnerChunk',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_UNSUPPORTED',
        message: 'Unsupported Swarm feed trusted prompt method',
      },
    });
    await expect(
      broker.requestSwarmSigningPrompt({
        method: 'swarm_publishData',
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TRUSTED_PROMPT_UNSUPPORTED',
        message: 'Unsupported Swarm signing trusted prompt method',
      },
    });
  });

  test('routes Swarm chunk publish prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-swarm-chunk-1',
      presentNativeDialog,
    });

    await expect(
      broker.requestSwarmPublishPrompt(
        {
          method: 'swarm_publishChunk',
          details: {
            target: 'chunk',
            sizeBytes: 5,
            span: '5',
          },
        },
        {
          origin: 'ipfs://bafyapp',
          webContentsId: 52,
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      requestId: 'trusted-prompt-swarm-chunk-1',
      kind: 'swarm.publish',
      renderedBy: 'shell-native-dialog',
      request: {
        method: 'swarm_publishChunk',
        details: {
          target: 'chunk',
          sizeBytes: 5,
          span: '5',
        },
      },
      result: {
        outcome: 'accepted',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(presentNativeDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'trusted-prompt-swarm-chunk-1',
        kind: TRUSTED_PROMPT_KINDS.SWARM_PUBLISH,
        method: 'swarm_publishChunk',
        details: {
          target: 'chunk',
          sizeBytes: 5,
          span: '5',
        },
      }),
      expect.objectContaining({
        origin: 'ipfs://bafyapp',
        webContentsId: 52,
      })
    );
  });

  test('routes Swarm publisher signing prompts through a shell-owned native dialog presenter', async () => {
    const presentNativeDialog = jest.fn().mockResolvedValue({
      ok: true,
      outcome: 'accepted',
      response: 0,
    });
    const broker = createTrustedPromptBroker({
      createRequestId: () => 'trusted-prompt-swarm-signing-1',
      presentNativeDialog,
    });

    await expect(
      broker.requestSwarmSigningPrompt(
        {
          method: 'swarm_writeSingleOwnerChunk',
          details: {
            action: 'soc',
            identifier: 'bb'.repeat(32),
            sizeBytes: 5,
            span: '5',
          },
        },
        {
          origin: 'ipfs://bafyapp',
          webContentsId: 52,
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      requestId: 'trusted-prompt-swarm-signing-1',
      kind: 'swarm.signing',
      renderedBy: 'shell-native-dialog',
      request: {
        method: 'swarm_writeSingleOwnerChunk',
        details: {
          action: 'soc',
          identifier: 'bb'.repeat(32),
          sizeBytes: 5,
          span: '5',
        },
      },
      result: {
        outcome: 'accepted',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(presentNativeDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'trusted-prompt-swarm-signing-1',
        kind: TRUSTED_PROMPT_KINDS.SWARM_SIGNING,
        method: 'swarm_writeSingleOwnerChunk',
        details: {
          action: 'soc',
          identifier: 'bb'.repeat(32),
          sizeBytes: 5,
          span: '5',
        },
      }),
      expect.objectContaining({
        origin: 'ipfs://bafyapp',
        webContentsId: 52,
      })
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
