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
// Budget for warm-plus-margin — cold runs should pre-warm via smoke-myotis.js.
const READY_TIMEOUT_MS = 5 * 60 * 1000;

test.describe('myotis live ENS resolution', () => {
  test.skip(!MYOTIS_ENABLED, 'MYOTIS_NODE_PATH not set — myotis spike disabled');

  test('P2P node serves ENS and NameNFT records through Freedom; page renders', async ({
    electronApp,
    window: win,
  }) => {
    test.setTimeout(READY_TIMEOUT_MS + 120_000);

    // 1. Wait (in the app's main process) for the node to report ready and
    //    prove that a verified read is actually servable. A warm restart can
    //    briefly restore a SYNCED beacon snapshot before the live peer context
    //    needed by ENS reads has settled, so status alone is not sufficient.
    const managerPath = path.join(repoRoot, 'src', 'main', 'myotis', 'myotis-manager.js');
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let status;
    for (;;) {
      // eslint-disable-next-line no-empty-pattern
      status = await electronApp.evaluate(async ({}, p) => {
        // Playwright's evaluate sandbox has no `require` global; go through
        // the main process's own module system instead.
        const m = process.mainModule.require(p);
        const ready = m.isReady();
        let probe = null;
        if (ready) {
          try {
            probe = await m.resolveContenthash('vitalik.eth');
          } catch (err) {
            probe = { error: err.message };
          }
        }
        return { ready, probe, status: m.getStatus() };
      }, managerPath);
      if (status.ready && status.probe?.status === 'ok' && status.probe.verified === true) break;
      if (Date.now() > deadline) {
        throw new Error(
          `myotis never served a verified read; last state: ${JSON.stringify(status)}`
        );
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    console.log(
      '[myotis-e2e] node ready and direct read verified:',
      JSON.stringify({ status: status.status, probe: status.probe }).slice(0, 1000)
    );

    // 2. Resolve through the REAL resolver pipeline in the main process and
    //    assert the myotis tier carried the answer. The first read after
    //    readiness can still fail on a cold head context (the tier then
    //    falls through to colibri by design and the answer caches), so
    //    retry with cache invalidation until myotis carries it.
    const resolverPath = path.join(repoRoot, 'src', 'main', 'ens-resolver.js');
    let result;
    for (let attempt = 1; attempt <= 6; attempt++) {
      // eslint-disable-next-line no-empty-pattern
      result = await electronApp.evaluate(async ({}, p) => {
        const resolver = process.mainModule.require(p);
        resolver.invalidateEnsContent('vitalik.eth');
        return resolver.resolveEnsContent('vitalik.eth');
      }, resolverPath);
      console.log(
        `[myotis-e2e] resolution attempt ${attempt}: method=${result?.trust?.method} ` +
          JSON.stringify(result).slice(0, 300)
      );
      if (result?.trust?.method === 'myotis') break;
      await new Promise((r) => setTimeout(r, 15000));
    }

    expect(result.type).toBe('ok');
    expect(result.trust.method).toBe('myotis');
    expect(result.trust.level).toBe('verified');
    expect(result.protocol).toBe('ipfs');

    // 3. Exercise the other production integration surfaces through the same
    //    resolver module: ENS addr + forward-verified reverse, then WNS/GNS
    //    NameNFT calls through Myotis's generic local EVM executor. Finally,
    //    restore the default verified-answer preference and prove it promotes
    //    Colibri over Myotis's optimistic WNS/GNS answers.
    const registryPath = path.join(
      repoRoot,
      'src',
      'main',
      'networks',
      'network-registry.js'
    );
    const integration = await electronApp.evaluate(
      // eslint-disable-next-line no-empty-pattern
      async ({}, { p, registryPath: networkRegistryPath, vitalik }) => {
        const resolver = process.mainModule.require(p);
        const registry = process.mainModule.require(networkRegistryPath);
        resolver.clearEnsResolutionCaches();
        const ens = {
          address: await resolver.resolveEnsAddress('vitalik.eth'),
          reverse: await resolver.resolveEnsReverse(vitalik),
        };

        registry.updateNetwork(1, {
          verification: {
            primary: 'colibri',
            order: ['myotis', 'colibri', 'quorum'],
            preferVerified: false,
          },
        });
        resolver.clearEnsResolutionCaches();
        let myotis;
        try {
          myotis = {
            wns: await resolver.resolveEnsContent('meinhard.wei'),
            gns: await resolver.resolveEnsContent('apoorv.gwei'),
          };
        } finally {
          registry.updateNetwork(1, {
            verification: {
              primary: 'colibri',
              order: ['myotis', 'colibri', 'quorum'],
              preferVerified: true,
            },
          });
          resolver.clearEnsResolutionCaches();
        }

        return {
          ...ens,
          myotis,
          preferred: {
            wns: await resolver.resolveEnsContent('meinhard.wei'),
            gns: await resolver.resolveEnsContent('apoorv.gwei'),
          },
        };
      },
      {
        p: resolverPath,
        registryPath,
        vitalik: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      }
    );
    console.log('[myotis-e2e] integrated record reads:', JSON.stringify(integration).slice(0, 1500));

    expect(integration.address).toMatchObject({
      success: true,
      system: 'ens',
      trust: { method: 'myotis', level: 'verified' },
    });
    expect(integration.address.address.toLowerCase()).toBe(
      '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
    );
    expect(integration.reverse).toMatchObject({
      success: true,
      name: 'vitalik.eth',
      system: 'ens',
      trust: { method: 'myotis', level: 'verified' },
    });
    expect(integration.myotis.wns).toMatchObject({
      type: 'ok',
      system: 'wns',
      trust: { method: 'myotis', level: 'unverified' },
    });
    expect(integration.myotis.gns).toMatchObject({
      type: 'ok',
      system: 'gns',
      trust: { method: 'myotis', level: 'unverified' },
    });
    expect(integration.preferred.wns).toMatchObject({
      type: 'ok',
      system: 'wns',
      trust: { method: 'colibri', level: 'verified' },
    });
    expect(integration.preferred.gns).toMatchObject({
      type: 'ok',
      system: 'gns',
      trust: { method: 'colibri', level: 'verified' },
    });

    // 4. Drive the UI: navigate to the name and let the page render through
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
