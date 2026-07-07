// Session restore — open tabs survive an app relaunch.
//
// Unlike the other harness specs this manages its own Electron lifecycle
// instead of using the shared fixtures: the whole point is a second launch
// against the same FREEDOM_TEST_USER_DATA dir, and the fixture tears its
// temp dir down with the app.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const repoRoot = path.resolve(__dirname, '..');

async function launchApp(userDataDir) {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      FREEDOM_TEST_MODE: '1',
      FREEDOM_TEST_USER_DATA: userDataDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      LANG: 'en_US.UTF-8',
    },
    timeout: 20_000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('[data-test="address-input"]', { state: 'visible' });
  return { app, win };
}

// Summarize the persisted session for deterministic polling: the renderer
// debounces snapshots ~1s, so we wait for the exact end state (3 tabs,
// first pinned, third active) before quitting.
function sessionSummary(userDataDir) {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, 'session.json'), 'utf-8');
    const win = JSON.parse(raw).windows?.[0];
    if (!win) return '';
    return `${win.tabs.length}:${win.tabs[0]?.pinned}:${win.activeTabIndex}`;
  } catch {
    return '';
  }
}

test('restores tabs in order with pinned state, loading only the active tab', async () => {
  test.setTimeout(120_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-e2e-session-'));
  let app;
  try {
    let win;
    ({ app, win } = await launchApp(userDataDir));

    const tabs = win.locator('[data-test="tab"]');
    const input = win.locator('[data-test="address-input"]');

    // Tab 1: internal History page.
    await input.click();
    await input.fill('freedom://history');
    await input.press('Enter');
    await expect(tabs.first()).toContainText('History');

    // Tab 2: harness-stubbed https page.
    await win.locator('[data-test="new-tab-btn"]').click();
    await input.click();
    await input.fill('https://example.com');
    await input.press('Enter');
    // The committed navigation may normalize to a trailing slash.
    await expect(input).toHaveValue(/^https:\/\/example\.com\/?$/);

    // Tab 3: stays on the home page and remains the active tab.
    await win.locator('[data-test="new-tab-btn"]').click();
    await expect(tabs).toHaveCount(3);

    // Pin tab 1 via its context menu (already leftmost, so order is stable).
    await tabs.first().click({ button: 'right' });
    await win.locator('#tab-context-menu [data-action="pin"]').click();
    await expect(tabs.first()).toHaveClass(/pinned/);

    // Wait for the debounced snapshot to land in session.json.
    await expect.poll(() => sessionSummary(userDataDir), { timeout: 15_000 }).toBe('3:true:2');

    await app.close();

    // Relaunch against the same profile dir.
    ({ app, win } = await launchApp(userDataDir));
    const restoredTabs = win.locator('[data-test="tab"]');
    await expect(restoredTabs).toHaveCount(3);

    // Order and pinned state kept; persisted titles shown on placeholders.
    await expect(restoredTabs.nth(0)).toHaveClass(/pinned/);
    await expect(restoredTabs.nth(0)).toContainText('History');
    await expect(restoredTabs.nth(2)).toHaveClass(/active/);

    // Lazy restore: only the active tab materialized a webview.
    await expect(win.locator('#webview-container webview')).toHaveCount(1);

    // Activating a placeholder materializes it on demand.
    await restoredTabs.nth(0).click();
    await expect(restoredTabs.nth(0)).toHaveClass(/active/);
    await expect(win.locator('#webview-container webview')).toHaveCount(2);
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('startup setting "homepage" skips restore', async () => {
  test.setTimeout(120_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-e2e-session-'));
  let app;
  try {
    let win;
    ({ app, win } = await launchApp(userDataDir));
    const tabs = win.locator('[data-test="tab"]');

    await win.locator('[data-test="new-tab-btn"]').click();
    await expect(tabs).toHaveCount(2);
    const input = win.locator('[data-test="address-input"]');
    await input.click();
    await input.fill('freedom://history');
    await input.press('Enter');
    await expect(tabs.nth(1)).toContainText('History');

    await expect.poll(() => sessionSummary(userDataDir), { timeout: 15_000 }).toMatch(/^2:/);

    // Flip the startup behavior (same IPC the settings page uses).
    await win.evaluate(() => window.electronAPI.saveSettings({ onStartup: 'homepage' }));
    await app.close();

    ({ app, win } = await launchApp(userDataDir));
    await expect(win.locator('[data-test="tab"]')).toHaveCount(1);
    await expect(win.locator('[data-test="tab"]').first()).toContainText('New Tab');
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
