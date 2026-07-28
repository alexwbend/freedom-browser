// Live E2E for the experimental Myotis tier: the fully-P2P light client
// resolving ENS inside the real app. Requires the myotis-node addon
// (MYOTIS_NODE_PATH) and network access; ideally MYOTIS_DATA_DIR points at a
// warm data dir (a prior sync) so readiness arrives in seconds, not minutes.
//
//   MYOTIS_NODE_PATH=/path/to/myotis-node.node \
//   MYOTIS_DATA_DIR=/path/to/warm-data \
//   npx playwright test --project=live myotis-ens
const path = require('path');
const { test, expect } = require('../live-fixtures');

const repoRoot = path.resolve(__dirname, '..', '..');
const MYOTIS_ENABLED = Boolean(process.env.MYOTIS_NODE_PATH);

// Cold sync can take many minutes; a warm data dir reaches ready in ~10-30 s.
// Budget for warm-plus-margin — cold runs should pre-warm via smoke.mjs.
const READY_TIMEOUT_MS = 5 * 60 * 1000;

test.describe('myotis live ENS resolution', () => {
  test.skip(!MYOTIS_ENABLED, 'MYOTIS_NODE_PATH not set — myotis spike disabled');

  test('P2P node reaches ready; resolver serves vitalik.eth with myotis trust; page renders', async ({
    electronApp,
    window: win,
  }) => {
    test.setTimeout(READY_TIMEOUT_MS + 120_000);

    // 1. Wait (in the app's main process) for the node to report ready.
    const managerPath = path.join(repoRoot, 'src', 'main', 'myotis', 'myotis-manager.js');
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let status;
    for (;;) {
      // eslint-disable-next-line no-empty-pattern
      status = await electronApp.evaluate(({}, p) => {
        // Playwright's evaluate sandbox has no `require` global; go through
        // the main process's own module system instead.
        const m = process.mainModule.require(p);
        return { ready: m.isReady(), status: m.getStatus() };
      }, managerPath);
      if (status.ready) break;
      if (Date.now() > deadline) {
        throw new Error(`myotis never reached ready; last status: ${JSON.stringify(status.status)}`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    console.log('[myotis-e2e] node ready:', JSON.stringify(status.status));

    // 2. Resolve through the REAL resolver pipeline in the main process and
    //    assert the myotis tier carried the answer.
    const resolverPath = path.join(repoRoot, 'src', 'main', 'ens-resolver.js');
    // eslint-disable-next-line no-empty-pattern
    const result = await electronApp.evaluate(async ({}, p) => {
      const { resolveEnsContent } = process.mainModule.require(p);
      return resolveEnsContent('vitalik.eth');
    }, resolverPath);
    console.log('[myotis-e2e] resolution:', JSON.stringify(result).slice(0, 400));

    expect(result.type).toBe('ok');
    expect(result.trust.method).toBe('myotis');
    expect(result.trust.level).toBe('verified');
    expect(result.protocol).toBe('ipfs');

    // 3. Drive the UI: navigate to the name and let the page render through
    //    the local IPFS gateway (same assertion style as eth-sites.spec.js).
    await win.fill('[data-test="address-input"]', 'vitalik.eth');
    await win.press('[data-test="address-input"]', 'Enter');
    await win.waitForFunction(
      () => {
        const webview = document.querySelector('webview.active, webview');
        return Boolean(webview && webview.getURL && webview.getURL().length > 0);
      },
      { timeout: 90_000 }
    );
    const url = await win.evaluate(() => {
      const webview = document.querySelector('webview.active, webview');
      return webview?.getURL?.() || '';
    });
    console.log('[myotis-e2e] webview url:', url);
    expect(url).toBeTruthy();
  });
});
