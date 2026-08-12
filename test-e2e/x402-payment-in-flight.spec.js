// x402 payment approval with a hardware account — once Pay is pressed the
// EIP-3009 authorization lives on the device and cannot be recalled.
//
// The payment card's screen hider *cancels* the payment (x402:reject for a
// subresource, x402:cancel for a paywall page, which also navigates the
// webview away). hideAllSubscreens() fires every hider, so any other
// approval surface opening mid-payment would force-cancel the detection in
// main while the user is still confirming that very payment on the device.
//
// Driven through the real renderer card: the main-process IPC it talks to is
// replaced for this app instance, and the approve handler is left hanging to
// hold the UI in the device-prompt state.

const { test, expect } = require('./fixtures');

const LEDGER = {
  index: 1000000,
  name: 'Ledger 1',
  address: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
  type: 'ledger',
  path: "44'/60'/0'/0/0",
};

const TX_PARAMS = {
  to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  value: '0',
  data: '0x095ea7b3' + '0'.repeat(56) + 'deadbeef' + 'f'.repeat(64),
};

function stubMainIpc(electronApp, ledger) {
  return electronApp.evaluate(({ ipcMain }, ledger) => {
    const replace = (channel, handler) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, handler);
    };
    replace('identity:get-status', () => ({ isUnlocked: true }));
    replace('wallet:get-derived-wallets', () => ({ success: true, wallets: [ledger] }));
    replace('dapp:get-permission', () => ({
      origin: 'https://pay.example',
      walletIndex: ledger.index,
      chainId: 8453,
    }));
    replace('x402:get-details', () => ({
      success: true,
      detectionId: 'det-1',
      url: 'https://pay.example/article',
      accepts: [
        {
          accept: {
            amount: '2500000',
            asset: '0xUSDC',
            network: 'base',
            payTo: '0x1111111111111111111111111111111111111111',
          },
          tuple: { amount: '2500000', chainId: 8453 },
          balanceKey: '8453:0xUSDC',
          asset: { symbol: 'USDC', decimals: 6 },
          balance: '5000000',
          fundable: true,
        },
      ],
      initialSelectionIndex: 0,
    }));
    replace('x402:get-all-permissions', () => ({ success: true, permissions: [] }));

    // Cancel paths must stay untouched while the device prompt is up.
    globalThis.__x402Cancels = { cancel: 0, reject: 0 };
    replace('x402:cancel', () => {
      globalThis.__x402Cancels.cancel += 1;
      return { success: true };
    });
    replace('x402:reject', () => {
      globalThis.__x402Cancels.reject += 1;
      return { success: true };
    });

    // Never settles on its own: this is the window where the device prompt
    // is up and the user is deciding.
    globalThis.__resolveX402Approve = null;
    replace('x402:approve', () => new Promise((resolve) => {
      globalThis.__resolveX402Approve = resolve;
    }));
  }, ledger);
}

// Put the app on the Ledger account and raise a 402 the way main does.
async function openPaymentCard(electronApp, window, ledger) {
  await window.evaluate(async (ledger) => {
    const { walletState } = await import('./lib/wallet/wallet-state.js');
    walletState.derivedWallets = [ledger];
    walletState.activeWalletIndex = ledger.index;
  }, ledger);

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('x402:approval-needed', {
      webContentsId: 7,
      detectionId: 'det-1',
      url: 'https://pay.example/article',
      resourceType: 'mainFrame',
    });
  });
}

function cancelCounts(electronApp) {
  return electronApp.evaluate(() => globalThis.__x402Cancels);
}

test('a dApp request mid-payment cannot cancel an in-flight Ledger payment', async ({
  electronApp,
  window,
}) => {
  await stubMainIpc(electronApp, LEDGER);
  await openPaymentCard(electronApp, window, LEDGER);

  await expect(window.locator('#sidebar-x402-approval')).toBeVisible();
  await expect(window.locator('#x402-approval-amount')).toHaveText('2.5 USDC');
  await expect(window.locator('#x402-approval-approve')).toBeEnabled();
  await window.screenshot({ path: 'test-results/x402-ledger-before-pay.png' });

  await window.click('#x402-approval-approve');

  // Device prompt is up: both ways out of the card are closed.
  await expect(window.locator('#x402-approval-approve')).toHaveText('Confirm on your Ledger…');
  await expect(window.locator('#x402-approval-reject')).toBeDisabled();
  await expect(window.locator('#x402-approval-back')).toBeDisabled();

  // A dApp request lands while the device is showing the payment. It must
  // be refused rather than firing hideAllSubscreens() — which would run the
  // card's hider and cancel the detection out from under the device.
  const settled = await window.evaluate(async (txParams) => {
    const dappTx = await import('./lib/wallet/dapp-tx.js');
    return dappTx.showDappTxApproval({}, 'https://swap.example', txParams).then(
      (hash) => `resolved:${hash}`,
      (err) => `rejected:${err.code || err.message}`
    );
  }, TX_PARAMS);
  expect(settled).toBe('rejected:-32002');

  expect(await cancelCounts(electronApp)).toEqual({ cancel: 0, reject: 0 });
  await expect(window.locator('#sidebar-dapp-tx')).toBeHidden();
  await expect(window.locator('#sidebar-x402-approval')).toBeVisible();
  await expect(window.locator('#x402-approval-url')).toHaveText('https://pay.example/article');
  await expect(window.locator('#x402-approval-approve')).toHaveText('Confirm on your Ledger…');
  await expect(window.locator('#x402-approval-reject')).toBeDisabled();
  await expect(window.locator('#x402-approval-back')).toBeDisabled();
  await window.screenshot({ path: 'test-results/x402-ledger-in-flight-protected.png' });

  // The device confirms: the payment — and only it — settles, and the card
  // releases the sidebar for the next request.
  await electronApp.evaluate(() => {
    globalThis.__resolveX402Approve({ success: true });
  });
  await expect(window.locator('#sidebar-x402-approval')).toBeHidden();
  expect(await cancelCounts(electronApp)).toEqual({ cancel: 0, reject: 0 });

  const afterSettle = await window.evaluate(async (txParams) => {
    const dappTx = await import('./lib/wallet/dapp-tx.js');
    dappTx.showDappTxApproval({}, 'https://swap.example', txParams).catch(() => {});
    return 'requested';
  }, TX_PARAMS);
  expect(afterSettle).toBe('requested');
  await expect(window.locator('#sidebar-dapp-tx')).toBeVisible();
});

// The browser tab strip is chrome the signature lock deliberately does not
// cover, so the paying tab can be closed while the device prompt is up. The
// subresource card's only release is the x402:approval-result event, so if
// that event is addressed through the (now dead) paying tab the sidebar
// keeps the lock for the rest of the session: the card freezes, the X and
// the toolbar toggle stay disabled, and every dApp request is refused
// -32002. Driven through the REAL detector + the REAL webContents
// 'destroyed' handler against a real tab; only get-details/approve are
// stubbed (the sign itself needs a device).
test('closing the paying tab mid-payment releases the sidebar instead of bricking it', async ({
  electronApp,
  window,
}) => {
  await stubMainIpc(electronApp, LEDGER);
  // The card carries the detectionId get-details hands it, so the stub has
  // to report the id the real detector below mints (`req-<request id>`).
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('x402:get-details');
    ipcMain.handle('x402:get-details', () => ({
      success: true,
      detectionId: 'req-4242',
      url: 'https://pay.example/segment/0',
      accepts: [{
        accept: {
          amount: '2500000',
          asset: '0xUSDC',
          network: 'base',
          payTo: '0x1111111111111111111111111111111111111111',
        },
        tuple: { amount: '2500000', chainId: 8453 },
        balanceKey: '8453:0xUSDC',
        asset: { symbol: 'USDC', decimals: 6 },
        balance: '5000000',
        fundable: true,
      }],
      initialSelectionIndex: 0,
    }));
  });
  await window.evaluate(async (ledger) => {
    const { walletState } = await import('./lib/wallet/wallet-state.js');
    walletState.derivedWallets = [ledger];
    walletState.activeWalletIndex = ledger.index;
  }, LEDGER);

  // A second tab is the paying tab, so closing it doesn't close the window.
  await window.locator('[data-test="new-tab-btn"]').click();
  await expect(window.locator('[data-test="tab"]')).toHaveCount(2);
  const guestId = await window.evaluate(async () => {
    const tabs = await import('./lib/tabs.js');
    return tabs.getActiveWebview()?.getWebContentsId() ?? null;
  });
  expect(typeof guestId).toBe('number');

  // Real 402 detection on that tab: mints the detectionId, stores the
  // detection and fires x402:approval-needed through the real sendToHost.
  await electronApp.evaluate(({ app }, guestId) => {
    // `require` isn't in scope inside evaluate; go through the main
    // module so we get the SAME intercept instance the app is running.
    const nodeRequire = process.mainModule.require.bind(process.mainModule);
    const intercept = nodeRequire(
      nodeRequire('path').join(app.getAppPath(), 'src/main/x402/intercept.js')
    );
    const requirements = {
      x402Version: 2,
      resource: { url: 'https://pay.example/segment/0' },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '2500000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x1111111111111111111111111111111111111111',
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
      }],
    };
    // Not awaited: the detector holds the response open until the user
    // decides, exactly as it does in production.
    intercept.detectPaymentRequiredHandler({
      id: 4242,
      webContentsId: guestId,
      url: 'https://pay.example/segment/0',
      statusLine: 'HTTP/1.1 402 Payment Required',
      responseHeaders: {
        'PAYMENT-REQUIRED': [Buffer.from(JSON.stringify(requirements)).toString('base64')],
      },
      resourceType: 'xhr',
    });
  }, guestId);

  await expect(window.locator('#sidebar-x402-approval')).toBeVisible();
  await window.click('#x402-approval-approve');

  // Device prompt is up and the sidebar is locked to it.
  await expect(window.locator('#x402-approval-approve')).toHaveText('Confirm on your Ledger…');
  await expect(window.locator('#x402-approval-reject')).toBeDisabled();
  await expect(window.locator('#sidebar-close')).toBeDisabled();
  await window.screenshot({ path: 'test-results/x402-tab-close-before.png' });

  // Main-side shape of "the authorization has left for the device": the
  // approval entry is settled and gone, the sign is outstanding.
  await electronApp.evaluate(({ app }) => {
    const nodeRequire = process.mainModule.require.bind(process.mainModule);
    nodeRequire(
      nodeRequire('path').join(app.getAppPath(), 'src/main/x402/intercept.js')
    ).clearAllPendingApprovals();
  });

  // User closes the paying tab. Real destroy → real cleanup → the card is
  // told its request is gone, over a channel that doesn't need the tab.
  await window.locator('[data-test="tab"][data-tab-id="2"] [data-test="tab-close"]').click();
  await expect(window.locator('[data-test="tab"]')).toHaveCount(1);

  await expect(window.locator('#sidebar-x402-approval')).toBeHidden();
  await expect(window.locator('#sidebar-close')).toBeEnabled();
  await expect(window.locator('#wallet-toggle-btn')).toBeEnabled();
  expect(await cancelCounts(electronApp)).toEqual({ cancel: 0, reject: 0 });

  // Acceptance: the wallet works again — a dApp request is served rather
  // than refused -32002, and the sidebar can be closed normally.
  const settled = await window.evaluate(async (txParams) => {
    const dappTx = await import('./lib/wallet/dapp-tx.js');
    dappTx.showDappTxApproval({}, 'https://swap.example', txParams).catch(() => {});
    return 'requested';
  }, TX_PARAMS);
  expect(settled).toBe('requested');
  await expect(window.locator('#sidebar-dapp-tx')).toBeVisible();
  await window.screenshot({ path: 'test-results/x402-tab-close-after.png' });
});
