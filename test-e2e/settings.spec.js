// Settings — verify that the saveSettings IPC + the renderer's
// settings:updated subscription combine to flip theme classes on the
// document. The on-disk settings page lives at freedom://settings and
// is rendered inside a webview; we drive the same IPC it would call,
// which exercises the same end-to-end pipeline without coupling the
// spec to the page's internal markup.

const { test, expect } = require('./fixtures');

test('switching theme to "light" sets data-theme on <html>', async ({ window }) => {
  // Default theme is "system"; on macOS dark-mode CI this would be dark
  // (no data-theme attribute). Drive an explicit transition to "light".
  await window.evaluate(() => window.electronAPI.saveSettings({ theme: 'light' }));

  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');

  await window.evaluate(() => window.electronAPI.saveSettings({ theme: 'dark' }));

  // Dark mode removes the data-theme attribute (root selector applies
  // by default). We assert that toHaveAttribute fails — the attribute
  // is absent.
  await expect(window.locator('html')).not.toHaveAttribute('data-theme', 'light');
});

test('saveSettings persists across renderer reload', async ({ window }) => {
  await window.evaluate(() => window.electronAPI.saveSettings({ theme: 'light' }));
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');

  await window.reload();
  await window.waitForSelector('[data-test="address-input"]');

  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('Radicle controls stay visible and persist on every supported desktop', async ({
  window,
  electronApp,
}) => {
  const input = window.locator('[data-test="address-input"]');
  await input.click();
  await input.fill('freedom://settings/experimental');
  await input.press('Enter');

  let settingsPage;
  await expect
    .poll(() => {
      settingsPage = electronApp
        .windows()
        .find((page) => page.url().includes('/pages/settings.html'));
      return Boolean(settingsPage);
    })
    .toBe(true);

  const radicleRows = settingsPage.locator('[data-radicle]');
  await expect(radicleRows).toHaveCount(2);
  await expect(radicleRows.first()).toBeVisible();

  const enabled = settingsPage.locator('#enable-radicle-integration');
  const startAtLaunch = settingsPage.locator('#start-radicle-at-launch');
  // Toggle inputs are visually hidden by the custom slider CSS. Dispatch the
  // same change events their visible labels produce.
  const setRadicleSettings = (value) =>
    settingsPage.evaluate((checked) => {
      for (const id of ['enable-radicle-integration', 'start-radicle-at-launch']) {
        const field = document.getElementById(id);
        field.checked = checked;
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, value);
  await setRadicleSettings(true);
  await expect(enabled).toBeChecked();
  await expect(startAtLaunch).toBeChecked();

  await expect
    .poll(() =>
      window.evaluate(async () => {
        const settings = await window.electronAPI.getSettings();
        return [settings.enableRadicleIntegration, settings.startRadicleAtLaunch];
      })
    )
    .toEqual([true, true]);

  await settingsPage.evaluate(() => {
    location.hash = '#nodes';
  });
  const radicleNodeRow = settingsPage.locator('.profile-node[data-protocol="radicle"]');
  await expect(radicleNodeRow).toHaveCount(1);
  await expect(radicleNodeRow).toBeVisible();
  const platform = await settingsPage.evaluate(() => window.freedomAPI.getPlatform());
  if (platform === 'win32') {
    await expect(settingsPage.locator('.profile-node[data-protocol="tor"]')).toHaveCount(0);
  }

  // Leave the shared fixture in its default state for later specs.
  await setRadicleSettings(false);
  await expect
    .poll(() =>
      window.evaluate(async () => {
        const settings = await window.electronAPI.getSettings();
        return [settings.enableRadicleIntegration, settings.startRadicleAtLaunch];
      })
    )
    .toEqual([false, false]);
});
