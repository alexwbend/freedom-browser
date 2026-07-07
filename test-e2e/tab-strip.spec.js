// Tab strip upgrades — tab search popover, mute via tab context menu, and
// the context-menu completeness items (close left, copy URL, reopen closed).

const { test, expect } = require('./fixtures');

const searchShortcut = process.platform === 'darwin' ? 'Meta+Shift+A' : 'Control+Shift+A';

// Focus the browser chrome (not a webview) so renderer-level keyboard
// shortcuts land, then open the tab search popover.
async function openTabSearch(window) {
  await window.locator('[data-test="address-input"]').click();
  await window.keyboard.press(searchShortcut);
  await expect(window.locator('[data-test="tab-search"]')).toBeVisible();
}

test('tab search opens, filters, and activates a tab', async ({ window }) => {
  const tabs = window.locator('[data-test="tab"]');
  const input = window.locator('[data-test="address-input"]');

  // Give the first tab a distinct title via an internal page.
  await input.click();
  await input.fill('freedom://history');
  await input.press('Enter');
  await expect(tabs.first()).toContainText('History');

  await window.locator('[data-test="new-tab-btn"]').click();
  await window.locator('[data-test="new-tab-btn"]').click();
  await expect(tabs).toHaveCount(3);

  await openTabSearch(window);
  const items = window.locator('[data-test="tab-search-item"]');
  await expect(items).toHaveCount(3);

  // Filter down to the History tab, activate with Enter.
  await window.locator('[data-test="tab-search-input"]').fill('history');
  await expect(items).toHaveCount(1);
  await window.keyboard.press('Enter');
  await expect(window.locator('[data-test="tab-search"]')).toBeHidden();
  await expect(tabs.first()).toHaveClass(/active/);
});

test('Escape closes tab search without switching tabs', async ({ window }) => {
  const tabs = window.locator('[data-test="tab"]');
  await window.locator('[data-test="new-tab-btn"]').click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveClass(/active/);

  await openTabSearch(window);
  await window.keyboard.press('Escape');
  await expect(window.locator('[data-test="tab-search"]')).toBeHidden();
  await expect(tabs.nth(1)).toHaveClass(/active/);
});
