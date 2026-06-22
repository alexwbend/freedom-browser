const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const fixturePackageDir = path.join(repoRoot, 'test', 'fixtures', 'chrome-packages', 'minimal');

async function launchFreedom(extraEnv = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      FREEDOM_TEST_MODE: '1',
      FREEDOM_TEST_USER_DATA: userDataDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LANG: 'en_US.UTF-8',
      ...extraEnv,
    },
    timeout: 20_000,
  });

  return {
    app,
    async close() {
      try {
        await app.close();
      } catch {
        // Window may already have been closed by the spec.
      }
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

function writePackage(root, manifestOverrides = {}, options = {}) {
  fs.mkdirSync(root, { recursive: true });
  if (options.writeEntry !== false) {
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><h1>broken fixture</h1>');
  }
  const manifest = {
    manifestVersion: 1,
    packageType: 'browser-chrome',
    packageId: 'baby.freedom.chrome.broken-fixture',
    name: 'Broken Fixture Chrome',
    version: '0.0.1',
    entry: 'index.html',
    shellCompatibility: {
      minShellApi: '0.1.0',
      maxShellApi: '0.1.x',
    },
    ...manifestOverrides,
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function expectBundledChromeLoaded(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-test="address-input"]', { state: 'visible' });
  await expect(page.locator('[data-test="address-input"]')).toBeVisible();
  await expect(page.locator('[data-test="tab"]')).toHaveCount(1);
  await page.locator('#menu-button').click();
  await expect(page.locator('#menu-dropdown')).toHaveClass(/open/);
}

async function waitForBundledChromeWindow(app) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const windows = typeof app.windows === 'function' ? app.windows() : [];
    for (const candidate of windows) {
      if (!candidate || candidate.isClosed()) {
        continue;
      }
      try {
        await candidate.waitForSelector('[data-test="address-input"]', {
          state: 'visible',
          timeout: 500,
        });
        return candidate;
      } catch {
        // Keep polling; local package windows do not have bundled chrome selectors.
      }
    }

    const nextWindow = await app.waitForEvent('window', { timeout: 500 }).catch(() => null);
    if (nextWindow && !nextWindow.isClosed()) {
      try {
        await nextWindow.waitForSelector('[data-test="address-input"]', {
          state: 'visible',
          timeout: 500,
        });
        return nextWindow;
      } catch {
        // Keep polling until the replacement bundled window is ready.
      }
    }
  }

  throw new Error('Bundled chrome fallback window did not appear');
}

test('local package chrome loads through freedomShell without broad preload APIs', async () => {
  const launched = await launchFreedom({
    FREEDOM_CHROME_PACKAGE_DIR: fixturePackageDir,
  });
  try {
    const page = await launched.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-test="package-root"]', { state: 'visible' });

    await expect(page.locator('[data-test="package-title"]')).toHaveText('Freedom Fixture Chrome');
    await expect(page.locator('[data-test="shell-info-status"]')).toHaveText('local-package');
    await expect(page.locator('[data-test="broad-api-status"]')).toHaveText('absent');

    const exposure = await page.evaluate(() => ({
      hasFreedomShell: typeof window.freedomShell === 'object',
      freedomShellKeys: Object.keys(window.freedomShell || {}),
      hasElectronAPI: 'electronAPI' in window,
      hasWallet: 'wallet' in window,
      hasIdentity: 'identity' in window,
      hasSwarmProvider: 'swarmProvider' in window,
      hasSwarmPermissions: 'swarmPermissions' in window,
      hasDappPermissions: 'dappPermissions' in window,
    }));
    expect(exposure).toEqual({
      hasFreedomShell: true,
      freedomShellKeys: [
        'getInfo',
        'markReady',
        'resolveNavigationInput',
        'getTabSnapshot',
        'createTab',
        'closeTab',
        'activateTab',
        'navigateTab',
        'reloadTab',
        'goHome',
        'onTabCommandResult',
        'onTabSnapshotChanged',
      ],
      hasElectronAPI: false,
      hasWallet: false,
      hasIdentity: false,
      hasSwarmProvider: false,
      hasSwarmPermissions: false,
      hasDappPermissions: false,
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

    const info = JSON.parse(await page.locator('[data-test="shell-info-json"]').textContent());
    expect(info).toMatchObject({
      shellApiVersion: '0.1.0',
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
        name: 'Freedom Fixture Chrome',
        version: '0.0.1',
        source: 'local',
      },
    });

    await page.locator('[data-test="resolve-nav-button"]').click();
    await expect(page.locator('[data-test="resolve-nav-status"]')).toHaveText('https://example.com');
    const navigation = JSON.parse(await page.locator('[data-test="resolve-nav-json"]').textContent());
    expect(navigation).toMatchObject({
      ok: true,
      input: 'example.com',
      kind: 'https',
      targetUrl: 'https://example.com',
    });

    await expect(page.locator('[data-test="nav-matrix-status"]')).toHaveText('ok');
    const navMatrix = JSON.parse(
      await page.locator('[data-test="nav-matrix-json"]').textContent()
    );
    expect(navMatrix).toMatchObject({
      http: {
        ok: true,
        kind: 'http',
        targetUrl: 'http://example.com/path',
      },
      https: {
        ok: true,
        kind: 'https',
        targetUrl: 'https://example.com/path',
      },
      bareDomain: {
        ok: true,
        kind: 'https',
        targetUrl: 'https://example.com/path',
      },
      freedomHome: {
        ok: true,
        kind: 'internal',
        targetUrl: 'freedom://home',
      },
      freedomSettings: {
        ok: true,
        kind: 'internal',
        targetUrl: 'freedom://settings',
      },
      bzz: {
        ok: true,
        kind: 'swarm',
        protocol: 'bzz',
      },
      ipfs: {
        ok: true,
        kind: 'ipfs',
        protocol: 'ipfs',
      },
      ipns: {
        ok: true,
        kind: 'ipns',
        protocol: 'ipns',
      },
      ensBare: {
        ok: true,
        kind: 'ens',
        name: 'vitalik.eth',
        targetUrl: 'ens://vitalik.eth/docs',
      },
      ensTransportAssertion: {
        ok: true,
        kind: 'ens',
        name: 'meinhard.eth',
        assertedTransport: 'bzz',
        targetUrl: 'bzz://meinhard.eth/path',
      },
      radicle: {
        ok: true,
        kind: 'radicle',
        protocol: 'rad',
      },
    });

    await expect(page.locator('[data-test="tabs-status"]')).toHaveText('ok');
    const tabs = JSON.parse(await page.locator('[data-test="tabs-json"]').textContent());
    expect(tabs).toMatchObject({
      before: {
        activeTabId: 1,
        tabs: [expect.objectContaining({ id: 1, url: 'freedom://home', isActive: true })],
      },
      created: {
        ok: true,
        command: 'tabs.create',
        tabId: 2,
      },
      navigated: {
        ok: true,
        command: 'tabs.navigate',
        tabId: 2,
        url: 'https://example.net/path',
      },
      homed: {
        ok: true,
        command: 'tabs.goHome',
        tabId: 2,
        url: 'freedom://home',
      },
      activated: {
        ok: true,
        command: 'tabs.activate',
        tabId: 1,
      },
      missingClose: {
        ok: false,
        command: 'tabs.close',
        snapshotChanged: false,
        error: {
          code: 'TAB_NOT_FOUND',
          tabId: 9999,
        },
      },
      closed: {
        ok: true,
        command: 'tabs.close',
        tabId: 2,
        snapshotChanged: true,
        snapshot: {
          activeTabId: 1,
          tabs: [expect.objectContaining({ id: 1, isActive: true })],
        },
      },
      tabCommandEvents: expect.arrayContaining([
        expect.objectContaining({ ok: true, command: 'tabs.create', tabId: 2 }),
        expect.objectContaining({ ok: true, command: 'tabs.navigate', tabId: 2 }),
        expect.objectContaining({ ok: true, command: 'tabs.goHome', tabId: 2 }),
        expect.objectContaining({ ok: true, command: 'tabs.activate', tabId: 1 }),
        expect.objectContaining({ ok: false, command: 'tabs.close', snapshotChanged: false }),
        expect.objectContaining({ ok: true, command: 'tabs.close', tabId: 2 }),
      ]),
      tabSnapshotEvents: expect.arrayContaining([
        expect.objectContaining({ activeTabId: 2 }),
        expect.objectContaining({
          tabs: expect.arrayContaining([
            expect.objectContaining({ id: 2, url: 'https://example.net/path' }),
          ]),
        }),
        expect.objectContaining({
          tabs: expect.arrayContaining([
            expect.objectContaining({ id: 2, url: 'freedom://home' }),
          ]),
        }),
        expect.objectContaining({ activeTabId: 1 }),
        expect.objectContaining({ tabs: [expect.objectContaining({ id: 1, isActive: true })] }),
      ]),
    });
    expect(tabs.tabCommandEvents).toHaveLength(6);
    expect(tabs.tabSnapshotEvents).toHaveLength(5);
  } finally {
    await launched.close();
  }
});

test.describe('local package fallback', () => {
  const cases = [
    {
      name: 'missing package directory',
      createPackageDir(parent) {
        return path.join(parent, 'missing');
      },
    },
    {
      name: 'malformed manifest',
      createPackageDir(parent) {
        const root = path.join(parent, 'malformed');
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'manifest.json'), '{');
        return root;
      },
    },
    {
      name: 'incompatible manifest',
      createPackageDir(parent) {
        const root = path.join(parent, 'incompatible');
        writePackage(root, {
          shellCompatibility: {
            minShellApi: '9.0.0',
            maxShellApi: '9.0.x',
          },
        });
        return root;
      },
    },
    {
      name: 'missing entry file',
      createPackageDir(parent) {
        const root = path.join(parent, 'missing-entry');
        writePackage(root, { entry: 'missing.html' }, { writeEntry: false });
        return root;
      },
    },
    {
      name: 'package readiness timeout',
      env: {
        FREEDOM_CHROME_PACKAGE_READY_TIMEOUT_MS: '250',
      },
      createPackageDir(parent) {
        const root = path.join(parent, 'never-ready');
        writePackage(root);
        return root;
      },
    },
  ];

  for (const fallbackCase of cases) {
    test(`falls back to bundled chrome for ${fallbackCase.name}`, async () => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-broken-'));
      const packageDir = fallbackCase.createPackageDir(parent);
      const launched = await launchFreedom({
        FREEDOM_CHROME_PACKAGE_DIR: packageDir,
        ...(fallbackCase.env || {}),
      });
      try {
        const page = await waitForBundledChromeWindow(launched.app);
        await expectBundledChromeLoaded(page);
        await expect(page.locator('[data-test="package-root"]')).toHaveCount(0);
      } finally {
        await launched.close();
        fs.rmSync(parent, { recursive: true, force: true });
      }
    });
  }
});
