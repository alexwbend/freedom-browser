// Private windows — ephemeral browsing on a per-window non-persisted
// partition. These specs drive the real File-menu item and assert the
// promises the feature makes: distinct badged chrome, isolated partition,
// wallet providers unavailable, and no traces (history rows, downloads
// history, cookies) surviving the window.
//
// All content is served by the in-process test harness (http/https and
// bzz/ipfs/ipns are stubbed per session — including private sessions,
// which get the same stubs via the private-session configurator).

const { test, expect } = require('./fixtures');

const DATA_URI = 'data:application/octet-stream;base64,ZnJlZWRvbS1wcml2YXRlLWUyZQ==';

// Click the real File-menu item (id: new-private-window) and wait for the
// new chrome window to boot. Resolved by URL rather than via
// electronApp.waitForEvent('window'): webview guests surface as separate
// Playwright pages too, so the first 'window' event after the click can be
// the private start page's guest instead of the chrome window.
async function openPrivateWindow(electronApp) {
  const knownChrome = new Set(
    electronApp
      .windows()
      .filter((page) => page.url().includes('privatePartition=private-'))
      .map((page) => page.url())
  );
  await electronApp.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('new-private-window');
    if (!item) throw new Error('New Private Window menu item not found');
    item.click();
  });
  let page;
  await expect
    .poll(
      () => {
        page = electronApp
          .windows()
          .find(
            (candidate) =>
              candidate.url().includes('privatePartition=private-') &&
              !knownChrome.has(candidate.url())
          );
        return !!page;
      },
      { message: 'Waiting for the private chrome window', timeout: 15_000 }
    )
    .toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-test="address-input"]', { state: 'visible' });
  return page;
}

// Navigate a chrome window's active tab through the address bar.
async function navigateTo(page, url) {
  const input = page.locator('[data-test="address-input"]');
  await input.click();
  await input.fill(url);
  await input.press('Enter');
}

// Run a script inside the window's active webview (poll until the guest
// page is ready).
async function evalInActiveWebview(page, script) {
  return expect
    .poll(
      () =>
        page.evaluate(async (guestScript) => {
          const wv = document.querySelector('webview:not(.hidden)');
          if (!wv || typeof wv.executeJavaScript !== 'function') return undefined;
          try {
            return await wv.executeJavaScript(guestScript);
          } catch {
            return undefined;
          }
        }, script),
      { timeout: 10_000, intervals: [200, 500, 1000] }
    )
    .not.toBe(undefined)
    .then(() =>
      page.evaluate(async (guestScript) => {
        const wv = document.querySelector('webview:not(.hidden)');
        return wv.executeJavaScript(guestScript);
      }, script)
    );
}

// Wait until the active webview is on the harness https stub for `url`.
async function waitForStubPage(page, url) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const wv = document.querySelector('webview:not(.hidden)');
          if (!wv || typeof wv.executeJavaScript !== 'function') return null;
          try {
            return await wv.executeJavaScript(
              'document.querySelector(\'[data-test="harness-http-stub-url"]\')?.textContent || null'
            );
          } catch {
            return null;
          }
        }),
      { message: `Waiting for harness stub at ${url}`, timeout: 10_000 }
    )
    .toBe(url);
}

// Close every private window (identified by the privatePartition query
// parameter its chrome renderer was loaded with).
async function closePrivateWindows(electronApp) {
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().includes('privatePartition=private-')) {
        win.close();
      }
    }
  });
}

test('private window: badge, isolated partition, private start page, no wallet providers', async ({
  window,
  electronApp,
}) => {
  // Normal window: no badge, webviews carry no partition.
  await expect(window.locator('[data-test="private-badge"]')).toBeHidden();
  const normalPartition = await window.evaluate(() =>
    document.querySelector('webview')?.getAttribute('partition')
  );
  expect(normalPartition).toBeFalsy();

  const priv = await openPrivateWindow(electronApp);

  // Distinct chrome: badge + body class.
  await expect(priv.locator('[data-test="private-badge"]')).toBeVisible();
  expect(await priv.evaluate(() => document.body.classList.contains('private-window'))).toBe(true);

  // First tab is the private start page with the honest copy.
  const startPageBadge = await evalInActiveWebview(
    priv,
    'document.querySelector(\'[data-test="private-page-badge"]\')?.textContent || null'
  );
  expect(startPageBadge).toBe('Private window');
  const walletNote = await evalInActiveWebview(
    priv,
    'document.querySelector(\'[data-test="private-wallet-note"]\')?.textContent || null'
  );
  expect(walletNote).toContain('Wallet is disabled in private windows');

  // Every webview runs on the window's unique non-persisted partition.
  const partition = await priv.evaluate(() =>
    document.querySelector('webview')?.getAttribute('partition')
  );
  expect(partition).toMatch(/^private-[0-9a-f-]{36}$/);
  expect(partition.startsWith('persist:')).toBe(false);

  // Wallet providers are not injected in private windows…
  await navigateTo(priv, 'https://dapp.example');
  await waitForStubPage(priv, 'https://dapp.example/');
  expect(await evalInActiveWebview(priv, 'typeof window.ethereum')).toBe('undefined');
  expect(await evalInActiveWebview(priv, 'typeof window.swarm')).toBe('undefined');
  expect(await evalInActiveWebview(priv, 'typeof window.radicle')).toBe('undefined');

  // …but are injected on the same page in a normal window (sanity check
  // that the assertion above isn't vacuous).
  await navigateTo(window, 'https://dapp.example');
  await waitForStubPage(window, 'https://dapp.example/');
  expect(await evalInActiveWebview(window, 'typeof window.ethereum')).toBe('object');
  expect(await evalInActiveWebview(window, 'typeof window.swarm')).toBe('object');
  expect(await evalInActiveWebview(window, 'typeof window.radicle')).toBe('object');

  await closePrivateWindows(electronApp);
});

test('private browsing leaves no history, no downloads history, and no cookies behind', async ({
  window,
  electronApp,
}) => {
  const PRIVATE_URL = 'https://private-visit.example';
  const NORMAL_URL = 'https://normal-visit.example';

  // Sanity: prove the history pipeline works at all via a normal-window
  // navigation, so the "no private rows" assertions below can't pass
  // vacuously.
  await navigateTo(window, NORMAL_URL);
  await waitForStubPage(window, `${NORMAL_URL}/`);
  // The recorded display URL carries the canonical trailing slash.
  await expect
    .poll(
      () =>
        window.evaluate(async (prefix) => {
          const rows = await window.electronAPI.getHistory();
          return rows.filter((r) => r.url.startsWith(prefix)).length;
        }, NORMAL_URL),
      { timeout: 10_000 }
    )
    .toBeGreaterThan(0);

  const priv = await openPrivateWindow(electronApp);

  // Browse in the private window and set a cookie on the stub origin.
  await navigateTo(priv, PRIVATE_URL);
  await waitForStubPage(priv, `${PRIVATE_URL}/`);
  await evalInActiveWebview(
    priv,
    "document.cookie = 'freedomtest=secret; path=/'; localStorage.setItem('freedomtest', 'secret'); document.cookie"
  );

  // Trigger a download from the private webview's (private) session.
  await priv.evaluate((dataUri) => {
    const wv = document.querySelector('webview:not(.hidden)');
    wv.downloadURL(dataUri);
  }, DATA_URI);

  // The download lands in the manager, flagged private — visible in the
  // private window's own (merged, in-memory) view…
  await expect
    .poll(
      () =>
        priv.evaluate(async () => {
          const rows = await window.electronAPI.getDownloads({});
          return rows.filter((r) => r.is_private === 1).length;
        }),
      { timeout: 10_000 }
    )
    .toBeGreaterThan(0);

  // …but NEVER in a normal window's view, even while the private window is
  // still open: private rows exist only in the in-memory partition store,
  // are never written to the profile database, and are never served to
  // normal-window queries.
  const normalViewPrivateRows = await window.evaluate(async () => {
    const rows = await window.electronAPI.getDownloads({});
    return rows.filter((r) => r.is_private === 1).length;
  });
  expect(normalViewPrivateRows).toBe(0);

  // Close the private window → its traces must evaporate.
  await closePrivateWindows(electronApp);

  // No history rows for the private navigation (the normal row stays).
  const historyUrls = await window.evaluate(async () => {
    const rows = await window.electronAPI.getHistory();
    return rows.map((r) => r.url);
  });
  expect(historyUrls.some((url) => url.startsWith(PRIVATE_URL))).toBe(false);
  expect(historyUrls.some((url) => url.startsWith(NORMAL_URL))).toBe(true);

  // No downloads-history rows survive the window (files stay on disk).
  // The in-memory partition store is dropped with the window; the profile
  // database never held the rows in the first place.
  await expect
    .poll(
      () =>
        window.evaluate(async () => {
          const rows = await window.electronAPI.getDownloads({});
          return rows.filter((r) => r.is_private === 1).length;
        }),
      { timeout: 10_000 }
    )
    .toBe(0);

  // Cmd/Ctrl+Shift+T in the normal window must not resurrect private tabs.
  const tabCountBefore = await window.locator('[data-test="tab"]').count();
  await window.locator('[data-test="address-input"]').click();
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+T' : 'Control+Shift+T');
  await window.waitForTimeout(500);
  expect(await window.locator('[data-test="tab"]').count()).toBe(tabCountBefore);

  // A fresh private window gets a fresh partition: the cookie and
  // localStorage from the previous private session are gone.
  const priv2 = await openPrivateWindow(electronApp);
  await navigateTo(priv2, PRIVATE_URL);
  await waitForStubPage(priv2, `${PRIVATE_URL}/`);
  expect(await evalInActiveWebview(priv2, 'document.cookie')).toBe('');
  expect(await evalInActiveWebview(priv2, "localStorage.getItem('freedomtest')")).toBe(null);

  // And the default (normal-window) session never saw the cookie at all.
  const defaultSessionCookies = await electronApp.evaluate(async ({ session }) => {
    const cookies = await session.defaultSession.cookies.get({ name: 'freedomtest' });
    return cookies.length;
  });
  expect(defaultSessionCookies).toBe(0);

  await closePrivateWindows(electronApp);
});
