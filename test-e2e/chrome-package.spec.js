const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
const fixturePackageDir = path.join(repoRoot, 'test', 'fixtures', 'chrome-packages', 'minimal');
const rendererSourceDir = path.join(repoRoot, 'src', 'renderer');
const sampleBzzHash = 'a'.repeat(64);
const sampleIpfsCid = `bafybeib${'a'.repeat(51)}`;
const sampleIpnsName = 'example.ipns';
const sampleRadicleRid = 'z3gqcJUoA1n9HaHKufZs5FCSGazv5';

function hashFileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listPackageFiles(root) {
  const files = [];
  const visit = (relativeDir = '') => {
    const absoluteDir = path.join(root, relativeDir);
    for (const name of fs.readdirSync(absoluteDir).sort()) {
      if (name === 'manifest.json') continue;
      const relativePath = path.posix.join(relativeDir.replace(/\\/g, '/'), name);
      const absolutePath = path.join(root, relativePath);
      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) {
        visit(relativePath);
      } else if (stat.isFile()) {
        files.push({
          path: relativePath,
          sha256: hashFileSha256(absolutePath),
        });
      }
    }
  };
  visit();
  return files;
}

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
    ...(options.includeFiles === false ? {} : { files: listPackageFiles(root) }),
    ...manifestOverrides,
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function writeOfficialChromePackage(root) {
  fs.cpSync(rendererSourceDir, root, {
    recursive: true,
    filter(source) {
      return !source.endsWith('.test.js');
    },
  });
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        manifestVersion: 1,
        packageType: 'browser-chrome',
        packageId: 'baby.freedom.chrome.official-local',
        name: 'Freedom Official Local Chrome',
        version: '0.0.1',
        entry: 'index.html',
        shellCompatibility: {
          minShellApi: '0.1.0',
          maxShellApi: '0.1.x',
        },
        files: listPackageFiles(root),
        capabilities: ['shell.info', 'shell.ready', 'navigation.resolve'],
        guestContent: {
          transitionalWebviews: true,
        },
      },
      null,
      2
    )
  );
}

function installRendererErrorCapture(page) {
  const errors = [];
  const record = (label, value) => {
    const text = String(value || '');
    if (/The WebView must be attached to the DOM and the dom-ready event emitted/i.test(text)) {
      return;
    }
    if (/Electron Security Warning/i.test(text)) {
      return;
    }
    errors.push(`${label}: ${text}`);
  };

  page.on('pageerror', (error) => {
    record('pageerror', error?.message || error);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    record('console error', message.text());
  });

  return {
    assertClean() {
      expect(errors).toEqual([]);
    },
  };
}

async function getActiveWebviewHomeStatus(page) {
  return page.evaluate(async () => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview || typeof webview.executeJavaScript !== 'function') {
      return 'no-active-webview';
    }

    try {
      return await webview.executeJavaScript(`
        (async () => {
          const loadImage = (url) => new Promise((resolve) => {
            if (!url) {
              resolve(false);
              return;
            }
            const image = new Image();
            let settled = false;
            const finish = (value) => {
              if (settled) return;
              settled = true;
              resolve(value);
            };
            image.onload = () => finish(image.naturalWidth > 0);
            image.onerror = () => finish(false);
            image.src = url;
            if (image.complete) {
              finish(image.naturalWidth > 0);
            }
            setTimeout(() => finish(false), 1000);
          });

          const backgroundImage = getComputedStyle(document.body, '::before').backgroundImage;
          const match = backgroundImage.match(/url\\(["']?(.*?)["']?\\)/);
          const backgroundUrl = match ? match[1] : '';
          const backgroundLoaded = await loadImage(backgroundUrl);

          if (!location.href.includes('/pages/home.html')) {
            return 'unexpected-url:' + location.href;
          }
          if (!backgroundImage.includes('images/home.png')) {
            return 'missing-background-css:' + backgroundImage;
          }
          if (!backgroundLoaded) {
            return 'background-not-loaded:' + backgroundUrl;
          }
          if (!document.body.textContent.includes('The decentralized web is here')) {
            return 'missing-home-copy';
          }
          return 'ready';
        })()
      `);
    } catch (error) {
      return `execute-js-failed:${error?.message || error}`;
    }
  });
}

async function getActiveWebviewUrl(page) {
  return page.evaluate(async () => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview || typeof webview.executeJavaScript !== 'function') return '';
    try {
      return await webview.executeJavaScript('location.href');
    } catch {
      return '';
    }
  });
}

async function getActiveWebviewText(page, selector) {
  return page.evaluate(async (targetSelector) => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview || typeof webview.executeJavaScript !== 'function') return null;
    try {
      return await webview.executeJavaScript(`
        document.querySelector(${JSON.stringify(targetSelector)})?.textContent || null
      `);
    } catch {
      return null;
    }
  }, selector);
}

async function expectHomeReady(page) {
  await expect
    .poll(() => getActiveWebviewHomeStatus(page), {
      message: 'Waiting for package home page and background asset',
      timeout: 10_000,
    })
    .toBe('ready');
}

async function expectActiveWebviewText(page, selector, expectedText) {
  await expect
    .poll(() => getActiveWebviewText(page, selector), {
      message: `Waiting for active webview text ${selector}`,
      timeout: 10_000,
    })
    .toBe(expectedText);
}

async function installRendererAlertCapture(page) {
  await page.evaluate(() => {
    window.__freedomTestAlerts = [];
    window.alert = (message) => {
      window.__freedomTestAlerts.push(String(message));
    };
  });
}

async function expectRendererAlert(page, pattern) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          return (window.__freedomTestAlerts || []).join('\n');
        }),
      {
        message: `Waiting for renderer alert matching ${pattern}`,
        timeout: 10_000,
      }
    )
    .toMatch(pattern);
}

async function navigateAddress(page, value, expectedValue = value) {
  const input = page.locator('[data-test="address-input"]');
  await input.click();
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toHaveValue(expectedValue);
}

async function setContentFixture(app, url, fixture) {
  await app.evaluate(({ ipcMain: _ipcMain }, payload) => {
    globalThis.__FREEDOM_TEST_HARNESS__.setContentFixture(payload.url, payload.fixture);
  }, { url, fixture });
}

async function setEnsFixture(app, name, result) {
  await app.evaluate(({ ipcMain: _ipcMain }, payload) => {
    globalThis.__FREEDOM_TEST_HARNESS__.setEnsFixture(payload.name, payload.result);
  }, { name, result });
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
        'resolveEns',
        'invalidateEnsContent',
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

test('official browser chrome can launch as a local package with transitional webviews', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-official-package-'));
  const packageDir = path.join(parent, 'official');
  writeOfficialChromePackage(packageDir);

  const launched = await launchFreedom({
    FREEDOM_CHROME_PACKAGE_DIR: packageDir,
  });
  try {
    const page = await launched.app.firstWindow();
    const rendererErrors = installRendererErrorCapture(page);

    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-test="address-input"]', { state: 'visible' });
    await expect(page.locator('body')).toHaveAttribute('data-package-ready', 'true');

    const exposure = await page.evaluate(() => ({
      hasFreedomShell: typeof window.freedomShell === 'object',
      hasElectronAPI: 'electronAPI' in window,
      hasInternalPages: 'internalPages' in window,
      hasWallet: 'wallet' in window,
      hasIdentity: 'identity' in window,
      hasSwarmProvider: 'swarmProvider' in window,
      hasSwarmPermissions: 'swarmPermissions' in window,
      hasDappPermissions: 'dappPermissions' in window,
    }));
    expect(exposure).toEqual({
      hasFreedomShell: true,
      hasElectronAPI: false,
      hasInternalPages: false,
      hasWallet: false,
      hasIdentity: false,
      hasSwarmProvider: false,
      hasSwarmPermissions: false,
      hasDappPermissions: false,
    });

    await expect(page.locator('[data-test="address-input"]')).toBeVisible();
    await expect(page.locator('[data-test="new-tab-btn"]')).toBeVisible();
    await expect(page.locator('[data-test="tab"]')).toHaveCount(1);
    await expectHomeReady(page);
    await page.locator('#reload-btn').click();
    await expectHomeReady(page);

    await page.locator('#menu-button').click();
    await expect(page.locator('#menu-dropdown')).toHaveClass(/open/);
    await page.locator('#menu-button').click();
    await expect(page.locator('#menu-dropdown')).not.toHaveClass(/open/);

    await page.locator('#bee-menu-button').click();
    await expect(page.locator('#bee-menu-dropdown')).toHaveClass(/open/);
    await page.locator('#bee-menu-button').click();
    await expect(page.locator('#bee-menu-dropdown')).not.toHaveClass(/open/);

    await page.locator('[data-test="new-tab-btn"]').click();
    await expect(page.locator('[data-test="tab"]')).toHaveCount(2);
    await expect(page.locator('[data-test="tab"][data-tab-id="2"]')).toHaveClass(/active/);
    await page.locator('[data-test="tab"][data-tab-id="1"]').click();
    await expect(page.locator('[data-test="tab"][data-tab-id="1"]')).toHaveClass(/active/);
    await page.locator('[data-test="tab"][data-tab-id="2"] [data-test="tab-close"]').click();
    await expect(page.locator('[data-test="tab"]')).toHaveCount(1);

    await navigateAddress(page, 'example.com', 'https://example.com');
    await expectActiveWebviewText(
      page,
      '[data-test="harness-http-stub-url"]',
      'https://example.com/'
    );

    await navigateAddress(page, 'http://example.test/path');
    await expectActiveWebviewText(
      page,
      '[data-test="harness-http-stub-url"]',
      'http://example.test/path'
    );

    await navigateAddress(page, 'https://example.net/path');
    await expectActiveWebviewText(
      page,
      '[data-test="harness-http-stub-url"]',
      'https://example.net/path'
    );

    await setContentFixture(launched.app, `bzz://${sampleBzzHash}/`, {
      body: '<!doctype html><title>bzz fixture</title><p data-test="package-dweb">bzz fixture</p>',
    });
    await setContentFixture(launched.app, `ipfs://${sampleIpfsCid}/`, {
      body:
        '<!doctype html><title>ipfs fixture</title><p data-test="package-dweb">ipfs fixture</p>',
    });
    await setContentFixture(launched.app, `ipns://${sampleIpnsName}/`, {
      body:
        '<!doctype html><title>ipns fixture</title><p data-test="package-dweb">ipns fixture</p>',
    });
    await setEnsFixture(launched.app, 'vitalik.eth', {
      type: 'ok',
      name: 'vitalik.eth',
      protocol: 'ipfs',
      decoded: sampleIpfsCid,
      uri: `ipfs://${sampleIpfsCid}`,
      trust: {
        level: 'verified',
        status: 'ENS resolution verified',
      },
    });
    await setContentFixture(launched.app, 'ipfs://vitalik.eth/', {
      body:
        '<!doctype html><title>ens fixture</title><p data-test="package-dweb">ens fixture</p>',
    });
    await setEnsFixture(launched.app, 'mismatch.eth', {
      type: 'ok',
      name: 'mismatch.eth',
      protocol: 'ipfs',
      decoded: sampleIpfsCid,
      uri: `ipfs://${sampleIpfsCid}`,
      trust: {
        level: 'verified',
        status: 'ENS resolution verified',
      },
    });
    await setEnsFixture(launched.app, 'conflict.eth', {
      type: 'conflict',
      name: 'conflict.eth',
      trust: {
        level: 'conflict',
        block: {
          number: 123,
          hash: '0xabc1230000000000000000000000000000000000000000000000000000000000',
        },
      },
      groups: [
        { resolvedData: '0x1111', urls: ['https://rpc-a.example'] },
        { resolvedData: '0x2222', urls: ['https://rpc-b.example'] },
      ],
    });

    await navigateAddress(page, `ipfs://${sampleIpfsCid}/`);
    await expectActiveWebviewText(page, '[data-test="package-dweb"]', 'ipfs fixture');

    await navigateAddress(page, `ipns://${sampleIpnsName}/`);
    await expectActiveWebviewText(page, '[data-test="package-dweb"]', 'ipns fixture');

    await navigateAddress(page, `bzz://${sampleBzzHash}/`);
    await expectActiveWebviewText(page, '[data-test="package-dweb"]', 'bzz fixture');

    const input = page.locator('[data-test="address-input"]');
    await input.click();
    await input.fill('vitalik.eth');
    await input.press('Enter');
    await expect(input).toHaveValue(/^ipfs:\/\/vitalik\.eth\/?$/);
    await expectActiveWebviewText(page, '[data-test="package-dweb"]', 'ens fixture');

    await installRendererAlertCapture(page);
    await input.click();
    await input.fill('bzz://mismatch.eth');
    await input.press('Enter');
    await expectRendererAlert(page, /resolves to ipfs, not bzz/);
    await expectActiveWebviewText(page, '[data-test="package-dweb"]', 'ens fixture');

    await input.click();
    await input.fill('conflict.eth');
    await input.press('Enter');
    await expect
      .poll(() => getActiveWebviewUrl(page), {
        message: 'Waiting for ENS conflict interstitial in package webview',
        timeout: 10_000,
      })
      .toContain('/pages/ens-conflict.html');
    await expectActiveWebviewText(page, '#name-el', 'conflict.eth');

    await input.click();
    await input.fill(`rad://${sampleRadicleRid}`);
    await input.press('Enter');
    await expect
      .poll(() => getActiveWebviewUrl(page), {
        message: 'Waiting for Radicle disabled interstitial in package webview',
        timeout: 10_000,
      })
      .toContain('/pages/rad-browser.html');
    await expect
      .poll(() => getActiveWebviewUrl(page), {
        message: 'Waiting for Radicle disabled error state',
        timeout: 10_000,
      })
      .toContain('error=disabled');
    await expectActiveWebviewText(page, '#display-rid', `rad://${sampleRadicleRid}`);
    await expectActiveWebviewText(
      page,
      '#radicle-disabled-error h2',
      'Radicle Integration Disabled'
    );

    await navigateAddress(page, 'freedom://settings');
    await expect
      .poll(() => getActiveWebviewUrl(page), {
        message: 'Waiting for freedom://settings to load in package webview',
        timeout: 10_000,
      })
      .toContain('/pages/settings.html');

    await navigateAddress(page, 'freedom://home', '');
    await expectHomeReady(page);

    await page.locator('#home-btn').click();
    await expectHomeReady(page);

    rendererErrors.assertClean();
  } finally {
    await launched.close();
    fs.rmSync(parent, { recursive: true, force: true });
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
      name: 'tampered package file',
      createPackageDir(parent) {
        const root = path.join(parent, 'tampered-file');
        writePackage(root);
        fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><h1>tampered</h1>');
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
