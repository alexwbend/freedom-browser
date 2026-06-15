// navigator.freedom — verifies the capability façade is injected
// into a real page realm and behaves per spec. Navigates to the
// freedom://playground internal page (loaded in a webview, where the preload
// injects the providers) and drives navigator.freedom via the guest's
// executeJavaScript.
//
// Provider round-trips that need a live node (capabilities → swarm) are made
// deterministic by stubbing window.swarm.getCapabilities in the guest — the
// façade reads it at call time, so the stub is honored without touching the
// main process.

const { test, expect } = require('./fixtures');

// Run an expression in the active webview's guest realm and return its
// (awaited) value. The host renderer can call <webview>.executeJavaScript,
// which resolves promises and structured-clones the result back.
//
// The webview element can briefly detach/re-attach during tab churn, so the
// lookup is retried for a short window rather than failing on the first miss.
async function runInGuest(window, expression) {
  return window.evaluate(
    async ({ code, deadlineMs }) => {
      const findWebview = () =>
        document.querySelector('webview.active, webview:not(.hidden)');
      const start = Date.now();
      let wv = findWebview();
      while ((!wv || !wv.executeJavaScript) && Date.now() - start < deadlineMs) {
        await new Promise((r) => setTimeout(r, 50));
        wv = findWebview();
      }
      if (!wv || !wv.executeJavaScript) throw new Error('no active webview');
      return wv.executeJavaScript(code);
    },
    { code: expression, deadlineMs: 2000 }
  );
}

async function gotoPlayground(window) {
  const input = window.locator('[data-test="address-input"]');
  await input.click();
  await input.fill('freedom://playground');
  await input.press('Enter');

  // Wait for the guest to actually load the playground document.
  await expect
    .poll(
      () =>
        window.evaluate(() => {
          const wv = document.querySelector('webview.active, webview:not(.hidden)');
          return wv?.getURL?.() || wv?.getAttribute?.('src') || '';
        }),
      { timeout: 10_000, intervals: [200, 500, 1000] }
    )
    .toMatch(/pages\/playground\.html/);

  // And for the injected namespace to be present in that realm.
  await expect
    .poll(() => runInGuest(window, 'typeof navigator.freedom'), {
      timeout: 10_000,
      intervals: [200, 500, 1000],
    })
    .toBe('object');
}

test.describe('navigator.freedom', () => {
  test('is injected with the expected surface and version', async ({ window }) => {
    await gotoPlayground(window);

    const shape = await runInGuest(
      window,
      `JSON.stringify({
        version: navigator.freedom.version,
        capabilities: typeof navigator.freedom.capabilities,
        walletRequest: typeof navigator.freedom.wallet.request,
        storageUpload: typeof navigator.freedom.storage.upload,
        storageSwarmUpload: typeof navigator.freedom.storage.swarm.upload,
        storageIpfsAdd: typeof navigator.freedom.storage.ipfs.add,
        dwebResolve: typeof navigator.freedom.dweb.resolve,
        permsQuery: typeof navigator.freedom.permissions.query,
        permsRequest: typeof navigator.freedom.permissions.request,
      })`
    );

    expect(JSON.parse(shape)).toEqual({
      version: '0.3',
      capabilities: 'function',
      walletRequest: 'function',
      storageUpload: 'function',
      storageSwarmUpload: 'function',
      storageIpfsAdd: 'function',
      dwebResolve: 'function',
      permsQuery: 'function',
      permsRequest: 'function',
    });
  });

  test('capabilities() reports honest availability (swarm enabled, ipfs unsupported)', async ({
    window,
  }) => {
    await gotoPlayground(window);

    const caps = await runInGuest(
      window,
      `(async () => {
        // Make the swarm capability probe deterministic without a live node.
        window.swarm.getCapabilities = () => Promise.resolve({ canPublish: true, reason: null });
        const c = await navigator.freedom.capabilities();
        return JSON.stringify(c);
      })()`
    );

    const parsed = JSON.parse(caps);
    expect(parsed.wallet.available).toBe(true);
    expect(parsed.storage.swarm.available).toBe(true);
    expect(parsed.storage.ipfs.available).toBe(false);
    expect(parsed.storage.ipfs.reason).toBe('write-not-supported');
    expect(parsed.dweb.available).toBe(true);
    expect(parsed.dweb.protocols).toEqual(['bzz', 'ipfs', 'ipns', 'ens']);
    expect(parsed.runtime.available).toBe(false);
  });

  test('capabilities() reflects the disabled Identity & Wallet gate', async ({ window }) => {
    await gotoPlayground(window);

    const caps = await runInGuest(
      window,
      `(async () => {
        const err = new Error('Swarm provider is not available');
        err.code = 4900;
        window.swarm.getCapabilities = () => Promise.reject(err);
        const c = await navigator.freedom.capabilities();
        return JSON.stringify(c);
      })()`
    );

    const parsed = JSON.parse(caps);
    expect(parsed.wallet.available).toBe(false);
    expect(parsed.wallet.reason).toBe('identity-wallet-disabled');
    expect(parsed.storage.swarm.available).toBe(false);
    expect(parsed.storage.swarm.reason).toBe('identity-wallet-disabled');
  });

  test('storage.upload rejects ipfs with NotSupportedError', async ({ window }) => {
    await gotoPlayground(window);

    const result = await runInGuest(
      window,
      `(async () => {
        try {
          await navigator.freedom.storage.upload({ data: 'x', network: 'ipfs' });
          return JSON.stringify({ resolved: true });
        } catch (e) {
          return JSON.stringify({ name: e.name, reason: e.reason });
        }
      })()`
    );

    expect(JSON.parse(result)).toEqual({ name: 'NotSupportedError', reason: 'write-not-supported' });
  });

  test('storage.upload validates its arguments', async ({ window }) => {
    await gotoPlayground(window);

    const result = await runInGuest(
      window,
      `(async () => {
        const out = {};
        try { await navigator.freedom.storage.upload({ network: 'swarm' }); }
        catch (e) { out.missingData = e.name; }
        try { await navigator.freedom.storage.upload({ data: 'x', network: 'nope' }); }
        catch (e) { out.badNetwork = e.name; }
        return JSON.stringify(out);
      })()`
    );

    expect(JSON.parse(result)).toEqual({ missingData: 'TypeError', badNetwork: 'TypeError' });
  });

  test('dweb.resolve maps an ENS contenthash to { protocol, hash, url }', async ({
    window,
    harness,
  }) => {
    await harness.setEnsFixture('workshop.eth', {
      type: 'ok',
      name: 'workshop.eth',
      codec: 'swarm-ns',
      protocol: 'bzz',
      decoded: 'abc123def',
      uri: 'bzz://abc123def',
    });
    await gotoPlayground(window);

    const result = await runInGuest(
      window,
      `(async () => {
        try {
          const r = await navigator.freedom.dweb.resolve('workshop.eth');
          return JSON.stringify({ ok: true, r });
        } catch (e) {
          return JSON.stringify({ ok: false, name: e.name, message: e.message });
        }
      })()`
    );

    expect(JSON.parse(result)).toEqual({
      ok: true,
      r: { protocol: 'bzz', hash: 'abc123def', url: 'bzz://abc123def' },
    });
  });

  test('dweb.resolve rejects an unresolvable name with NetworkError', async ({ window }) => {
    await gotoPlayground(window);

    const result = await runInGuest(
      window,
      `(async () => {
        try {
          await navigator.freedom.dweb.resolve('definitely-not-registered-xyz.eth');
          return JSON.stringify({ resolved: true });
        } catch (e) {
          return JSON.stringify({ name: e.name });
        }
      })()`
    );

    expect(JSON.parse(result)).toEqual({ name: 'NetworkError' });
  });

  test('dweb.resolve rejects a missing name with TypeError', async ({ window }) => {
    await gotoPlayground(window);

    const result = await runInGuest(
      window,
      `(async () => {
        try {
          await navigator.freedom.dweb.resolve();
          return JSON.stringify({ resolved: true });
        } catch (e) {
          return JSON.stringify({ name: e.name });
        }
      })()`
    );

    expect(JSON.parse(result)).toEqual({ name: 'TypeError' });
  });

  test('permissions.query maps registry names and rejects unknown ones', async ({ window }) => {
    await gotoPlayground(window);

    const result = await runInGuest(
      window,
      `(async () => {
        const out = {};
        out.dweb = (await navigator.freedom.permissions.query({ name: 'dweb.name-resolution' })).state;
        out.ipfs = (await navigator.freedom.permissions.query({ name: 'storage.ipfs.write' })).state;
        out.runtime = (await navigator.freedom.permissions.query({ name: 'runtime.status' })).state;
        out.swarm = (await navigator.freedom.permissions.query({ name: 'storage.swarm.write' })).state;
        try {
          await navigator.freedom.permissions.query({ name: 'wallet.teleport' });
          out.unknown = 'resolved';
        } catch (e) {
          out.unknown = e.name;
        }
        return JSON.stringify(out);
      })()`
    );

    expect(JSON.parse(result)).toEqual({
      dweb: 'granted',
      ipfs: 'denied',
      runtime: 'denied',
      swarm: 'prompt',
      unknown: 'TypeError',
    });
  });
});
