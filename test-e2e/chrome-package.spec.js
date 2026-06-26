const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');
const defaultBookmarks = require('../config/default-bookmarks.json');
const { buildOfficialChromePackage } = require('../scripts/build-official-chrome-package');

const repoRoot = path.resolve(__dirname, '..');
const fixturePackageDir = path.join(repoRoot, 'test', 'fixtures', 'chrome-packages', 'minimal');
const sampleBzzHash = 'a'.repeat(64);
const sampleIpfsCid = `bafybeib${'a'.repeat(51)}`;
const providerIpfsCid = `bafybeib${'b'.repeat(51)}`;
const sampleIpnsName = 'example.ipns';
const sampleRadicleRid = 'z3gqcJUoA1n9HaHKufZs5FCSGazv5';
const pasteModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const faviconFixtureBytes = Buffer.from('package-favicon-fixture', 'utf8');
const packageSmokeWalletAddress = '0x1111111111111111111111111111111111111111';
const sampleX402PaymentUrl = 'https://api.example/segment/0';
const sampleX402Requirements = {
  x402Version: 2,
  resource: { url: 'https://api.example/article' },
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453',
      amount: '10000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
      maxTimeoutSeconds: 60,
      extra: { name: 'USD Coin', version: '2' },
    },
  ],
};
const officialPackageTrustedSidebarResidueIds = Object.freeze([
  'sidebar-export-mnemonic',
  'sidebar-export-mnemonic-btn',
  'mnemonic-words',
  'sidebar-create-wallet',
  'sidebar-receive',
  'sidebar-wallet-settings',
  'wallet-settings-export-pk',
  'send-unlock-section',
  'sidebar-dapp-connect',
  'sidebar-dapp-tx',
  'sidebar-dapp-sign',
  'sidebar-x402-approval',
  'sidebar-vault-unlock',
  'sidebar-dapp-permissions',
  'sidebar-x402-permissions',
  'sidebar-publisher-identity-create',
]);

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
      await closeElectronApp(app);
      if (options.preserveUserData !== true) {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeElectronApp(app, timeoutMs = 5000) {
  try {
    await Promise.race([
      app.close(),
      delay(timeoutMs).then(() => {
        throw new Error('Electron app close timed out');
      }),
    ]);
    return;
  } catch {
    // Window may already be closed, or Electron may hang during dev-mode teardown.
  }

  const child = typeof app.process === 'function' ? app.process() : null;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(2000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }),
  ]);
}

async function getExperimentalShellCompositorDebugState(app) {
  return app.evaluate(() => {
    const nodeRequire =
      (typeof require === 'function' && require) ||
      globalThis.require ||
      process.mainModule?.require?.bind(process.mainModule);
    if (!nodeRequire) {
      throw new Error('Node require is unavailable in Electron main evaluation context');
    }
    const pathModule = nodeRequire('path');
    const surface = nodeRequire(
      pathModule.join(process.cwd(), 'src', 'main', 'experimental-shell-compositor-surface.js')
    );
    return surface.getExperimentalShellCompositorSurfaceDebugState();
  });
}

async function getShellWindowDebugState(app) {
  return app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()
      .filter((window) => !window.isDestroyed())
      .map((window) => window.__freedomShellWindow?.getDebugState?.())
      .filter(Boolean);
  });
}

async function captureWebContentsPng(app, webContentsId) {
  const base64 = await app.evaluate(async ({ webContents }, id) => {
    const target = webContents.fromId(id);
    if (!target || target.isDestroyed()) {
      throw new Error(`No live WebContents available for capture: ${id}`);
    }
    const image = await target.capturePage();
    return {
      png: image.toPNG().toString('base64'),
    };
  }, webContentsId);
  return PNG.sync.read(Buffer.from(base64.png, 'base64'));
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

function seedWalletMetadata(userDataDir, address = packageSmokeWalletAddress, options = {}) {
  const identityDir = path.join(userDataDir, 'identity');
  fs.mkdirSync(identityDir, { recursive: true });
  const derivedWallets = Array.isArray(options.derivedWallets)
    ? options.derivedWallets
    : [
        {
          index: 0,
          name: 'Main Wallet',
          address,
        },
      ];
  const activeWalletIndex = Number.isInteger(options.activeWalletIndex)
    ? options.activeWalletIndex
    : 0;
  fs.writeFileSync(
    path.join(identityDir, 'vault-meta.json'),
    JSON.stringify(
      {
        userKnowsPassword: true,
        createdAt: '2026-06-24T00:00:00.000Z',
        addresses: {
          userWallet: address,
          beeWallet: '0x2222222222222222222222222222222222222222',
        },
        derivedWallets,
        activeWalletIndex,
      },
      null,
      2
    ),
    'utf-8'
  );
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
  return buildOfficialChromePackage({ outputDir: root, version: '0.0.1' });
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

async function getActiveWebviewPackageSettingsBoundaryState(page) {
  return page.evaluate(async () => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview || typeof webview.executeJavaScript !== 'function') {
      return { exists: false };
    }
    try {
      return await webview.executeJavaScript(`
        (() => {
          const byId = (id) => document.getElementById(id);
          return {
            exists: true,
            url: location.href,
            packageMode: document.body.dataset.packageSettingsMode || '',
            startAntDisabled: byId('start-ant-at-launch')?.disabled ?? null,
            startIpfsDisabled: byId('start-ipfs-at-launch')?.disabled ?? null,
            enableIdentityDisabled: byId('enable-identity-wallet')?.disabled ?? null,
            autoUpdateDisabled: byId('auto-update')?.disabled ?? null,
            swarmModeHelp: byId('swarm-mode-help')?.textContent || '',
            swarmModeHidden: byId('swarm-mode-action-btn')?.hidden ?? null,
            chainsText: byId('chains-view')?.textContent || '',
            rpcText: byId('rpc-view')?.textContent || '',
            ensHelp: byId('ens-lens-help')?.textContent || '',
            ensMethodDisabled: byId('ens-lens-method')?.disabled ?? null,
            ensProverDisabled: byId('ens-prover-url')?.disabled ?? null,
          };
        })()
      `);
    } catch (error) {
      return { exists: false, error: error?.message || String(error) };
    }
  });
}

async function getActiveWebviewProfileSettingsState(page) {
  return page.evaluate(async () => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview || typeof webview.executeJavaScript !== 'function') {
      return { exists: false };
    }
    try {
      return await webview.executeJavaScript(`
        (() => {
          const byId = (id) => document.getElementById(id);
          return {
            exists: true,
            url: location.href,
            unavailable: document.body.dataset.profileManagementUnavailable || '',
            displayName: byId('profile-display-name')?.textContent || '',
            runtime: byId('profile-runtime')?.textContent || '',
            nodesText: byId('profile-nodes-card')?.textContent || '',
            managerText: byId('profile-manager-list')?.textContent || '',
            status: byId('profile-manager-status')?.textContent || '',
            createDisabled: byId('create-profile-btn')?.disabled ?? null,
            createNameDisabled: byId('create-profile-name')?.disabled ?? null,
          };
        })()
      `);
    } catch (error) {
      return { exists: false, error: error?.message || String(error) };
    }
  });
}

async function getActiveWebviewPublishPageState(page) {
  return page.evaluate(async () => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview || typeof webview.executeJavaScript !== 'function') {
      return { exists: false };
    }
    try {
      return await webview.executeJavaScript(`
        (() => {
          const byId = (id) => document.getElementById(id);
          const buttonState = (id) => {
            const button = byId(id);
            return button
              ? {
                  exists: true,
                  disabled: button.disabled,
                  text: button.textContent.trim(),
                }
              : { exists: false };
          };
          return {
            exists: true,
            url: location.href,
            unavailable: document.body.dataset.swarmPublishUnavailable || '',
            bannerText: byId('publish-status-banner')?.textContent || '',
            bannerHidden: byId('publish-status-banner')?.classList.contains('hidden') ?? true,
            file: buttonState('publish-file-btn'),
            folder: buttonState('publish-folder-btn'),
            text: buttonState('publish-text-btn'),
            textInputHidden: byId('publish-text-input')?.classList.contains('hidden') ?? false,
            historyClearDisabled: byId('publish-history-clear')?.disabled ?? null,
            trustedPublishExists: Boolean(byId('open-trusted-swarm-publish-surface')),
          };
        })()
      `);
    } catch (error) {
      return { exists: false, error: error?.message || String(error) };
    }
  });
}

async function getActiveWebviewPaymentsPageState(page) {
  return page.evaluate(async () => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview || typeof webview.executeJavaScript !== 'function') {
      return { exists: false };
    }
    try {
      return await webview.executeJavaScript(`
        (() => {
          const byId = (id) => document.getElementById(id);
          return {
            exists: true,
            url: location.href,
            unavailable: document.body.dataset.paymentHistoryUnavailable || '',
            stats: byId('stats')?.textContent || '',
            message: byId('results')?.textContent || '',
            searchDisabled: byId('search-input')?.disabled ?? null,
            kindDisabled: byId('kind-select')?.disabled ?? null,
            chainDisabled: byId('chain-select')?.disabled ?? null,
            clearDisabled: byId('clear-btn')?.disabled ?? null,
            openTrustedExists: Boolean(byId('open-trusted-payments-surface')),
          };
        })()
      `);
    } catch (error) {
      return { exists: false, error: error?.message || String(error) };
    }
  });
}

async function getActiveWebviewHistoryPageState(page, query = '') {
  return page.evaluate(async (searchQuery) => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview || typeof webview.executeJavaScript !== 'function') {
      return { exists: false };
    }
    try {
      return await webview.executeJavaScript(`
        ((searchQuery) => {
          const byId = (id) => document.getElementById(id);
          const searchInput = byId('search-input');
          if (searchInput && searchQuery) {
            searchInput.value = searchQuery;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const items = Array.from(document.querySelectorAll('.history-item'));
          return {
            exists: true,
            url: location.href,
            stats: byId('stats')?.textContent || '',
            itemCount: items.length,
            titles: items.map((item) => item.querySelector('.history-title')?.textContent || ''),
            urls: items.map((item) => item.dataset.url || ''),
            searchValue: searchInput?.value || '',
            clearText: byId('clear-btn')?.textContent?.trim() || '',
          };
        })(${JSON.stringify(searchQuery)})
      `);
    } catch (error) {
      return { exists: false, error: error?.message || String(error) };
    }
  }, query);
}

async function removeFirstActiveWebviewHistoryResult(page, query = '') {
  return page.evaluate(async (searchQuery) => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview || typeof webview.executeJavaScript !== 'function') {
      return false;
    }
    return webview.executeJavaScript(`
      ((searchQuery) => {
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchQuery) {
          searchInput.value = searchQuery;
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const button = document.querySelector('.history-item .delete-btn');
        if (!button) return false;
        button.click();
        return true;
      })(${JSON.stringify(searchQuery)})
    `);
  }, query);
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

async function getActiveWebviewWebContentsId(page) {
  return page.evaluate(() => {
    const webview = document.querySelector('webview:not(.hidden)');
    if (!webview || typeof webview.getWebContentsId !== 'function') {
      throw new Error('No active webview with a WebContents id');
    }
    return webview.getWebContentsId();
  });
}

async function triggerPackageHostedX402Approval(app, webContentsId) {
  return app.evaluate(
    async ({ BrowserWindow }, payload) => {
      const nodeRequire =
        (typeof require === 'function' && require) ||
        globalThis.require ||
        process.mainModule?.require?.bind(process.mainModule);
      if (!nodeRequire) {
        throw new Error('Node require is unavailable in Electron main evaluation context');
      }
      const pathModule = nodeRequire('path');
      const intercept = nodeRequire(
        pathModule.join(process.cwd(), 'src', 'main', 'x402', 'intercept.js')
      );
      const signFlow = nodeRequire(
        pathModule.join(process.cwd(), 'src', 'main', 'x402', 'sign-flow.js')
      );
      const { VAULT_LOCKED_MESSAGE } = nodeRequire(
        pathModule.join(process.cwd(), 'src', 'main', 'wallet', 'vault-errors.js')
      );
      const trustedVaultPrompt = nodeRequire(
        pathModule.join(process.cwd(), 'src', 'main', 'trusted-vault-unlock-prompt.js')
      );
      const trustedX402ApprovalPrompt = nodeRequire(
        pathModule.join(process.cwd(), 'src', 'main', 'trusted-x402-approval-prompt.js')
      );

      intercept.clearAllDetectedPayments();
      intercept.clearAllPendingApprovals();
      intercept.clearAllPendingUnlockResume();
      intercept.clearAllPendingUnlockWaits();
      intercept.clearAllRequestContext();

      globalThis.__freedomX402TrustedApprovalPrompts = [];
      globalThis.__freedomX402HostEvents = [];
      globalThis.__freedomX402TrustedVaultUnlockPrompts = [];
      globalThis.__freedomX402SignCalls = [];
      for (const window of BrowserWindow.getAllWindows()) {
        const wc = window.webContents;
        if (!wc || wc.isDestroyed?.()) continue;
        if (!wc.__freedomX402OriginalSend) {
          Object.defineProperty(wc, '__freedomX402OriginalSend', {
            configurable: false,
            enumerable: false,
            value: wc.send.bind(wc),
          });
          wc.send = (channel, ...args) => {
            if (String(channel).startsWith('x402:')) {
              globalThis.__freedomX402HostEvents.push({
                channel,
                args,
                webContentsId: wc.id,
                windowId: window.id,
              });
            }
            return wc.__freedomX402OriginalSend(channel, ...args);
          };
        }
      }

      const originalSignAndQueueRetry = signFlow.signAndQueueRetry;
      const originalPresentTrustedX402ApprovalPrompt =
        trustedX402ApprovalPrompt.presentTrustedX402ApprovalPrompt;
      const originalPresentTrustedVaultUnlockPrompt =
        trustedVaultPrompt.presentTrustedVaultUnlockPrompt;
      let signAttempt = 0;
      signFlow.signAndQueueRetry = async (signWebContentsId, options = {}) => {
        signAttempt += 1;
        globalThis.__freedomX402SignCalls.push({
          webContentsId: signWebContentsId,
          authorizedBy: options.authorizedBy || null,
          hasGrant: !!options.grant,
          grant: options.grant || null,
          selectedAcceptIndex: Number.isInteger(options.selectedAcceptIndex)
            ? options.selectedAcceptIndex
            : null,
          detection: {
            url: options.detection?.url || null,
            resourceType: options.detection?.resourceType || null,
          },
        });
        if (signAttempt === 1) {
          throw new Error(VAULT_LOCKED_MESSAGE);
        }
      };
      trustedX402ApprovalPrompt.presentTrustedX402ApprovalPrompt = async (request, context = {}) => {
        globalThis.__freedomX402TrustedApprovalPrompts.push({
          request,
          context: {
            origin: context.origin || null,
            webContentsId: context.webContentsId ?? null,
            hasOwnerWindow: !!context.ownerWindow,
            ownerWindowDestroyed: context.ownerWindow?.isDestroyed?.() ?? null,
            caller: context.caller || null,
          },
        });
        return {
          ok: true,
          outcome: 'accepted',
          response: 1,
          renderedBy: 'trusted-x402-approval-window',
          presentation: 'trusted-window',
          source: 'trusted-x402-approval-window',
          grant: { capAmount: '10000000', windowSeconds: 30 * 24 * 60 * 60 },
          selectedAcceptIndex: 0,
        };
      };
      trustedVaultPrompt.presentTrustedVaultUnlockPrompt = async (request, context = {}) => {
        globalThis.__freedomX402TrustedVaultUnlockPrompts.push({
          request,
          context: {
            origin: context.origin || null,
            webContentsId: context.webContentsId ?? null,
            hasOwnerWindow: !!context.ownerWindow,
            ownerWindowDestroyed: context.ownerWindow?.isDestroyed?.() ?? null,
            caller: context.caller || null,
          },
        });
        return { ok: true, outcome: 'accepted', response: 0 };
      };

      const header = Buffer.from(JSON.stringify(payload.requirements)).toString('base64');
      const requestDetails = {
        id: payload.requestId,
        webContentsId: payload.webContentsId,
        url: payload.url,
        method: 'GET',
        requestHeaders: {},
        resourceType: 'xhr',
      };
      try {
        intercept.captureRequestContextHandler(requestDetails);
        const result = await intercept.detectPaymentRequiredHandler({
          ...requestDetails,
          statusLine: 'HTTP/1.1 402 Payment Required',
          responseHeaders: { 'PAYMENT-REQUIRED': [header] },
        });
        return {
          result,
          detectedAfter: intercept.getDetectedPayment(payload.webContentsId),
          hostEvents: globalThis.__freedomX402HostEvents,
          approvalPrompts: globalThis.__freedomX402TrustedApprovalPrompts,
          vaultUnlockPrompts: globalThis.__freedomX402TrustedVaultUnlockPrompts,
          signCalls: globalThis.__freedomX402SignCalls,
        };
      } finally {
        signFlow.signAndQueueRetry = originalSignAndQueueRetry;
        trustedX402ApprovalPrompt.presentTrustedX402ApprovalPrompt =
          originalPresentTrustedX402ApprovalPrompt;
        trustedVaultPrompt.presentTrustedVaultUnlockPrompt =
          originalPresentTrustedVaultUnlockPrompt;
        intercept.clearRequestContextHandler({ id: payload.requestId });
        intercept.clearAllDetectedPayments();
        intercept.clearAllPendingApprovals();
        intercept.clearAllPendingUnlockResume();
        intercept.clearAllPendingUnlockWaits();
      }
    },
    {
      requestId: 40201,
      requirements: sampleX402Requirements,
      url: sampleX402PaymentUrl,
      webContentsId,
    }
  );
}

async function readShellInfo(page) {
  return JSON.parse(await page.locator('[data-test="shell-info-json"]').textContent());
}

async function emitActiveWindowRendererGone(app, reason = 'crashed') {
  await app.evaluate(({ BrowserWindow, webContents }, payload) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window) {
      throw new Error('No active browser window to mark unhealthy');
    }
    const shellWindow = window.__freedomShellWindow?.getDebugState?.();
    const target =
      shellWindow?.chromeWebContentsId &&
      shellWindow.chromeWebContentsId !== shellWindow.hostWebContentsId
        ? webContents.fromId(shellWindow.chromeWebContentsId)
        : window.webContents;
    if (!target || target.isDestroyed?.()) {
      throw new Error('No active chrome WebContents to mark unhealthy');
    }
    target.emit('render-process-gone', {}, { reason: payload.reason });
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

async function waitForOfficialPackageChromeWindow(app, expected) {
  const deadline = Date.now() + 10_000;
  const isExpected = async (candidate) => {
    await candidate.waitForSelector('[data-test="address-input"]', {
      state: 'visible',
      timeout: 500,
    });
    await candidate.waitForSelector('body[data-package-ready="true"]', {
      state: 'attached',
      timeout: 500,
    });
    const info = await candidate.evaluate(() => window.freedomShell.getInfo());
    return {
      matches:
        (!expected?.version || info.chromePackage?.version === expected.version) &&
        (!expected?.source || info.chromePackage?.source === expected.source) &&
        (!expected?.packageId || info.chromePackage?.packageId === expected.packageId),
      info,
    };
  };

  while (Date.now() < deadline) {
    const windows = typeof app.windows === 'function' ? app.windows() : [];
    for (const candidate of windows) {
      if (!candidate || candidate.isClosed()) {
        continue;
      }
      try {
        const result = await isExpected(candidate);
        if (result.matches) {
          return candidate;
        }
      } catch {
        // Keep polling; unrelated windows may appear before official package chrome is ready.
      }
    }

    const nextWindow = await app.waitForEvent('window', { timeout: 500 }).catch(() => null);
    if (nextWindow && !nextWindow.isClosed()) {
      try {
        const result = await isExpected(nextWindow);
        if (result.matches) {
          return nextWindow;
        }
      } catch {
        // Keep polling until the official package window is ready.
      }
    }
  }

  throw new Error('Official package chrome window did not appear');
}

async function waitForTrustedWalletWindow(app) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const windows = typeof app.windows === 'function' ? app.windows() : [];
    for (const candidate of windows) {
      if (!candidate || candidate.isClosed()) {
        continue;
      }
      try {
        await candidate.waitForSelector('#create-wallet-submit', {
          state: 'visible',
          timeout: 500,
        });
        return candidate;
      } catch {
        // Keep polling; other BrowserWindows do not host the trusted wallet surface.
      }
    }

    const nextWindow = await app.waitForEvent('window', { timeout: 500 }).catch(() => null);
    if (nextWindow && !nextWindow.isClosed()) {
      try {
        await nextWindow.waitForSelector('#create-wallet-submit', {
          state: 'visible',
          timeout: 500,
        });
        return nextWindow;
      } catch {
        // Keep polling until the trusted wallet surface is ready.
      }
    }
  }

  throw new Error('Trusted wallet window did not appear');
}

async function waitForTrustedIdentityWindow(app) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const windows = typeof app.windows === 'function' ? app.windows() : [];
    for (const candidate of windows) {
      if (!candidate || candidate.isClosed()) {
        continue;
      }
      try {
        await candidate.waitForSelector('#identity-surface', {
          state: 'visible',
          timeout: 500,
        });
        return candidate;
      } catch {
        // Keep polling; other BrowserWindows do not host the trusted identity surface.
      }
    }

    const nextWindow = await app.waitForEvent('window', { timeout: 500 }).catch(() => null);
    if (nextWindow && !nextWindow.isClosed()) {
      try {
        await nextWindow.waitForSelector('#identity-surface', {
          state: 'visible',
          timeout: 500,
        });
        return nextWindow;
      } catch {
        // Keep polling until the trusted identity surface is ready.
      }
    }
  }

  throw new Error('Trusted identity window did not appear');
}

async function waitForTrustedVaultUnlockWindow(app) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const windows = typeof app.windows === 'function' ? app.windows() : [];
    for (const candidate of windows) {
      if (!candidate || candidate.isClosed()) {
        continue;
      }
      try {
        await candidate.waitForSelector('#unlock-form', {
          state: 'visible',
          timeout: 500,
        });
        return candidate;
      } catch {
        // Keep polling; other BrowserWindows do not host the trusted vault unlock prompt.
      }
    }

    const nextWindow = await app.waitForEvent('window', { timeout: 500 }).catch(() => null);
    if (nextWindow && !nextWindow.isClosed()) {
      try {
        await nextWindow.waitForSelector('#unlock-form', {
          state: 'visible',
          timeout: 500,
        });
        return nextWindow;
      } catch {
        // Keep polling until the trusted vault unlock prompt is ready.
      }
    }
  }

  throw new Error('Trusted vault unlock window did not appear');
}

async function cancelTrustedPromptWindow(promptWindow, selector = '#cancel') {
  const closePromise = promptWindow.waitForEvent('close').catch(() => null);
  try {
    await promptWindow.locator(selector).click();
  } catch (error) {
    if (!promptWindow.isClosed()) {
      throw error;
    }
  }
  await closePromise;
}

test('local package chrome loads through freedomShell without broad preload APIs', async () => {
  const launched = await launchFreedom({
    FREEDOM_CHROME_PACKAGE_DIR: fixturePackageDir,
  });
  try {
    const page = await waitForPackageChromeWindow(launched.app, { source: 'local' });
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
        'onSurfaceStateChanged',
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
        'onUpdateNotification',
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
        mode: 'shell-owned-trusted-window',
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
        surface: 'unknown',
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

    await launched.app.evaluate(({ dialog }) => {
      globalThis.__freedomTrustedPromptDialog = null;
      dialog.showMessageBox = async (ownerWindow, options) => {
        globalThis.__freedomTrustedPromptDialog = {
          hasOwnerWindow: !!ownerWindow,
          ownerWindowDestroyed: ownerWindow?.isDestroyed?.() ?? null,
          options,
        };
        return { response: 0 };
      };
    });
    const nativeTrustedPrompt = await page.evaluate(() =>
      window.freedomShell.requestTestTrustedPrompt({
        kind: 'test.confirmation',
        reason: 'Fixture native prompt check',
        presentation: 'native-dialog',
        origin: 'https://spoofed.example',
        tabId: 999,
      })
    );
    const nativeTrustedPromptDialog = await launched.app.evaluate(
      () => globalThis.__freedomTrustedPromptDialog
    );
    expect(nativeTrustedPrompt).toMatchObject({
      ok: true,
      kind: 'test.confirmation',
      trusted: true,
      surfaceOwner: 'shell',
      renderedBy: 'shell-native-dialog',
      context: {
        source: 'main',
        origin: null,
        tabId: null,
        caller: {
          packageId: 'baby.freedom.chrome.fixture',
          packageType: 'browser-chrome',
        },
      },
      request: {
        reason: 'Fixture native prompt check',
        presentation: 'native-dialog',
      },
      result: {
        outcome: 'accepted',
        source: 'shell-native-dialog',
        response: 0,
      },
    });
    expect(nativeTrustedPromptDialog).toMatchObject({
      hasOwnerWindow: true,
      ownerWindowDestroyed: false,
      options: {
        type: 'info',
        title: 'Freedom Trusted Prompt',
        message: 'Freedom trusted prompt',
        detail: 'Fixture native prompt check',
        buttons: ['OK'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
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
    const page = await waitForPackageChromeWindow(launched.app, {
      version: '0.0.1',
      source: 'store',
    });
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
    const page = await waitForPackageChromeWindow(launched.app, {
      version: '0.0.1',
      source: 'store',
    });
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

test('generated official browser chrome installs into cache and launches offline from cache', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-official-cache-e2e-'));
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-official-cache-source-'));
  const packageDir = path.join(parent, 'official');
  writeOfficialChromePackage(packageDir);
  let launched;
  const expectedPackage = {
    packageId: 'baby.freedom.chrome.official-local',
    version: '0.0.1',
    source: 'store',
  };

  try {
    launched = await launchFreedom(
      {
        FREEDOM_CHROME_PACKAGE_INSTALL_DIR: packageDir,
      },
      {
        preserveUserData: true,
        userDataDir,
      }
    );
    let page = await waitForOfficialPackageChromeWindow(launched.app, expectedPackage);
    await expectHomeReady(page);
    let info = await page.evaluate(() => window.freedomShell.getInfo());
    expect(info).toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: expectedPackage,
    });
    await launched.close();
    launched = null;

    launched = await launchFreedom(
      {
        FREEDOM_CHROME_PACKAGE_CACHE: '1',
      },
      {
        userDataDir,
      }
    );
    page = await waitForOfficialPackageChromeWindow(launched.app, expectedPackage);
    await expectHomeReady(page);
    info = await page.evaluate(() => window.freedomShell.getInfo());
    expect(info).toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: expectedPackage,
    });
  } finally {
    if (launched) {
      await launched.close();
    }
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
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
    const page = await waitForPackageChromeWindow(launched.app, {
      version: '0.0.1',
      source: 'store',
    });
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

test('official browser chrome launch truth markers prove package mode', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-official-package-truth-'));
  const packageDir = path.join(parent, 'official');
  writeOfficialChromePackage(packageDir);

  const launched = await launchFreedom({
    FREEDOM_CHROME_PACKAGE_DIR: packageDir,
  });
  try {
    const page = await waitForOfficialPackageChromeWindow(launched.app, { source: 'local' });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-test="address-input"]', { state: 'visible' });

    const exposure = await page.evaluate(() => ({
      href: location.href,
      packageReady: document.body.dataset.packageReady,
      hasFreedomShell: 'freedomShell' in window,
      hasElectronAPI: 'electronAPI' in window,
      hasWallet: 'wallet' in window,
      hasIdentity: 'identity' in window,
      hasSwarmProvider: 'swarmProvider' in window,
      hasSwarmPermissions: 'swarmPermissions' in window,
      hasDappPermissions: 'dappPermissions' in window,
    }));
    expect(exposure).toMatchObject({
      packageReady: 'true',
      hasFreedomShell: true,
      hasElectronAPI: false,
      hasWallet: false,
      hasIdentity: false,
      hasSwarmProvider: false,
      hasSwarmPermissions: false,
      hasDappPermissions: false,
    });
    expect(exposure.href).toContain('/official/index.html');

    const info = await page.evaluate(() => window.freedomShell.getInfo());
    expect(info).toMatchObject({
      runtimeMode: 'local-package',
      chromePackage: {
        runtimeMode: 'local-package',
        source: 'local',
        packageId: 'baby.freedom.chrome.official-local',
        fallback: null,
      },
      caller: {
        runtimeMode: 'local-package',
        source: 'local',
        packageId: 'baby.freedom.chrome.official-local',
      },
    });
    await expect
      .poll(async () => getShellWindowDebugState(launched.app), {
        timeout: 5000,
      })
      .toHaveLength(1);
    const [shellWindow] = await getShellWindowDebugState(launched.app);
    expect(shellWindow).toMatchObject({
      mode: 'webcontents-view-compositor',
      packageId: 'baby.freedom.chrome.official-local',
      packageKind: 'local-package',
      chromeWebContentsId: expect.any(Number),
      chromeUrl: expect.stringContaining('/official/index.html'),
      chromeBounds: {
        x: 0,
        y: 0,
        width: expect.any(Number),
        height: expect.any(Number),
      },
      chromeVisible: true,
      hostWebContentsId: expect.any(Number),
    });
    expect(shellWindow.chromeWebContentsId).not.toBe(shellWindow.hostWebContentsId);
  } finally {
    await launched.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('shell compositor renders a shell-owned WebContentsView surface', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-compositor-package-'));
  const packageDir = path.join(parent, 'official');
  writeOfficialChromePackage(packageDir);

  const launched = await launchFreedom({
    FREEDOM_CHROME_PACKAGE_DIR: packageDir,
    FREEDOM_EXPERIMENTAL_SHELL_COMPOSITOR: '1',
  });
  try {
    const page = await waitForOfficialPackageChromeWindow(launched.app, { source: 'local' });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('[data-test="address-input"]', { state: 'visible' });
    await expect
      .poll(async () => getShellWindowDebugState(launched.app), {
        timeout: 5000,
      })
      .toHaveLength(1);
    const [chromeCompositor] = await getShellWindowDebugState(launched.app);
    expect(chromeCompositor).toMatchObject({
      mode: 'webcontents-view-compositor',
      chromeWebContentsId: expect.any(Number),
      chromeUrl: expect.stringContaining('/official/index.html'),
      chromeBounds: {
        x: 0,
        y: 0,
        width: expect.any(Number),
        height: expect.any(Number),
      },
      chromeVisible: true,
      hostWebContentsId: expect.any(Number),
    });
    expect(chromeCompositor.chromeWebContentsId).not.toBe(chromeCompositor.hostWebContentsId);

    await expect(
      page.evaluate(() => window.freedomShell.getSurfaceState('testSurface'))
    ).resolves.toMatchObject({
      ok: true,
      surface: 'testSurface',
      open: false,
      owner: 'shell',
      mode: 'shell-owned-webcontents-view',
      trusted: true,
    });

    await expect(
      page.evaluate(() => window.freedomShell.openSurface('testSurface'))
    ).resolves.toMatchObject({
      ok: true,
      surface: 'testSurface',
      open: true,
      owner: 'shell',
      mode: 'shell-owned-webcontents-view',
      trusted: true,
    });

    await expect(
      page.evaluate(() => Boolean(document.querySelector('[data-test="shell-compositor-test-surface"]')))
    ).resolves.toBe(false);

    await expect
      .poll(async () => getExperimentalShellCompositorDebugState(launched.app), {
        timeout: 5000,
      })
      .toHaveLength(1);
    const [surface] = await getExperimentalShellCompositorDebugState(launched.app);
    expect(surface).toMatchObject({
      surface: 'testSurface',
      url: expect.stringContaining('experimental-shell-compositor-test-surface.html'),
      bounds: {
        y: 0,
        width: 360,
      },
      visible: true,
      closed: false,
    });
    expect(surface.webContentsId).not.toBe(chromeCompositor.chromeWebContentsId);
    expect(surface.bounds.height).toBe(chromeCompositor.chromeBounds.height);
    expect(surface.bounds.x + surface.bounds.width).toBe(chromeCompositor.chromeBounds.width);

    const image = await captureWebContentsPng(launched.app, surface.webContentsId);
    const sampleX = Math.min(image.width - 1, 24);
    const sampleY = Math.min(image.height - 1, 24);
    const offset = (sampleY * image.width + sampleX) * 4;
    const pixel = {
      r: image.data[offset],
      g: image.data[offset + 1],
      b: image.data[offset + 2],
      a: image.data[offset + 3],
    };
    expect(pixel).toMatchObject({
      r: expect.any(Number),
      g: expect.any(Number),
      b: expect.any(Number),
      a: 255,
    });
    expect(pixel.g).toBeGreaterThan(160);
    expect(pixel.b).toBeGreaterThan(120);
    expect(pixel.g - pixel.r).toBeGreaterThan(80);

    await expect(
      page.evaluate(() => window.freedomShell.closeSurface('testSurface'))
    ).resolves.toMatchObject({
      ok: true,
      surface: 'testSurface',
      open: false,
      mode: 'shell-owned-webcontents-view',
    });
    await expect
      .poll(async () => getExperimentalShellCompositorDebugState(launched.app), {
        timeout: 5000,
      })
      .toHaveLength(0);
  } finally {
    await launched.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('official browser chrome can launch as a local package with transitional webviews', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-official-package-'));
  const packageDir = path.join(parent, 'official');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-official-package-user-'));
  writeOfficialChromePackage(packageDir);
  seedWalletMetadata(userDataDir, packageSmokeWalletAddress, {
    derivedWallets: [
      {
        index: 0,
        name: 'Main Wallet',
        address: packageSmokeWalletAddress,
      },
      {
        index: 1,
        name: 'Savings',
        address: '0x3333333333333333333333333333333333333333',
      },
    ],
    activeWalletIndex: 0,
  });
  const faviconServer = await startFaviconFixtureServer();

  const launched = await launchFreedom(
    {
      FREEDOM_CHROME_PACKAGE_DIR: packageDir,
    },
    { userDataDir }
  );
  try {
    const page = await waitForOfficialPackageChromeWindow(launched.app, { source: 'local' });
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

    const initialWalletSurface = await page.evaluate(() =>
      window.freedomShell.getSurfaceState('wallet')
    );
    expect(initialWalletSurface).toMatchObject({
      ok: true,
      surface: 'wallet',
      open: false,
      owner: 'shell',
      mode: 'shell-owned-trusted-window',
      trusted: true,
    });
    await expect(page.locator('#wallet-toggle-btn')).toBeVisible();
    const trustedSidebarResidue = await page.evaluate((ids) => {
      return Object.fromEntries(ids.map((id) => [id, Boolean(document.getElementById(id))]));
    }, officialPackageTrustedSidebarResidueIds);
    expect(trustedSidebarResidue).toEqual(
      Object.fromEntries(officialPackageTrustedSidebarResidueIds.map((id) => [id, false]))
    );
    await page.evaluate(() => window.freedomShell.openSurface('wallet'));
    await expect.poll(() =>
      page.evaluate(() => window.freedomShell.getSurfaceState('wallet').then((state) => state.open))
    ).toBe(true);
    const openedWalletSurface = await page.evaluate(() =>
      window.freedomShell.getSurfaceState('wallet')
    );
    expect(openedWalletSurface).toMatchObject({
      ok: true,
      surface: 'wallet',
      open: true,
      mode: 'shell-owned-webcontents-view',
    });
    await expect
      .poll(async () => {
        const [shellWindow] = await getShellWindowDebugState(launched.app);
        return shellWindow?.surfaces?.find((surface) => surface.surface === 'wallet') || null;
      })
      .toMatchObject({
        surface: 'wallet',
        webContentsId: expect.any(Number),
        url: expect.stringContaining('trusted-wallet.html'),
        bounds: {
          x: expect.any(Number),
          y: 0,
          width: 360,
          height: expect.any(Number),
        },
        visible: true,
        closed: false,
      });
    const [shellWindowWithWallet] = await getShellWindowDebugState(launched.app);
    const walletSurface = shellWindowWithWallet.surfaces.find(
      (surface) => surface.surface === 'wallet'
    );
    expect(walletSurface.webContentsId).not.toBe(shellWindowWithWallet.hostWebContentsId);
    expect(walletSurface.webContentsId).not.toBe(shellWindowWithWallet.chromeWebContentsId);
    expect(openedWalletSurface.layoutMode).toBe('dock');
    expect(walletSurface.layoutMode).toBe('dock');
    expect(walletSurface.bounds.x).toBe(
      shellWindowWithWallet.chromeBounds.width
    );
    const trustedWalletWindow = await waitForTrustedWalletWindow(launched.app);
    await expect(trustedWalletWindow.locator('#heading')).toHaveText('Wallet Accounts');
    await expect(trustedWalletWindow.locator('#wallet-list li')).toHaveCount(2);
    await expect(trustedWalletWindow.locator('#create-wallet-submit')).toBeVisible();
    await trustedWalletWindow.locator('#create-wallet-name').fill('Trading');
    await trustedWalletWindow.locator('#create-wallet-submit').click();
    const vaultUnlockWindow = await waitForTrustedVaultUnlockWindow(launched.app);
    await expect(vaultUnlockWindow.locator('#heading')).toHaveText('Unlock vault to create wallet');
    await expect(vaultUnlockWindow.locator('#details')).toContainText('Create wallet');
    await expect(vaultUnlockWindow.locator('#details')).toContainText('Trading');
    await cancelTrustedPromptWindow(vaultUnlockWindow);
    await expect(trustedWalletWindow.locator('#management-error')).toContainText(
      'Vault unlock was cancelled'
    );
    const savingsRow = trustedWalletWindow.locator('#wallet-list li').filter({
      hasText: 'Savings',
    });
    await savingsRow.getByRole('button', { name: 'Set active' }).click();
    await expect(savingsRow.getByRole('button', { name: 'Active' })).toBeVisible();
    await trustedWalletWindow.evaluate(() => {
      window.prompt = () => 'Renamed Savings';
    });
    await savingsRow.getByRole('button', { name: 'Rename' }).click();
    const renamedSavingsRow = trustedWalletWindow.locator('#wallet-list li').filter({
      hasText: 'Renamed Savings',
    });
    await expect(renamedSavingsRow).toHaveCount(1);
    await trustedWalletWindow.evaluate(() => {
      window.confirm = () => true;
    });
    await renamedSavingsRow.getByRole('button', { name: 'Delete' }).click();
    await expect(trustedWalletWindow.locator('#wallet-list li')).toHaveCount(1);
    await expect(trustedWalletWindow.getByText('Renamed Savings')).toHaveCount(0);
    await expect(page.locator('#wallet-toggle-btn')).toHaveAttribute('aria-expanded', 'true');
    await page.evaluate(() => window.freedomShell.closeSurface('wallet'));
    await expect.poll(() =>
      page.evaluate(() => window.freedomShell.getSurfaceState('wallet').then((state) => state.open))
    ).toBe(false);
    await expect(page.locator('#wallet-toggle-btn')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#wallet-toggle-btn').click();
    await expect.poll(() =>
      page.evaluate(() => window.freedomShell.getSurfaceState('wallet').then((state) => state.open))
    ).toBe(true);
    await expect(page.locator('#wallet-toggle-btn')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#sidebar')).toHaveAttribute(
      'data-surface-mode',
      'shell-owned-webcontents-view'
    );
    await expect(page.locator('#package-wallet-surface-placeholder')).toHaveCount(0);
    await page.evaluate(() => window.freedomShell.closeSurface('wallet'));
    await expect.poll(() =>
      page.evaluate(() => window.freedomShell.getSurfaceState('wallet').then((state) => state.open))
    ).toBe(false);
    await expect
      .poll(async () => {
        const [shellWindow] = await getShellWindowDebugState(launched.app);
        return shellWindow?.surfaces?.some((surface) => surface.surface === 'wallet') || false;
      })
      .toBe(false);
    await expect(page.locator('#wallet-toggle-btn')).toHaveAttribute('aria-expanded', 'false');

    const initialPaymentsSurface = await page.evaluate(() =>
      window.freedomShell.getSurfaceState('payments')
    );
    expect(initialPaymentsSurface).toMatchObject({
      ok: true,
      surface: 'payments',
      open: false,
      owner: 'shell',
      mode: 'shell-owned-trusted-window',
      trusted: true,
    });
    const openedPaymentsSurface = await page.evaluate(() =>
      window.freedomShell.openSurface('payments')
    );
    expect(openedPaymentsSurface).toMatchObject({
      ok: true,
      surface: 'payments',
      open: true,
      owner: 'shell',
      mode: 'shell-owned-trusted-window',
      trusted: true,
    });
    await expect.poll(() =>
      page.evaluate(() => window.freedomShell.getSurfaceState('payments').then((state) => state.open))
    ).toBe(true);
    const closedPaymentsSurface = await page.evaluate(() =>
      window.freedomShell.closeSurface('payments')
    );
    expect(closedPaymentsSurface).toMatchObject({
      ok: true,
      surface: 'payments',
      open: false,
    });

    const initialIdentitySurface = await page.evaluate(() =>
      window.freedomShell.getSurfaceState('identity')
    );
    expect(initialIdentitySurface).toMatchObject({
      ok: true,
      surface: 'identity',
      open: false,
      owner: 'shell',
      mode: 'shell-owned-trusted-window',
      trusted: true,
    });
    const openedIdentitySurface = await page.evaluate(() =>
      window.freedomShell.openSurface('identity')
    );
    expect(openedIdentitySurface).toMatchObject({
      ok: true,
      surface: 'identity',
      open: true,
      owner: 'shell',
      mode: 'shell-owned-trusted-window',
      trusted: true,
    });
    const trustedIdentityWindow = await waitForTrustedIdentityWindow(launched.app);
    await expect(trustedIdentityWindow.locator('#heading')).toHaveText('Identity And Vault');
    await expect(trustedIdentityWindow.locator('#vault-state')).toHaveText('Not created');
    await expect(trustedIdentityWindow.locator('#password-state')).toHaveText('Unavailable');
    await expect(trustedIdentityWindow.locator('#quick-unlock-state')).toHaveText('Unavailable');
    await expect(trustedIdentityWindow.locator('#wallet-address')).toContainText('0x');
    await expect(trustedIdentityWindow.locator('#create-submit')).toBeVisible();
    await expect(trustedIdentityWindow.locator('#import-submit')).toBeVisible();
    await expect(trustedIdentityWindow.locator('#change-password-section')).toBeHidden();
    await expect(trustedIdentityWindow.locator('#quick-unlock-section')).toBeHidden();
    await expect(trustedIdentityWindow.locator('#delete-vault-section')).toBeHidden();
    const closedIdentitySurface = await page.evaluate(() =>
      window.freedomShell.closeSurface('identity')
    );
    expect(closedIdentitySurface).toMatchObject({
      ok: true,
      surface: 'identity',
      open: false,
    });

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

    const bookmarkUiCid = `bafybeib${'c'.repeat(51)}`;
    const editedBookmarkUiCid = `bafybeib${'d'.repeat(51)}`;
    const bookmarkUiUrl = `ipfs://${bookmarkUiCid}/`;
    const editedBookmarkUiUrl = `ipfs://${editedBookmarkUiCid}/`;
    const showBookmarkContextMenu = async (targetUrl) => {
      await page.evaluate((bookmarkTarget) => {
        const candidates = Array.from(
          document.querySelectorAll('.bookmark, .bookmarks-overflow-item')
        );
        const bookmark = candidates.find((candidate) => candidate.dataset.hash === bookmarkTarget);
        if (!bookmark) {
          throw new Error(`Bookmark not rendered for ${bookmarkTarget}`);
        }
        const rect = bookmark.getBoundingClientRect();
        bookmark.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 4,
            clientY: rect.top + 4,
          })
        );
      }, targetUrl);
      await expect(page.locator('.context-menu:not(.hidden) [data-action="edit"]')).toBeVisible();
      await expect(page.locator('.context-menu:not(.hidden) [data-action="delete"]')).toBeVisible();
    };
    const submitBookmarkModal = async () => {
      await page.locator('#add-bookmark-form').evaluate((form) => form.requestSubmit());
    };

    await setContentFixture(launched.app, bookmarkUiUrl, {
      body:
        '<!doctype html><title>Package Bookmark UI</title><p data-test="bookmark-ui-page">bookmark ui fixture</p>',
    });
    await navigateAddress(page, bookmarkUiUrl);
    await expectActiveWebviewText(page, '[data-test="bookmark-ui-page"]', 'bookmark ui fixture');
    await expect(page.locator('[data-test="add-bookmark-btn"]')).toBeVisible();
    await page.locator('[data-test="add-bookmark-btn"]').click();
    await expect(page.locator('#add-bookmark-modal')).toBeVisible();
    await expect(page.locator('#bookmark-modal-title')).toHaveText('Add Bookmark');
    await page.locator('#bookmark-label').fill('Package UI Bookmark');
    await submitBookmarkModal();
    await expect
      .poll(() =>
        page.evaluate((target) => {
          return window.freedomShell
            .getBookmarks()
            .then((bookmarks) =>
              bookmarks.some(
                (bookmark) =>
                  bookmark.target === target && bookmark.label === 'Package UI Bookmark'
              )
            );
        }, bookmarkUiUrl)
      )
      .toBe(true);
    await expect(page.locator('#add-bookmark-modal')).not.toBeVisible();

    await showBookmarkContextMenu(bookmarkUiUrl);
    await page.locator('.context-menu:not(.hidden) [data-action="edit"]').click();
    await expect(page.locator('#add-bookmark-modal')).toBeVisible();
    await expect(page.locator('#bookmark-modal-title')).toHaveText('Edit Bookmark');
    await page.locator('#bookmark-label').fill('Package UI Bookmark Edited');
    await page.locator('#bookmark-target').fill(editedBookmarkUiUrl);
    await submitBookmarkModal();
    await expect
      .poll(() =>
        page.evaluate(
          ({ oldTarget, newTarget }) => {
            return window.freedomShell.getBookmarks().then((bookmarks) => ({
              hasOld: bookmarks.some((bookmark) => bookmark.target === oldTarget),
              hasEdited: bookmarks.some(
                (bookmark) =>
                  bookmark.target === newTarget &&
                  bookmark.label === 'Package UI Bookmark Edited'
              ),
            }));
          },
          { oldTarget: bookmarkUiUrl, newTarget: editedBookmarkUiUrl }
        )
      )
      .toEqual({ hasOld: false, hasEdited: true });
    await expect(page.locator('#add-bookmark-modal')).not.toBeVisible();

    await showBookmarkContextMenu(editedBookmarkUiUrl);
    await page.locator('.context-menu:not(.hidden) [data-action="delete"]').click();
    await expect
      .poll(() =>
        page.evaluate((target) => {
          return window.freedomShell
            .getBookmarks()
            .then((bookmarks) => bookmarks.some((bookmark) => bookmark.target === target));
        }, editedBookmarkUiUrl)
      )
      .toBe(false);
    await expect(page.locator('[data-test="add-bookmark-btn"]')).not.toHaveClass(/bookmarked/);

    await page.locator('#home-btn').click();
    await expectHomeReady(page);

    const input = page.locator('[data-test="address-input"]');
    await input.click();
    await input.fill(firstDefaultBookmark.label);
    await expect(page.locator('.autocomplete-item').filter({ hasText: firstDefaultBookmark.label }))
      .toBeVisible();
    await input.press('Escape');

    const packagePasteText = 'package-paste-via-browser-clipboard';
    await clearClipboardText(launched.app);
    await launched.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), packagePasteText);
    await input.fill('');
    await input.click({ button: 'right' });
    const inputContextMenu = page.locator('[data-test="chrome-input-context-menu"]');
    await expect(inputContextMenu).toBeVisible();
    await expect(inputContextMenu.getByRole('button', { name: 'Paste' })).toBeDisabled();
    await expect(inputContextMenu.getByRole('button', { name: 'Paste' })).toHaveAttribute(
      'title',
      'Paste from this menu is unavailable in package mode; use the system paste shortcut'
    );
    await page.keyboard.press('Escape');
    await input.click();
    await input.press(`${pasteModifier}+v`);
    await expect.poll(async () => input.inputValue(), { timeout: 15_000 }).toBe(packagePasteText);

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

    const historyPageSeed = await page.evaluate(async () => {
      await window.freedomShell.addHistory({
        url: 'https://package-history-page-a.example/',
        title: 'Package History Page A',
        protocol: 'https',
      });
      await window.freedomShell.addHistory({
        url: 'https://package-history-page-b.example/',
        title: 'Package History Page B',
        protocol: 'https',
      });
      return window.freedomShell.getHistory({ query: 'Package History Page', limit: 5 });
    });
    expect(historyPageSeed.map((entry) => entry.title)).toEqual(
      expect.arrayContaining(['Package History Page A', 'Package History Page B'])
    );

    await clickVisibleMainMenuItem(page, '#history-btn');
    await expect
      .poll(() => getActiveWebviewUrl(page), {
        message: 'Waiting for package history page to load from visible menu action',
        timeout: 10_000,
      })
      .toContain('/pages/history.html');
    await expect
      .poll(() => getActiveWebviewHistoryPageState(page, 'Package History Page'), {
        message: 'Waiting for seeded history entries to render in package history page',
        timeout: 10_000,
      })
      .toMatchObject({
        exists: true,
        itemCount: 2,
        searchValue: 'Package History Page',
      });
    const historyPageState = await getActiveWebviewHistoryPageState(
      page,
      'Package History Page'
    );
    expect(historyPageState.titles).toEqual(
      expect.arrayContaining(['Package History Page A', 'Package History Page B'])
    );
    expect(historyPageState.urls).toEqual(
      expect.arrayContaining([
        'https://package-history-page-a.example/',
        'https://package-history-page-b.example/',
      ])
    );
    await expect(removeFirstActiveWebviewHistoryResult(page, 'Package History Page')).resolves.toBe(
      true
    );
    await expect
      .poll(() => getActiveWebviewHistoryPageState(page, 'Package History Page'), {
        message: 'Waiting for package history page removal to persist',
        timeout: 10_000,
      })
      .toMatchObject({
        exists: true,
        itemCount: 1,
        searchValue: 'Package History Page',
      });
    await page.locator('#home-btn').click();
    await expectHomeReady(page);

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
    await page.evaluate(() => {
      const webview = document.querySelector('webview:not(.hidden)');
      if (!webview) {
        throw new Error('No active webview for DevTools recorder');
      }
      let opened = false;
      window.__freedomDevToolsCalls = [];
      webview.openDevTools = () => {
        opened = true;
        window.__freedomDevToolsCalls.push('open');
      };
      webview.closeDevTools = () => {
        opened = false;
        window.__freedomDevToolsCalls.push('close');
      };
      webview.isDevToolsOpened = () => opened;
    });
    await clickApplicationMenuItem(launched.app, 'toggle-devtools');
    await expect.poll(() => page.evaluate(() => window.__freedomDevToolsCalls)).toEqual(['open']);
    await clickApplicationMenuItem(launched.app, 'toggle-devtools');
    await expect.poll(() => page.evaluate(() => window.__freedomDevToolsCalls)).toEqual([
      'open',
      'close',
    ]);

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
        <p data-test="provider-accounts">pending</p>
        <p data-test="provider-transaction">pending</p>
        <p data-test="provider-signature">pending</p>
        <p data-test="swarm-provider-present">pending</p>
        <p data-test="swarm-provider-capabilities">pending</p>
        <p data-test="swarm-provider-access">pending</p>
        <p data-test="swarm-provider-publish">pending</p>
        <p data-test="swarm-provider-files">pending</p>
        <p data-test="swarm-provider-chunk">pending</p>
        <p data-test="swarm-provider-feed">pending</p>
        <p data-test="swarm-provider-signing">pending</p>
        <p data-test="swarm-provider-soc">pending</p>
        <p data-test="swarm-provider-feed-update">pending</p>
        <p data-test="swarm-provider-feed-entry">pending</p>
        <script>
          (() => {
            const setText = (selector, value) => {
              const element = document.querySelector(selector);
              if (element) element.textContent = value;
            };
            const waitForSwarm = () => new Promise((resolve) => {
              let attempts = 0;
              const poll = () => {
                if (window.swarm && typeof window.swarm.getCapabilities === 'function') {
                  resolve(window.swarm);
                  return;
                }
                attempts += 1;
                if (attempts >= 30) {
                  resolve(null);
                  return;
                }
                setTimeout(poll, 100);
              };
              poll();
            });
            const run = async () => {
              const provider = window.ethereum;
              const present = provider && typeof provider.request === 'function';
              setText('[data-test="provider-present"]', present ? 'present' : 'missing');
              if (present) {
                try {
                  const chainId = await provider.request({ method: 'eth_chainId' });
                  setText('[data-test="provider-chain"]', chainId);
                } catch (error) {
                  setText('[data-test="provider-chain"]', 'error:' + (error.message || error));
                }
                try {
                  const accounts = await provider.request({ method: 'eth_requestAccounts' });
                  setText(
                    '[data-test="provider-accounts"]',
                    Array.isArray(accounts) ? accounts.join(',') : String(accounts)
                  );
                } catch (error) {
                  setText(
                    '[data-test="provider-accounts"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  const accounts = await provider.request({ method: 'eth_accounts' });
                  const accountText = Array.isArray(accounts) ? accounts.join(',') : String(accounts);
                  if (accountText !== document.querySelector('[data-test="provider-accounts"]')?.textContent) {
                    setText('[data-test="provider-accounts"]', 'eth_accounts-mismatch:' + accountText);
                  }
                } catch (error) {
                  setText(
                    '[data-test="provider-accounts"]',
                    'eth_accounts-error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  await provider.request({
                    method: 'eth_sendTransaction',
                    params: [{ to: '0x0000000000000000000000000000000000000001', value: '0x0' }],
                  });
                  setText('[data-test="provider-transaction"]', 'unexpected-success');
                } catch (error) {
                  setText(
                    '[data-test="provider-transaction"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  await provider.request({
                    method: 'personal_sign',
                    params: ['0x68656c6c6f', '${packageSmokeWalletAddress}'],
                  });
                  setText('[data-test="provider-signature"]', 'unexpected-success');
                } catch (error) {
                  setText(
                    '[data-test="provider-signature"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
              }

              const swarm = await waitForSwarm();
              const swarmPresent = swarm && typeof swarm.getCapabilities === 'function';
              setText(
                '[data-test="swarm-provider-present"]',
                swarmPresent ? 'present' : 'missing'
              );
              if (swarmPresent) {
                try {
                  const capabilities = await swarm.getCapabilities();
                  setText(
                    '[data-test="swarm-provider-capabilities"]',
                    capabilities?.reason || 'ready'
                  );
                } catch (error) {
                  setText(
                    '[data-test="swarm-provider-capabilities"]',
                    'error:' + (error.message || error)
                  );
                }
                try {
                  const access = await swarm.requestAccess();
                  setText(
                    '[data-test="swarm-provider-access"]',
                    access?.connected ? 'connected:' + access.origin : 'not-connected'
                  );
                } catch (error) {
                  setText(
                    '[data-test="swarm-provider-access"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  await swarm.publishData({ data: 'hello', contentType: 'text/plain' });
                  setText('[data-test="swarm-provider-publish"]', 'unexpected-success');
                } catch (error) {
                  setText(
                    '[data-test="swarm-provider-publish"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  const encoder = new TextEncoder();
                  await swarm.publishFiles({
                    files: [
                      {
                        path: 'index.html',
                        bytes: encoder.encode('home'),
                        contentType: 'text/html',
                      },
                      {
                        path: 'style.css',
                        bytes: encoder.encode('body'),
                        contentType: 'text/css',
                      },
                    ],
                    indexDocument: 'index.html',
                  });
                  setText('[data-test="swarm-provider-files"]', 'unexpected-success');
                } catch (error) {
                  setText(
                    '[data-test="swarm-provider-files"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  await swarm.publishChunk({ data: 'hello' });
                  setText('[data-test="swarm-provider-chunk"]', 'unexpected-success');
                } catch (error) {
                  setText(
                    '[data-test="swarm-provider-chunk"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  await swarm.createFeed({ name: 'blog' });
                  setText('[data-test="swarm-provider-feed"]', 'unexpected-success');
                } catch (error) {
                  setText(
                    '[data-test="swarm-provider-feed"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  await swarm.getSigningIdentity();
                  setText('[data-test="swarm-provider-signing"]', 'unexpected-success');
                } catch (error) {
                  setText(
                    '[data-test="swarm-provider-signing"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  await swarm.writeSingleOwnerChunk({
                    identifier: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                    data: 'hello',
                  });
                  setText('[data-test="swarm-provider-soc"]', 'unexpected-success');
                } catch (error) {
                  setText(
                    '[data-test="swarm-provider-soc"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  await swarm.updateFeed({
                    feedId: 'blog',
                    reference: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  });
                  setText('[data-test="swarm-provider-feed-update"]', 'unexpected-success');
                } catch (error) {
                  setText(
                    '[data-test="swarm-provider-feed-update"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
                try {
                  await swarm.writeFeedEntry({
                    name: 'blog',
                    data: 'hello',
                    index: 2,
                  });
                  setText('[data-test="swarm-provider-feed-entry"]', 'unexpected-success');
                } catch (error) {
                  setText(
                    '[data-test="swarm-provider-feed-entry"]',
                    'error:' + (error.code || 'unknown') + ':' + (error.data?.reason || error.message || error)
                  );
                }
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
    await launched.app.evaluate(({ dialog }) => {
      const nodeRequire =
        (typeof require === 'function' && require) ||
        globalThis.require ||
        process.mainModule?.require?.bind(process.mainModule);
      if (!nodeRequire) {
        throw new Error('Node require is unavailable in Electron main evaluation context');
      }
      const pathModule = nodeRequire('path');
      const trustedWalletApprovalPrompt = nodeRequire(
        pathModule.join(process.cwd(), 'src', 'main', 'trusted-wallet-approval-prompt.js')
      );
      const trustedSwarmApprovalPrompt = nodeRequire(
        pathModule.join(process.cwd(), 'src', 'main', 'trusted-swarm-approval-prompt.js')
      );
      trustedWalletApprovalPrompt.presentTrustedWalletApprovalPrompt = async (
        request,
        context = {}
      ) => {
        globalThis.__freedomWalletTrustedApprovalPrompts.push({
          request,
          context: {
            origin: context.origin || null,
            webContentsId: context.webContentsId ?? null,
            hasOwnerWindow: !!context.ownerWindow,
            ownerWindowDestroyed: context.ownerWindow?.isDestroyed?.() ?? null,
            caller: context.caller || null,
          },
        });
        if (request?.kind === 'wallet.transaction' || request?.kind === 'wallet.signature') {
          return {
            ok: true,
            outcome: 'rejected',
            response: 1,
            renderedBy: 'trusted-wallet-approval-window',
            presentation: 'trusted-window',
            source: 'trusted-wallet-approval-window',
          };
        }
        return {
          ok: true,
          outcome: 'accepted',
          response: 0,
          renderedBy: 'trusted-wallet-approval-window',
          presentation: 'trusted-window',
          source: 'trusted-wallet-approval-window',
          selectedWalletIndex: request?.details?.accountChoices?.[0]?.walletIndex,
          selectedAccount: request?.details?.accountChoices?.[0]?.account,
        };
      };
      globalThis.__freedomWalletTrustedApprovalPrompts = [];
      trustedSwarmApprovalPrompt.presentTrustedSwarmApprovalPrompt = async (
        request,
        context = {}
      ) => {
        const promptContext = trustedSwarmApprovalPrompt.buildPromptContext(request, context);
        globalThis.__freedomSwarmTrustedApprovalPrompts.push({
          request,
          promptContext,
          context: {
            origin: context.origin || null,
            webContentsId: context.webContentsId ?? null,
            hasOwnerWindow: !!context.ownerWindow,
            ownerWindowDestroyed: context.ownerWindow?.isDestroyed?.() ?? null,
            caller: context.caller || null,
          },
        });
        return {
          ok: true,
          outcome: 'accepted',
          response: 0,
          renderedBy: 'trusted-swarm-approval-window',
          presentation: 'trusted-window',
          source: 'trusted-swarm-approval-window',
        };
      };
      globalThis.__freedomSwarmTrustedApprovalPrompts = [];
      globalThis.__freedomProviderPromptDialogs = [];
      dialog.showMessageBox = async (ownerWindow, options) => {
        globalThis.__freedomProviderPromptDialogs.push({
          hasOwnerWindow: !!ownerWindow,
          ownerWindowDestroyed: ownerWindow?.isDestroyed?.() ?? null,
          options,
        });
        return { response: 0 };
      };
    });
    await navigateAddress(page, `ipfs://${providerIpfsCid}/`);
    await expectActiveWebviewText(page, '[data-test="provider-present"]', 'present');
    await expectActiveWebviewText(page, '[data-test="provider-chain"]', '0x64');
    await expectActiveWebviewText(
      page,
      '[data-test="provider-accounts"]',
      packageSmokeWalletAddress
    );
    await expectActiveWebviewText(
      page,
      '[data-test="provider-transaction"]',
      'error:4001:shell_trusted_prompt_rejected'
    );
    await expectActiveWebviewText(
      page,
      '[data-test="provider-signature"]',
      'error:4001:shell_trusted_prompt_rejected'
    );
    const walletApprovalPrompts = await launched.app.evaluate(
      () => globalThis.__freedomWalletTrustedApprovalPrompts
    );
    const walletConnectApprovalPrompt = walletApprovalPrompts.find(
      (prompt) => prompt.request?.kind === 'wallet.connect'
    );
    expect(walletConnectApprovalPrompt).toMatchObject({
      context: {
        hasOwnerWindow: true,
        ownerWindowDestroyed: false,
        origin: `ipfs://${providerIpfsCid}`,
        webContentsId: expect.any(Number),
      },
      request: {
        kind: 'wallet.connect',
        method: 'eth_requestAccounts',
        origin: `ipfs://${providerIpfsCid}`,
        details: {
          method: 'eth_requestAccounts',
          chainId: 100,
          walletIndex: 0,
          activeAccount: packageSmokeWalletAddress,
          accountChoices: [
            {
              walletIndex: 0,
              account: packageSmokeWalletAddress,
              active: true,
            },
          ],
        },
      },
    });
    const walletTransactionApprovalPrompt = walletApprovalPrompts.find(
      (prompt) => prompt.request?.kind === 'wallet.transaction'
    );
    expect(walletTransactionApprovalPrompt).toMatchObject({
      context: {
        hasOwnerWindow: true,
        ownerWindowDestroyed: false,
        origin: `ipfs://${providerIpfsCid}`,
        webContentsId: expect.any(Number),
      },
      request: {
        kind: 'wallet.transaction',
        method: 'eth_sendTransaction',
        origin: `ipfs://${providerIpfsCid}`,
        details: {
          method: 'eth_sendTransaction',
          account: packageSmokeWalletAddress,
          walletIndex: 0,
          chainId: 100,
          accountChoices: [
            {
              walletIndex: 0,
              account: packageSmokeWalletAddress,
              active: true,
            },
          ],
          to: '0x0000000000000000000000000000000000000001',
          value: '0x0',
        },
      },
    });
    const walletSignatureApprovalPrompt = walletApprovalPrompts.find(
      (prompt) => prompt.request?.kind === 'wallet.signature'
    );
    expect(walletSignatureApprovalPrompt).toMatchObject({
      context: {
        hasOwnerWindow: true,
        ownerWindowDestroyed: false,
        origin: `ipfs://${providerIpfsCid}`,
        webContentsId: expect.any(Number),
      },
      request: {
        kind: 'wallet.signature',
        method: 'personal_sign',
        origin: `ipfs://${providerIpfsCid}`,
        details: {
          method: 'personal_sign',
          account: packageSmokeWalletAddress,
          requestedAccount: packageSmokeWalletAddress,
          walletIndex: 0,
          chainId: 100,
          accountChoices: [
            {
              walletIndex: 0,
              account: packageSmokeWalletAddress,
              active: true,
            },
          ],
          messagePreview: '0x68656c6c6f',
          payloadSize: '12 chars',
        },
      },
    });
    await expectActiveWebviewText(page, '[data-test="swarm-provider-present"]', 'present');
    await expectActiveWebviewText(
      page,
      '[data-test="swarm-provider-capabilities"]',
      'not-connected'
    );
    await expectActiveWebviewText(
      page,
      '[data-test="swarm-provider-access"]',
      `connected:ipfs://${providerIpfsCid}`
    );
    await expectActiveWebviewText(
      page,
      '[data-test="swarm-provider-publish"]',
      'error:4900:node-stopped'
    );
    await expectActiveWebviewText(
      page,
      '[data-test="swarm-provider-files"]',
      'error:4900:node-stopped'
    );
    await expectActiveWebviewText(
      page,
      '[data-test="swarm-provider-chunk"]',
      'error:4900:node-stopped'
    );
    await expectActiveWebviewText(
      page,
      '[data-test="swarm-provider-feed"]',
      'error:4900:node-stopped'
    );
    await expectActiveWebviewText(
      page,
      '[data-test="swarm-provider-signing"]',
      'error:-32603:Vault must be unlocked to derive publisher keys'
    );
    await expectActiveWebviewText(
      page,
      '[data-test="swarm-provider-soc"]',
      'error:-32603:Vault must be unlocked to derive publisher keys'
    );
    await expectActiveWebviewText(
      page,
      '[data-test="swarm-provider-feed-update"]',
      'error:-32602:feed_not_found'
    );
    await expectActiveWebviewText(
      page,
      '[data-test="swarm-provider-feed-entry"]',
      'error:-32602:feed_not_found'
    );
    const swarmApprovalPrompts = await launched.app.evaluate(
      () => globalThis.__freedomSwarmTrustedApprovalPrompts
    );
    const promptFor = (kind, method) =>
      swarmApprovalPrompts.find(
        (prompt) => prompt.request?.kind === kind && prompt.request?.method === method
      );
    const trustedSwarmContext = {
      hasOwnerWindow: true,
      ownerWindowDestroyed: false,
      origin: `ipfs://${providerIpfsCid}`,
      webContentsId: expect.any(Number),
    };
    expect(promptFor('swarm.connect', 'swarm_requestAccess')).toMatchObject({
      context: trustedSwarmContext,
      request: {
        kind: 'swarm.connect',
        method: 'swarm_requestAccess',
        origin: `ipfs://${providerIpfsCid}`,
      },
    });
    expect(promptFor('swarm.publish', 'swarm_publishData')).toMatchObject({
      context: trustedSwarmContext,
      request: {
        kind: 'swarm.publish',
        method: 'swarm_publishData',
        origin: `ipfs://${providerIpfsCid}`,
        details: {
          contentType: 'text/plain',
          sizeBytes: 5,
        },
      },
    });
    expect(promptFor('swarm.publish', 'swarm_publishFiles')).toMatchObject({
      context: trustedSwarmContext,
      request: {
        kind: 'swarm.publish',
        method: 'swarm_publishFiles',
        origin: `ipfs://${providerIpfsCid}`,
        details: {
          fileCount: 2,
          sizeBytes: 8,
          indexDocument: 'index.html',
        },
      },
    });
    expect(promptFor('swarm.publish', 'swarm_publishChunk')).toMatchObject({
      context: trustedSwarmContext,
      request: {
        kind: 'swarm.publish',
        method: 'swarm_publishChunk',
        origin: `ipfs://${providerIpfsCid}`,
        details: {
          target: 'chunk',
          sizeBytes: 5,
        },
      },
    });
    const swarmSigningPrompts = swarmApprovalPrompts.filter(
      (prompt) => prompt.request?.kind === 'swarm.signing'
    );
    expect(swarmSigningPrompts).toHaveLength(2);
    expect(promptFor('swarm.signing', 'swarm_getSigningIdentity')).toMatchObject({
      context: trustedSwarmContext,
      request: {
        kind: 'swarm.signing',
        method: 'swarm_getSigningIdentity',
        origin: `ipfs://${providerIpfsCid}`,
        details: {
          action: 'identity',
        },
      },
    });
    expect(promptFor('swarm.signing', 'swarm_writeSingleOwnerChunk')).toMatchObject({
      context: trustedSwarmContext,
      request: {
        kind: 'swarm.signing',
        method: 'swarm_writeSingleOwnerChunk',
        origin: `ipfs://${providerIpfsCid}`,
        details: {
          action: 'soc',
          identifier: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          sizeBytes: 5,
        },
      },
    });
    const swarmFeedPrompts = swarmApprovalPrompts.filter(
      (prompt) => prompt.request?.kind === 'swarm.feed'
    );
    expect(swarmFeedPrompts).toHaveLength(1);
    expect(promptFor('swarm.feed', 'swarm_createFeed')).toMatchObject({
      context: trustedSwarmContext,
      promptContext: {
        feedReview: {
          title: 'Feed review',
          items: expect.arrayContaining([
            { label: 'Operation', value: 'Create feed' },
            { label: 'Feed', value: 'blog' },
            { label: 'Identity', value: 'app-scoped' },
          ]),
        },
      },
      request: {
        kind: 'swarm.feed',
        method: 'swarm_createFeed',
        origin: `ipfs://${providerIpfsCid}`,
        details: {
          action: 'create',
          feedName: 'blog',
          identityMode: 'app-scoped',
        },
      },
    });
    const providerPromptDialogs = await launched.app.evaluate(
      () => globalThis.__freedomProviderPromptDialogs
    );
    expect(
      providerPromptDialogs.filter((dialog) =>
        typeof dialog.options?.title === 'string' &&
        dialog.options.title.startsWith('Freedom Swarm')
      )
    ).toHaveLength(0);

    const activeWebContentsId = await getActiveWebviewWebContentsId(page);
    const x402SmokeResult = await triggerPackageHostedX402Approval(
      launched.app,
      activeWebContentsId
    );
    expect(x402SmokeResult.result).toEqual({
      statusLine: 'HTTP/1.1 307 Temporary Redirect',
      responseHeaders: { Location: [sampleX402PaymentUrl] },
    });
    expect(x402SmokeResult.detectedAfter).toBeNull();
    expect(x402SmokeResult.hostEvents).toEqual([]);
    expect(x402SmokeResult.signCalls).toEqual([
      {
        webContentsId: activeWebContentsId,
        authorizedBy: 'manual',
        hasGrant: true,
        grant: { capAmount: '10000000', windowSeconds: 30 * 24 * 60 * 60 },
        selectedAcceptIndex: null,
        detection: {
          url: sampleX402PaymentUrl,
          resourceType: 'xhr',
        },
      },
      {
        webContentsId: activeWebContentsId,
        authorizedBy: 'manual',
        hasGrant: true,
        grant: { capAmount: '10000000', windowSeconds: 30 * 24 * 60 * 60 },
        selectedAcceptIndex: null,
        detection: {
          url: sampleX402PaymentUrl,
          resourceType: 'xhr',
        },
      },
    ]);
    expect(x402SmokeResult.approvalPrompts).toEqual([
      {
        request: expect.objectContaining({
          kind: 'x402.approval',
          method: 'x402_approval',
          origin: 'https://api.example',
          webContentsId: activeWebContentsId,
          details: {
            x402Version: 2,
            amount: '10000',
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            network: 'eip155:8453',
            payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
            defaultGrant: {
              capAmount: '10000000',
              windowSeconds: 30 * 24 * 60 * 60,
              selectedAcceptIndex: 0,
              label: '10 USDC for 30 days',
            },
            resource: 'https://api.example/article',
          },
        }),
        context: expect.objectContaining({
          origin: 'https://api.example',
          webContentsId: activeWebContentsId,
          hasOwnerWindow: true,
          ownerWindowDestroyed: false,
          caller: expect.objectContaining({
            runtimeMode: 'local-package',
            packageType: 'browser-chrome',
          }),
        }),
      },
    ]);
    expect(x402SmokeResult.vaultUnlockPrompts).toEqual([
      {
        request: expect.objectContaining({
          kind: 'x402.vaultUnlock',
          method: 'x402_vaultUnlock',
          origin: 'https://api.example',
          webContentsId: activeWebContentsId,
          details: {
            x402Version: 2,
            amount: '10000',
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            network: 'eip155:8453',
            payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
            defaultGrant: {
              capAmount: '10000000',
              windowSeconds: 30 * 24 * 60 * 60,
              selectedAcceptIndex: 0,
              label: '10 USDC for 30 days',
            },
            resource: 'https://api.example/article',
          },
        }),
        context: expect.objectContaining({
          origin: 'https://api.example',
          webContentsId: activeWebContentsId,
          hasOwnerWindow: true,
          ownerWindowDestroyed: false,
          caller: expect.objectContaining({
            runtimeMode: 'local-package',
            packageType: 'browser-chrome',
          }),
        }),
      },
    ]);
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

    await navigateAddress(page, 'freedom://settings/startup');
    await expect
      .poll(() => getActiveWebviewUrl(page), {
        message: 'Waiting for freedom://settings to load in package webview',
        timeout: 10_000,
      })
      .toContain('/pages/settings.html');
    await expect
      .poll(() => getActiveWebviewPackageSettingsBoundaryState(page), {
        message: 'Waiting for package settings restricted mode',
        timeout: 10_000,
      })
      .toMatchObject({
        exists: true,
        packageMode: 'restricted',
        startAntDisabled: true,
        startIpfsDisabled: true,
        enableIdentityDisabled: true,
        autoUpdateDisabled: true,
        swarmModeHidden: true,
        swarmModeHelp: 'Swarm node mode is shell-owned and unavailable in package mode.',
      });

    await navigateAddress(page, 'freedom://settings/chains');
    await expect
      .poll(() => getActiveWebviewPackageSettingsBoundaryState(page), {
        message: 'Waiting for package chains settings unavailable state',
        timeout: 10_000,
      })
      .toMatchObject({ exists: true, packageMode: 'restricted' });
    expect((await getActiveWebviewPackageSettingsBoundaryState(page)).chainsText).toContain(
      'Network and RPC provider settings are shell-owned and unavailable in package mode'
    );

    await navigateAddress(page, 'freedom://settings/rpc');
    await expect
      .poll(() => getActiveWebviewPackageSettingsBoundaryState(page), {
        message: 'Waiting for package RPC settings unavailable state',
        timeout: 10_000,
      })
      .toMatchObject({ exists: true, packageMode: 'restricted' });
    expect((await getActiveWebviewPackageSettingsBoundaryState(page)).rpcText).toContain(
      'Network and RPC provider settings are shell-owned and unavailable in package mode'
    );

    await navigateAddress(page, 'freedom://settings/ens');
    await expect
      .poll(() => getActiveWebviewPackageSettingsBoundaryState(page), {
        message: 'Waiting for package ENS settings unavailable state',
        timeout: 10_000,
      })
      .toMatchObject({
        exists: true,
        packageMode: 'restricted',
        ensMethodDisabled: true,
        ensProverDisabled: true,
        ensHelp: 'Network and RPC provider settings are shell-owned and unavailable in package mode',
      });

    await navigateAddress(page, 'freedom://settings/profiles');
    await expect
      .poll(() => getActiveWebviewUrl(page), {
        message: 'Waiting for freedom://settings/profiles to load in package webview',
        timeout: 10_000,
      })
      .toContain('/pages/settings.html');
    await expect
      .poll(() => getActiveWebviewProfileSettingsState(page), {
        message: 'Waiting for package profile settings unavailable state',
        timeout: 10_000,
      })
      .toMatchObject({
        exists: true,
        unavailable: 'true',
        displayName: 'Profile management unavailable',
        runtime: 'Shell-owned',
        createDisabled: true,
        createNameDisabled: true,
      });
    const profileSettingsState = await getActiveWebviewProfileSettingsState(page);
    expect(profileSettingsState.nodesText).toContain(
      'Profile management is shell-owned and unavailable in package mode'
    );
    expect(profileSettingsState.managerText).toContain(
      'Profile management is shell-owned and unavailable in package mode'
    );

    await navigateAddress(page, 'freedom://publish');
    await expect
      .poll(() => getActiveWebviewUrl(page), {
        message: 'Waiting for freedom://publish to load in package webview',
        timeout: 10_000,
      })
      .toContain('/pages/publish.html');
    await expect
      .poll(() => getActiveWebviewPublishPageState(page), {
        message: 'Waiting for package publish page unavailable state',
        timeout: 10_000,
      })
      .toMatchObject({
        exists: true,
        unavailable: 'true',
        bannerText: 'Swarm publishing is shell-owned and unavailable in package mode',
        bannerHidden: false,
        file: { exists: true, disabled: true },
        folder: { exists: true, disabled: true },
        text: { exists: true, disabled: true },
        textInputHidden: true,
        historyClearDisabled: true,
        trustedPublishExists: true,
      });
    await page.evaluate(async () => {
      const webview = document.querySelector('webview:not(.hidden)');
      await webview.executeJavaScript(`
        document.getElementById('open-trusted-swarm-publish-surface').click();
      `);
    });
    await expect.poll(() =>
      page.evaluate(() =>
        window.freedomShell.getSurfaceState('swarmPublish').then((state) => state.open)
      )
    ).toBe(true);
    await page.evaluate(() => window.freedomShell.closeSurface('swarmPublish'));

    await navigateAddress(page, 'freedom://payments');
    await expect
      .poll(() => getActiveWebviewUrl(page), {
        message: 'Waiting for freedom://payments to load in package webview',
        timeout: 10_000,
      })
      .toContain('/pages/payments.html');
    await expect
      .poll(() => getActiveWebviewPaymentsPageState(page), {
        message: 'Waiting for package payments page unavailable state',
        timeout: 10_000,
      })
      .toMatchObject({
        exists: true,
        unavailable: 'true',
        stats: 'Payment history unavailable',
        searchDisabled: true,
        kindDisabled: true,
        chainDisabled: true,
        clearDisabled: true,
        openTrustedExists: true,
      });
    expect((await getActiveWebviewPaymentsPageState(page)).message).toContain(
      'Payment history is shell-owned and unavailable in package mode'
    );
    await page.evaluate(async () => {
      const webview = document.querySelector('webview:not(.hidden)');
      await webview.executeJavaScript(`
        document.getElementById('open-trusted-payments-surface').click();
      `);
    });
    await expect.poll(() =>
      page.evaluate(() => window.freedomShell.getSurfaceState('payments').then((state) => state.open))
    ).toBe(true);
    await page.evaluate(() => window.freedomShell.closeSurface('payments'));

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
