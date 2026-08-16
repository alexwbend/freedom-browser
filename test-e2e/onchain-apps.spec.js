// Native web3: navigation smoke for ERC-8244 contract-hosted applications.
// The harness owns the protocol bytes here; main-process unit tests cover the
// real html() call and response security policy. This test proves Chromium
// accepts the contract:chain authority and renders it in a guest webview.

const { test, expect } = require('./fixtures');

const ADDRESS = '0x00000095643cffa7d9fae407a84dfcb6406456c6';
const APP_URL = `web3://${ADDRESS}.eip155-1/`;

test('loads a contract-hosted app under its web3 contract-and-chain origin', async ({
  window,
  harness,
}) => {
  await harness.setContentFixture(APP_URL, {
    body: '<!doctype html><title>Onchain fixture</title><h1 id="app">ERC-8244 fixture</h1>',
  });

  // The chrome becomes visible just before the initial home webview commits;
  // wait for that commit so it cannot clear a value typed in this test.
  await expect
    .poll(() =>
      window.evaluate(() => document.querySelector('webview:not(.hidden)')?.getURL() || '')
    )
    .toContain('/pages/home.html');

  const input = window.locator('[data-test="address-input"]');
  await input.fill(`web3://${ADDRESS}`);
  await input.press('Enter');

  await expect(input).toHaveValue(APP_URL);
  await expect(window.locator('#protocol-icon')).toHaveAttribute('data-protocol', 'onchain');
  await expect
    .poll(
      () =>
        window.evaluate(async () => {
          const webview = document.querySelector('webview:not(.hidden)');
          if (!webview?.executeJavaScript) return null;
          try {
            return await webview.executeJavaScript(
              `({
                title: document.title,
                text: document.getElementById('app')?.textContent || null,
                protocol: location.protocol,
                host: location.host
              })`
            );
          } catch {
            return null;
          }
        }),
      { timeout: 10_000, message: 'waiting for the web3: fixture to render' }
    )
    .toEqual({
      title: 'Onchain fixture',
      text: 'ERC-8244 fixture',
      protocol: 'web3:',
      host: `${ADDRESS}.eip155-1`,
    });
});
