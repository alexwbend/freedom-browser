const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const defaultBookmarks = require('../config/default-bookmarks.json');

const repoRoot = path.resolve(__dirname, '..');
const fixturePackageDir = path.join(repoRoot, 'test', 'fixtures', 'chrome-packages', 'minimal');
const rendererSourceDir = path.join(repoRoot, 'src', 'renderer');
const sampleBzzHash = 'a'.repeat(64);
const sampleIpfsCid = `bafybeib${'a'.repeat(51)}`;
const providerIpfsCid = `bafybeib${'b'.repeat(51)}`;
const sampleIpnsName = 'example.ipns';
const sampleRadicleRid = 'z3gqcJUoA1n9HaHKufZs5FCSGazv5';
const faviconFixtureBytes = Buffer.from('package-favicon-fixture', 'utf8');

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

async function launchFreedom(extraEnv = {}, options = {}) {
  const userDataDir =
    options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-e2e-'));
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
      if (options.preserveUserData !== true) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    },
  };
}

function startFaviconFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Favicon Fixture</title><link rel="icon" href="/icon.png">');
        return;
      }
      if (req.url === '/icon.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(faviconFixtureBytes);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        async close() {
          await new Promise((closeResolve) => server.close(closeResolve));
        },
      });
    });
  });
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

function copyFixturePackage(root, manifestOverrides = {}) {
  fs.cpSync(fixturePackageDir, root, { recursive: true });
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = {
    ...JSON.parse(fs.readFileSync(manifestPath, 'utf-8')),
    ...manifestOverrides,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

function writeLocalPackageFeed(feedPath, packageDirs, overrides = {}) {
  const feedRoot = path.dirname(feedPath);
  fs.mkdirSync(feedRoot, { recursive: true });
  const packages = packageDirs.map((packageDir) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf-8'));
    return {
      version: manifest.version,
      source: {
        type: 'directory',
        path: path.relative(feedRoot, packageDir).replace(/\\/g, '/'),
      },
    };
  });
  fs.writeFileSync(
    feedPath,
    JSON.stringify(
      {
        feedVersion: 1,
        packageId: 'baby.freedom.chrome.fixture',
        channel: 'test',
        packages,
        ...overrides,
      },
      null,
      2
    )
  );
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
        capabilities: [
          'shell.info',
          'shell.ready',
          'navigation.resolve',
          'browserState.settings.read',
          'browserState.settings.write',
          'browserState.bookmarks.read',
          'browserState.bookmarks.write',
          'browserState.history.read',
          'browserState.history.write',
          'browserState.favicons.read',
          'browserState.favicons.write',
          'browserState.profiles.read',
          'services.read',
          'chrome.ui.commands',
          'clipboard.write',
          'downloads.saveImage',
          'windows.control',
          'windows.open',
          'app.about',
          'app.updates',
        ],
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

async function showActiveWebviewContextMenu(page, context) {
  await page.evaluate((payload) => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview) {
      throw new Error('No active webview');
    }
    const event = new Event('ipc-message');
    Object.defineProperty(event, 'channel', { value: 'context-menu' });
    Object.defineProperty(event, 'args', {
      value: [
        {
          x: 8,
          y: 8,
          ...payload,
        },
      ],
    });
    webview.dispatchEvent(event);
  }, context);
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

async function readShellInfo(page) {
  return JSON.parse(await page.locator('[data-test="shell-info-json"]').textContent());
}

async function emitActiveWindowRendererGone(app, reason = 'crashed') {
  await app.evaluate(({ BrowserWindow }, payload) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window) {
      throw new Error('No active browser window to mark unhealthy');
    }
    window.webContents.emit('render-process-gone', {}, { reason: payload.reason });
  }, { reason });
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

async function clickVisibleMainMenuItem(page, selector) {
  await page.locator('#menu-button').click();
  await expect(page.locator('#menu-dropdown')).toHaveClass(/open/);
  await expect(page.locator(selector)).toBeVisible();
  await page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) {
      throw new Error(`Missing menu item: ${targetSelector}`);
    }
    element.click();
  }, selector);
}

async function clickApplicationMenuItem(app, itemId) {
  await app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item) {
      throw new Error(`Missing application menu item: ${id}`);
    }
    if (item.enabled === false) {
      throw new Error(`Application menu item is disabled: ${id}`);
    }
    item.click();
  }, itemId);
}

async function getApplicationMenuItemStates(app, itemIds) {
  return app.evaluate(({ Menu }, ids) => {
    const menu = Menu.getApplicationMenu();
    return Object.fromEntries(
      ids.map((id) => {
        const item = menu?.getMenuItemById(id);
        return [
          id,
          item
            ? {
                enabled: item.enabled,
                checked: item.checked,
              }
            : null,
        ];
      })
    );
  }, itemIds);
}

async function clearClipboardText(app) {
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText('');
  });
}

async function getClipboardText(app) {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

async function installMainWindowFullScreenRecorder(app) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.__freedomTestFullScreenRecorderInstalled) {
        continue;
      }

      const originalIsFullScreen = window.isFullScreen.bind(window);
      const originalSetFullScreen = window.setFullScreen.bind(window);
      window.__freedomTestFullScreenRecorderInstalled = true;
      window.__freedomTestFullScreen = originalIsFullScreen();
      window.__freedomTestFullScreenCalls = [];
      window.isFullScreen = () => window.__freedomTestFullScreen;
      window.setFullScreen = (value) => {
        const nextValue = Boolean(value);
        window.__freedomTestFullScreen = nextValue;
        window.__freedomTestFullScreenCalls.push(nextValue);
        return originalSetFullScreen(nextValue);
      };
    }
  });
}

async function getMainWindowFullScreenCalls(app) {
  return app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()
      .filter((candidate) => !candidate.isDestroyed())
      .flatMap((window) => window.__freedomTestFullScreenCalls || []);
  });
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

async function waitForPackageChromeWindow(app, expected) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const windows = typeof app.windows === 'function' ? app.windows() : [];
    for (const candidate of windows) {
      if (!candidate || candidate.isClosed()) {
        continue;
      }
      try {
        await candidate.waitForSelector('[data-test="package-root"]', {
          state: 'visible',
          timeout: 500,
        });
        const info = JSON.parse(
          await candidate.locator('[data-test="shell-info-json"]').textContent()
        );
        if (
          (!expected?.version || info.chromePackage?.version === expected.version) &&
          (!expected?.source || info.chromePackage?.source === expected.source)
        ) {
          return candidate;
        }
      } catch {
        // Keep polling; failing package windows may not expose fixture package selectors.
      }
    }

    const nextWindow = await app.waitForEvent('window', { timeout: 500 }).catch(() => null);
    if (nextWindow && !nextWindow.isClosed()) {
      try {
        await nextWindow.waitForSelector('[data-test="package-root"]', {
          state: 'visible',
          timeout: 500,
        });
        const info = JSON.parse(
          await nextWindow.locator('[data-test="shell-info-json"]').textContent()
        );
        if (
          (!expected?.version || info.chromePackage?.version === expected.version) &&
          (!expected?.source || info.chromePackage?.source === expected.source)
        ) {
          return nextWindow;
        }
      } catch {
        // Keep polling until the replacement package window is ready.
      }
    }
  }

  throw new Error('Package chrome window did not appear');
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
      hasAnt: 'ant' in window,
      hasIpfs: 'ipfs' in window,
      hasRadicle: 'radicle' in window,
      hasServiceRegistry: 'serviceRegistry' in window,
      hasNodeConfig: 'nodeConfig' in window,
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
        'getSettings',
        'saveSettings',
        'getBookmarks',
        'addBookmark',
        'updateBookmark',
        'removeBookmark',
        'getHistory',
        'addHistory',
        'removeHistory',
        'clearHistory',
        'getFavicon',
        'getCachedFavicon',
        'fetchFavicon',
        'fetchFaviconWithKey',
        'getActiveProfile',
        'listProfiles',
        'getServiceRegistry',
        'getServiceStatus',
        'checkServiceBinary',
        'getSurfaceState',
        'openSurface',
        'closeSurface',
        'toggleSurface',
        'requestTestTrustedPrompt',
        'setWindowTitle',
        'closeWindow',
        'minimizeWindow',
        'maximizeWindow',
        'toggleFullscreen',
        'newWindow',
        'openUrlInNewWindow',
        'showAbout',
        'checkForUpdates',
        'restartAndInstallUpdate',
        'updateTabMenuState',
        'setBookmarkBarToggleEnabled',
        'setBookmarkBarChecked',
        'copyText',
        'copyImageFromUrl',
        'saveImage',
        'onTabCommandResult',
        'onTabSnapshotChanged',
        'onCloseMenusRequested',
        'onFocusAddressBarRequested',
        'onToggleDevToolsRequested',
        'onCloseDevToolsRequested',
        'onCloseAllDevToolsRequested',
        'onNewTabRequested',
        'onCloseTabRequested',
        'onNewTabWithUrlRequested',
        'onNavigateToUrlRequested',
        'onLoadUrlRequested',
        'onReloadRequested',
        'onHardReloadRequested',
        'onNextTabRequested',
        'onPrevTabRequested',
        'onMoveTabLeftRequested',
        'onMoveTabRightRequested',
        'onReopenClosedTabRequested',
        'onToggleBookmarkBarRequested',
        'onProfileUpdated',
        'onServiceRegistryUpdated',
        'onServiceStatusUpdated',
      ],
      hasElectronAPI: false,
      hasWallet: false,
      hasIdentity: false,
      hasSwarmProvider: false,
      hasSwarmPermissions: false,
      hasDappPermissions: false,
      hasAnt: false,
      hasIpfs: false,
      hasRadicle: false,
      hasServiceRegistry: false,
      hasNodeConfig: false,
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

    await expect(page.locator('[data-test="surfaces-status"]')).toHaveText('ok');
    const surfaces = JSON.parse(await page.locator('[data-test="surfaces-json"]').textContent());
    expect(surfaces).toMatchObject({
      initial: {
        ok: true,
        surface: 'wallet',
        open: false,
        owner: 'shell',
        mode: 'shell-owned-placeholder',
        trusted: true,
      },
      opened: {
        ok: true,
        surface: 'wallet',
        open: true,
      },
      toggled: {
        ok: true,
        surface: 'wallet',
        open: false,
      },
      closed: {
        ok: true,
        surface: 'wallet',
        open: false,
      },
      unsupported: {
        ok: false,
        surface: 'identity',
        error: {
          code: 'SURFACE_UNSUPPORTED',
        },
      },
    });

    await expect(page.locator('[data-test="trusted-prompt-status"]')).toHaveText('ok');
    const trustedPrompt = JSON.parse(
      await page.locator('[data-test="trusted-prompt-json"]').textContent()
    );
    expect(trustedPrompt).toMatchObject({
      ok: true,
      kind: 'test.confirmation',
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'trusted-prompt-broker',
      context: {
        source: 'main',
        origin: null,
        tabId: null,
        caller: {
          packageId: 'baby.freedom.chrome.fixture',
          packageType: 'browser-chrome',
        },
      },
      result: {
        outcome: 'accepted',
        source: 'test-only-broker',
      },
    });
  } finally {
    await launched.close();
  }
});

test('local package chrome installs into cache and launches offline from cache', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-cache-e2e-'));
  let launched = await launchFreedom(
    {
      FREEDOM_CHROME_PACKAGE_INSTALL_DIR: fixturePackageDir,
    },
    {
      preserveUserData: true,
      userDataDir,
    }
  );
  try {
    const page = await launched.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-test="package-root"]', { state: 'visible' });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    expect(page.url()).toBe('freedom-chrome://active/index.html');
    const installedInfo = JSON.parse(
      await page.locator('[data-test="shell-info-json"]').textContent()
    );
    expect(installedInfo).toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
        version: '0.0.1',
        source: 'store',
      },
    });
  } finally {
    await launched.close();
  }

  launched = await launchFreedom(
    {
      FREEDOM_CHROME_PACKAGE_CACHE: '1',
    },
    {
      userDataDir,
    }
  );
  try {
    const page = await launched.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-test="package-root"]', { state: 'visible' });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    expect(page.url()).toBe('freedom-chrome://active/index.html');
    const cachedInfo = JSON.parse(
      await page.locator('[data-test="shell-info-json"]').textContent()
    );
    expect(cachedInfo).toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
        version: '0.0.1',
        source: 'store',
      },
    });
  } finally {
    await launched.close();
  }
});

test('cached package readiness failure rolls back to previous cached package', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-rollback-e2e-'));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-bad-update-'));
  const badUpdateDir = path.join(parent, 'bad-update');
  writePackage(badUpdateDir, {
    packageId: 'baby.freedom.chrome.fixture',
    name: 'Bad Fixture Chrome',
    version: '0.0.2',
    capabilities: ['shell.info', 'shell.ready'],
  });

  let launched = await launchFreedom(
    {
      FREEDOM_CHROME_PACKAGE_INSTALL_DIR: fixturePackageDir,
    },
    {
      preserveUserData: true,
      userDataDir,
    }
  );
  try {
    const page = await launched.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-test="package-root"]', { state: 'visible' });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  } finally {
    await launched.close();
  }

  launched = await launchFreedom(
    {
      FREEDOM_CHROME_PACKAGE_INSTALL_DIR: badUpdateDir,
      FREEDOM_CHROME_PACKAGE_READY_TIMEOUT_MS: '250',
    },
    {
      userDataDir,
    }
  );
  try {
    const page = await waitForPackageChromeWindow(launched.app, {
      source: 'store',
      version: '0.0.1',
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    const info = JSON.parse(await page.locator('[data-test="shell-info-json"]').textContent());
    expect(info).toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
        version: '0.0.1',
        source: 'store',
      },
    });
  } finally {
    await launched.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('local package feed installs, updates, and launches cached package when source is unavailable', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-feed-e2e-'));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-feed-source-'));
  const feedPath = path.join(parent, 'feed.json');
  const v1Dir = path.join(parent, 'v1');
  const v2Dir = path.join(parent, 'v2');
  let launched;
  let appVersion;

  try {
    copyFixturePackage(v1Dir, { version: '0.1.0' });
    writeLocalPackageFeed(feedPath, [v1Dir]);

    launched = await launchFreedom(
      {
        FREEDOM_CHROME_PACKAGE_FEED_FILE: feedPath,
      },
      {
        preserveUserData: true,
        userDataDir,
      }
    );
    let page = await waitForPackageChromeWindow(launched.app, {
      source: 'store',
      version: '0.1.0',
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    let info = await readShellInfo(page);
    appVersion = info.appVersion;
    expect(info).toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
        version: '0.1.0',
        source: 'store',
      },
    });
    await launched.close();
    launched = null;

    copyFixturePackage(v2Dir, { version: '0.2.0' });
    writeLocalPackageFeed(feedPath, [v1Dir, v2Dir]);
    launched = await launchFreedom(
      {
        FREEDOM_CHROME_PACKAGE_FEED_FILE: feedPath,
      },
      {
        preserveUserData: true,
        userDataDir,
      }
    );
    page = await waitForPackageChromeWindow(launched.app, {
      source: 'store',
      version: '0.2.0',
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    info = await readShellInfo(page);
    expect(info).toMatchObject({
      appVersion,
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
        version: '0.2.0',
        source: 'store',
      },
    });
    await launched.close();
    launched = null;

    fs.rmSync(parent, { recursive: true, force: true });
    launched = await launchFreedom(
      {
        FREEDOM_CHROME_PACKAGE_FEED_FILE: feedPath,
      },
      {
        userDataDir,
      }
    );
    page = await waitForPackageChromeWindow(launched.app, {
      source: 'store',
      version: '0.2.0',
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    info = await readShellInfo(page);
    expect(info).toMatchObject({
      appVersion,
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
        version: '0.2.0',
        source: 'store',
      },
    });
  } finally {
    if (launched) {
      await launched.close();
    }
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('local package feed keeps current cache for corrupt update and rolls back failed activation', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-feed-rollback-e2e-'));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-feed-bad-update-'));
  const feedPath = path.join(parent, 'feed.json');
  const v1Dir = path.join(parent, 'v1');
  const corruptV2Dir = path.join(parent, 'v2-corrupt');
  const badV3Dir = path.join(parent, 'v3-no-ready');
  let launched;

  try {
    copyFixturePackage(v1Dir, { version: '0.1.0' });
    writeLocalPackageFeed(feedPath, [v1Dir]);
    launched = await launchFreedom(
      {
        FREEDOM_CHROME_PACKAGE_FEED_FILE: feedPath,
      },
      {
        preserveUserData: true,
        userDataDir,
      }
    );
    let page = await waitForPackageChromeWindow(launched.app, {
      source: 'store',
      version: '0.1.0',
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await launched.close();
    launched = null;

    copyFixturePackage(corruptV2Dir, { version: '0.2.0' });
    fs.writeFileSync(path.join(corruptV2Dir, 'index.html'), '<!doctype html><h1>tampered</h1>');
    writeLocalPackageFeed(feedPath, [corruptV2Dir]);
    launched = await launchFreedom(
      {
        FREEDOM_CHROME_PACKAGE_FEED_FILE: feedPath,
      },
      {
        preserveUserData: true,
        userDataDir,
      }
    );
    page = await waitForPackageChromeWindow(launched.app, {
      source: 'store',
      version: '0.1.0',
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    let info = await readShellInfo(page);
    expect(info).toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
        version: '0.1.0',
        source: 'store',
      },
    });
    await launched.close();
    launched = null;

    writePackage(badV3Dir, {
      packageId: 'baby.freedom.chrome.fixture',
      name: 'Bad Feed Fixture Chrome',
      version: '0.3.0',
      capabilities: ['shell.info', 'shell.ready'],
    });
    writeLocalPackageFeed(feedPath, [badV3Dir]);
    launched = await launchFreedom(
      {
        FREEDOM_CHROME_PACKAGE_FEED_FILE: feedPath,
        FREEDOM_CHROME_PACKAGE_READY_TIMEOUT_MS: '250',
      },
      {
        userDataDir,
      }
    );
    page = await waitForPackageChromeWindow(launched.app, {
      source: 'store',
      version: '0.1.0',
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    info = await readShellInfo(page);
    expect(info).toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
        version: '0.1.0',
        source: 'store',
      },
    });
  } finally {
    if (launched) {
      await launched.close();
    }
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('local package feed rolls back when updated package renderer becomes unhealthy', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-feed-health-e2e-'));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-package-feed-health-'));
  const feedPath = path.join(parent, 'feed.json');
  const v1Dir = path.join(parent, 'v1');
  const v2Dir = path.join(parent, 'v2');
  let launched;

  try {
    copyFixturePackage(v1Dir, { version: '0.1.0' });
    writeLocalPackageFeed(feedPath, [v1Dir]);
    launched = await launchFreedom(
      {
        FREEDOM_CHROME_PACKAGE_FEED_FILE: feedPath,
      },
      {
        preserveUserData: true,
        userDataDir,
      }
    );
    let page = await waitForPackageChromeWindow(launched.app, {
      source: 'store',
      version: '0.1.0',
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await launched.close();
    launched = null;

    copyFixturePackage(v2Dir, { version: '0.2.0' });
    writeLocalPackageFeed(feedPath, [v1Dir, v2Dir]);
    launched = await launchFreedom(
      {
        FREEDOM_CHROME_PACKAGE_FEED_FILE: feedPath,
      },
      {
        userDataDir,
      }
    );
    page = await waitForPackageChromeWindow(launched.app, {
      source: 'store',
      version: '0.2.0',
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

    await emitActiveWindowRendererGone(launched.app);
    page = await waitForPackageChromeWindow(launched.app, {
      source: 'store',
      version: '0.1.0',
    });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    const info = await readShellInfo(page);
    expect(info).toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: {
        packageId: 'baby.freedom.chrome.fixture',
        version: '0.1.0',
        source: 'store',
      },
    });
  } finally {
    if (launched) {
      await launched.close();
    }
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('official browser chrome can launch as a local package with transitional webviews', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-official-package-'));
  const packageDir = path.join(parent, 'official');
  writeOfficialChromePackage(packageDir);
  const faviconServer = await startFaviconFixtureServer();

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
    await expect(page.locator('#wallet-toggle-btn')).toBeHidden();
    await expect(page.locator('[data-test="tab"]')).toHaveCount(1);
    await expectHomeReady(page);

    const settingsWriteResult = await page.evaluate(async () => {
      const before = await window.freedomShell.getSettings();
      const saved = await window.freedomShell.saveSettings({
        theme: 'light',
        showBookmarkBar: true,
        enableIdentityWallet: false,
        startAntAtLaunch: false,
      });
      const after = await window.freedomShell.getSettings();
      return { before, saved, after };
    });
    expect(settingsWriteResult.saved).toBe(true);
    expect(settingsWriteResult.after.theme).toBe('light');
    expect(settingsWriteResult.after.showBookmarkBar).toBe(true);
    expect(settingsWriteResult.after.enableIdentityWallet).toBe(
      settingsWriteResult.before.enableIdentityWallet
    );
    expect(settingsWriteResult.after.startAntAtLaunch).toBe(
      settingsWriteResult.before.startAntAtLaunch
    );

    await expect(page.locator('[data-test="bookmarks-bar"]')).toBeVisible();
    await expect(page.locator('[data-test="bookmark-item"]')).toHaveCount(7);
    const firstDefaultBookmark = defaultBookmarks[0];
    await expect(page.locator('[data-test="bookmark-item"]').first()).toContainText(
      firstDefaultBookmark.label
    );
    await setContentFixture(launched.app, firstDefaultBookmark.target, {
      body:
        '<!doctype html><title>bookmark fixture</title><p data-test="package-bookmark">bookmark bzz fixture</p>',
    });
    await setContentFixture(launched.app, `${firstDefaultBookmark.target}/`, {
      body:
        '<!doctype html><title>bookmark fixture</title><p data-test="package-bookmark">bookmark bzz fixture</p>',
    });
    await page.locator('[data-test="bookmark-item"]').first().click();
    await expectActiveWebviewText(
      page,
      '[data-test="package-bookmark"]',
      'bookmark bzz fixture'
    );
    await page.locator('#home-btn').click();
    await expectHomeReady(page);

    const input = page.locator('[data-test="address-input"]');
    await input.click();
    await input.fill(firstDefaultBookmark.label);
    await expect(page.locator('.autocomplete-item').filter({ hasText: firstDefaultBookmark.label }))
      .toBeVisible();
    await input.press('Escape');

    await page.locator('#reload-btn').click();
    await expectHomeReady(page);

    await page.locator('#menu-button').click();
    await expect(page.locator('#menu-dropdown')).toHaveClass(/open/);
    await page.locator('#menu-button').click();
    await expect(page.locator('#menu-dropdown')).not.toHaveClass(/open/);

    await installMainWindowFullScreenRecorder(launched.app);
    await clickVisibleMainMenuItem(page, '#fullscreen-btn');
    await expect.poll(() => getMainWindowFullScreenCalls(launched.app)).toEqual([true]);
    await clickVisibleMainMenuItem(page, '#fullscreen-btn');
    await expect.poll(() => getMainWindowFullScreenCalls(launched.app)).toEqual([true, false]);

    const countBrowserWindows = () =>
      launched.app.evaluate(({ BrowserWindow }) => {
        return BrowserWindow.getAllWindows().filter((candidate) => !candidate.isDestroyed()).length;
      });
    const windowCountBeforeNewWindow = await countBrowserWindows();
    const newWindowPromise = launched.app.waitForEvent('window');
    await clickVisibleMainMenuItem(page, '#new-window-menu-btn');
    const newPackageWindow = await newWindowPromise;
    await newPackageWindow.waitForLoadState('domcontentloaded');
    await newPackageWindow.waitForSelector('[data-test="address-input"]', { state: 'visible' });
    await expect(newPackageWindow.locator('body')).toHaveAttribute('data-package-ready', 'true');
    await expect.poll(countBrowserWindows).toBe(windowCountBeforeNewWindow + 1);
    await newPackageWindow.close();
    await expect.poll(countBrowserWindows).toBe(windowCountBeforeNewWindow);

    await page.locator('#bee-menu-button').click();
    await expect(page.locator('#bee-menu-dropdown')).toHaveClass(/open/);
    const serviceState = await page.evaluate(async () => ({
      registry: await window.freedomShell.getServiceRegistry(),
      statuses: await Promise.all(
        ['ant', 'ipfs', 'radicle'].map((service) => window.freedomShell.getServiceStatus(service))
      ),
      binaries: await Promise.all(
        ['ant', 'ipfs', 'radicle'].map((service) => window.freedomShell.checkServiceBinary(service))
      ),
    }));
    expect(Object.keys(serviceState.registry).sort()).toEqual(['ant', 'ipfs', 'radicle']);
    expect(JSON.stringify(serviceState.registry)).not.toContain('127.0.0.1');
    expect(JSON.stringify(serviceState.registry)).not.toContain('api');
    expect(JSON.stringify(serviceState.registry)).not.toContain('gateway');
    expect(serviceState.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'ant', controllable: false }),
        expect.objectContaining({ service: 'ipfs', controllable: false }),
        expect.objectContaining({ service: 'radicle', controllable: false }),
      ])
    );
    expect(serviceState.binaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'ant', controllable: false }),
        expect.objectContaining({ service: 'ipfs', controllable: false }),
        expect.objectContaining({ service: 'radicle', controllable: false }),
      ])
    );
    await expect(page.locator('#bee-toggle-btn')).toBeDisabled();
    await expect(page.locator('#bee-toggle-btn')).toHaveAttribute(
      'title',
      'Node lifecycle controls are shell-owned in package mode'
    );
    await expect(page.locator('#ipfs-toggle-btn')).toBeDisabled();
    await expect(page.locator('#ipfs-toggle-btn')).toHaveAttribute(
      'title',
      'Node lifecycle controls are shell-owned in package mode'
    );
    await expect(page.locator('#radicle-nodes-section')).toBeHidden();
    await page.locator('#bee-menu-button').click();
    await expect(page.locator('#bee-menu-dropdown')).not.toHaveClass(/open/);

    const browserState = await page.evaluate(
      async ({ faviconPageUrl, faviconCacheKey }) => {
        const removeUrl = 'https://package-history-remove.example/';
        const clearUrl = 'https://package-history-clear.example/';
        const addedForRemove = await window.freedomShell.addHistory({
          url: removeUrl,
          title: 'Package History Remove',
          protocol: 'https',
        });
        const removeId =
          addedForRemove?.id ||
          (await window.freedomShell.getHistory({ query: removeUrl, limit: 1 }))[0]?.id;
        const removed = await window.freedomShell.removeHistory(removeId);
        const afterRemove = await window.freedomShell.getHistory({ query: removeUrl, limit: 5 });

        await window.freedomShell.addHistory({
          url: clearUrl,
          title: 'Package History Clear',
          protocol: 'https',
        });
        const clearCount = await window.freedomShell.clearHistory();
        const afterClear = await window.freedomShell.getHistory({ query: clearUrl, limit: 5 });

        const fetchedFavicon = await window.freedomShell.fetchFaviconWithKey(
          faviconPageUrl,
          faviconCacheKey
        );
        const cachedFavicon = await window.freedomShell.getCachedFavicon(faviconCacheKey);

        return {
          removed,
          afterRemoveCount: afterRemove.length,
          clearCount,
          afterClearCount: afterClear.length,
          fetchedFavicon,
          cachedFavicon,
        };
      },
      {
        faviconPageUrl: `${faviconServer.origin}/page`,
        faviconCacheKey: 'ipfs://package-favicon-fixture/index.html',
      }
    );
    expect(browserState.removed).toBe(true);
    expect(browserState.afterRemoveCount).toBe(0);
    expect(browserState.clearCount).toBeGreaterThanOrEqual(1);
    expect(browserState.afterClearCount).toBe(0);
    expect(browserState.fetchedFavicon).toMatch(/^data:/);
    expect(browserState.cachedFavicon).toBe(browserState.fetchedFavicon);

    const shellProfileState = await page.evaluate(async () => ({
      active: await window.freedomShell.getActiveProfile(),
      list: await window.freedomShell.listProfiles(),
    }));
    expect(shellProfileState).toEqual({
      active: {
        id: 'test',
        displayName: 'Test',
        source: 'test-user-data',
        isDev: true,
        isActive: true,
      },
      list: {
        success: true,
        profiles: [
          {
            id: 'test',
            displayName: 'Test',
            source: 'test-user-data',
            isDev: true,
            isActive: true,
          },
        ],
      },
    });
    expect(JSON.stringify(shellProfileState)).not.toContain('userDataDir');
    expect(JSON.stringify(shellProfileState)).not.toContain('appRoot');
    expect(JSON.stringify(shellProfileState)).not.toContain('nodes');

    const profileIndicator = page.locator('#profile-indicator');
    await expect(profileIndicator).toBeVisible();
    await expect(page.locator('#profile-indicator-name')).toHaveText('Test');
    await profileIndicator.click();
    await expect(page.locator('#profile-menu')).toBeVisible();
    await expect(page.locator('#profile-menu-name')).toHaveText('Test');
    await expect(page.locator('#profile-create-btn')).toBeDisabled();
    await expect(page.locator('.profile-menu-profile-item')).toHaveCount(1);
    await expect(page.locator('.profile-menu-profile-item').first()).toContainText('Test');
    await expect(page.locator('.profile-menu-profile-item').first()).toBeDisabled();
    await profileIndicator.click();
    await expect(page.locator('#profile-menu')).toBeHidden();

    await page.locator('[data-test="new-tab-btn"]').click();
    await expect(page.locator('[data-test="tab"]')).toHaveCount(2);
    await expect(page.locator('[data-test="tab"][data-tab-id="2"]')).toHaveClass(/active/);
    await page.locator('[data-test="tab"][data-tab-id="1"]').click();
    await expect(page.locator('[data-test="tab"][data-tab-id="1"]')).toHaveClass(/active/);
    await page.locator('[data-test="tab"][data-tab-id="2"] [data-test="tab-close"]').click();
    await expect(page.locator('[data-test="tab"]')).toHaveCount(1);
    await expect
      .poll(() =>
        getApplicationMenuItemStates(launched.app, [
          'next-tab',
          'prev-tab',
          'move-tab-right',
          'move-tab-left',
        ])
      )
      .toMatchObject({
        'next-tab': { enabled: false },
        'prev-tab': { enabled: false },
        'move-tab-right': { enabled: false },
        'move-tab-left': { enabled: false },
      });

    await clickApplicationMenuItem(launched.app, 'new-tab');
    await expect(page.locator('[data-test="tab"]')).toHaveCount(2);
    await expect
      .poll(() =>
        getApplicationMenuItemStates(launched.app, [
          'next-tab',
          'prev-tab',
          'move-tab-left',
        ])
      )
      .toMatchObject({
        'next-tab': { enabled: true },
        'prev-tab': { enabled: true },
        'move-tab-left': { enabled: true },
      });
    await clickApplicationMenuItem(launched.app, 'focus-address-bar');
    await expect(input).toBeFocused();
    await clickApplicationMenuItem(launched.app, 'reload');
    await expectHomeReady(page);
    await clickApplicationMenuItem(launched.app, 'close-tab');
    await expect(page.locator('[data-test="tab"]')).toHaveCount(1);

    await navigateAddress(page, 'example.com', 'https://example.com/');
    await expectActiveWebviewText(
      page,
      '[data-test="harness-http-stub-url"]',
      'https://example.com/'
    );
    await clearClipboardText(launched.app);
    await showActiveWebviewContextMenu(page, {
      pageUrl: 'https://example.com/',
      linkUrl: 'https://example.com/context-link',
    });
    await expect(page.locator('#page-context-menu')).toBeVisible();
    await page.locator('#page-context-menu [data-action="copy-link"]').click();
    await expect
      .poll(() => getClipboardText(launched.app))
      .toBe('https://example.com/context-link');
    await expect(page.locator('#page-context-menu')).toBeHidden();

    await clearClipboardText(launched.app);
    await showActiveWebviewContextMenu(page, {
      pageUrl: 'https://example.com/',
      imageSrc: 'https://example.com/context-image.png',
    });
    await expect(page.locator('#page-context-menu')).toBeVisible();
    await page.locator('#page-context-menu [data-action="copy-image-address"]').click();
    await expect
      .poll(() => getClipboardText(launched.app))
      .toBe('https://example.com/context-image.png');
    await expect(page.locator('#page-context-menu')).toBeHidden();

    const contextWindowCountBefore = await countBrowserWindows();
    const contextWindowPromise = launched.app.waitForEvent('window');
    await showActiveWebviewContextMenu(page, {
      pageUrl: 'https://example.com/',
      linkUrl: 'https://example.com/context-window',
    });
    await expect(page.locator('#page-context-menu')).toBeVisible();
    await page.locator('#page-context-menu [data-action="open-link-new-window"]').click();
    const contextPackageWindow = await contextWindowPromise;
    await contextPackageWindow.waitForLoadState('domcontentloaded');
    await contextPackageWindow.waitForSelector('[data-test="address-input"]', {
      state: 'visible',
    });
    await expect(contextPackageWindow.locator('body')).toHaveAttribute(
      'data-package-ready',
      'true'
    );
    await expect.poll(countBrowserWindows).toBe(contextWindowCountBefore + 1);
    await contextPackageWindow.close();
    await expect.poll(countBrowserWindows).toBe(contextWindowCountBefore);

    await expect(page.locator('[data-test="bookmarks-bar"]')).toBeHidden();
    await expect
      .poll(() => getApplicationMenuItemStates(launched.app, ['toggle-bookmark-bar']))
      .toMatchObject({
        'toggle-bookmark-bar': { enabled: true },
      });
    await clickApplicationMenuItem(launched.app, 'toggle-bookmark-bar');
    await expect(page.locator('[data-test="bookmarks-bar"]')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.freedomShell.getSettings()))
      .toMatchObject({ showBookmarkBar: true });
    await expect
      .poll(() => getApplicationMenuItemStates(launched.app, ['toggle-bookmark-bar']))
      .toMatchObject({
        'toggle-bookmark-bar': { enabled: true, checked: true },
      });
    await clickApplicationMenuItem(launched.app, 'toggle-bookmark-bar');
    await expect(page.locator('[data-test="bookmarks-bar"]')).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.freedomShell.getSettings()))
      .toMatchObject({ showBookmarkBar: false });
    await expect
      .poll(() => getApplicationMenuItemStates(launched.app, ['toggle-bookmark-bar']))
      .toMatchObject({
        'toggle-bookmark-bar': { enabled: true, checked: false },
      });

    await page.locator('#home-btn').click();
    await expectHomeReady(page);
    await input.click();
    await input.fill('example.com');
    await expect(page.locator('.autocomplete-item').filter({ hasText: 'https://example.com/' }))
      .toBeVisible();
    await input.press('Escape');

    await setContentFixture(launched.app, `ipfs://${providerIpfsCid}/`, {
      body: `<!doctype html>
        <title>provider fixture</title>
        <p data-test="provider-present">pending</p>
        <p data-test="provider-chain">pending</p>
        <script>
          (() => {
            const setText = (selector, value) => {
              const element = document.querySelector(selector);
              if (element) element.textContent = value;
            };
            const run = async () => {
              const provider = window.ethereum;
              const present = provider && typeof provider.request === 'function';
              setText('[data-test="provider-present"]', present ? 'present' : 'missing');
              if (!present) return;
              try {
                const chainId = await provider.request({ method: 'eth_chainId' });
                setText('[data-test="provider-chain"]', chainId);
              } catch (error) {
                setText('[data-test="provider-chain"]', 'error:' + (error.message || error));
              }
            };
            if (window.ethereum) {
              run();
            } else {
              window.addEventListener('ethereum#initialized', run, { once: true });
              setTimeout(() => {
                if (document.querySelector('[data-test="provider-present"]')?.textContent === 'pending') {
                  setText('[data-test="provider-present"]', 'missing');
                }
              }, 3000);
            }
          })();
        </script>`,
    });
    await navigateAddress(page, `ipfs://${providerIpfsCid}/`);
    await expectActiveWebviewText(page, '[data-test="provider-present"]', 'present');
    await expectActiveWebviewText(page, '[data-test="provider-chain"]', '0x64');
    await page.locator('#home-btn').click();
    await expectHomeReady(page);

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
    await faviconServer.close();
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
