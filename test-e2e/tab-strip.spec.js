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

test('new tabs open next to the active tab by default', async ({ window }) => {
  const tabs = window.locator('[data-test="tab"]');
  await expect(tabs).toHaveCount(1);

  // Tab 2 opens right of tab 1 and becomes active.
  await window.locator('[data-test="new-tab-btn"]').click();
  await expect(tabs).toHaveCount(2);

  // Switch back to tab 1; the next new tab must slot between 1 and 2.
  await tabs.first().click();
  await window.locator('[data-test="new-tab-btn"]').click();
  await expect(tabs).toHaveCount(3);

  const ids = await tabs.evaluateAll((els) => els.map((el) => el.dataset.tabId));
  expect(ids).toEqual(['1', '3', '2']);
});

test.describe('MRU Ctrl+Tab cycling (setting on)', () => {
  test.use({ seedSettings: { mruTabSwitching: true } });

  test('held Ctrl shows the switcher; releasing commits the MRU tab', async ({ window }) => {
    const tabs = window.locator('[data-test="tab"]');

    // Three tabs; activation order 1 -> 2 -> 3 -> 1 gives MRU [1, 3, 2].
    await window.locator('[data-test="new-tab-btn"]').click();
    await window.locator('[data-test="new-tab-btn"]').click();
    await expect(tabs).toHaveCount(3);
    await tabs.first().click();
    await expect(tabs.first()).toHaveClass(/active/);

    // Focus chrome so the renderer keydown handler sees the keys.
    await window.locator('[data-test="address-input"]').click();

    await window.keyboard.down('Control');
    await window.keyboard.press('Tab');
    const switcher = window.locator('[data-test="tab-mru-switcher"]');
    await expect(switcher).toBeVisible();
    // Selection previews the most recently used other tab (tab 3); the
    // active tab hasn't changed yet.
    await expect(window.locator('[data-test="tab-mru-item"].selected')).toHaveAttribute(
      'data-tab-id',
      '3'
    );
    await expect(tabs.first()).toHaveClass(/active/);

    await window.keyboard.up('Control');
    await expect(switcher).toBeHidden();
    await expect(window.locator('[data-test="tab"][data-tab-id="3"]')).toHaveClass(/active/);
  });
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

test('Mute Tab context-menu item toggles the muted indicator', async ({ window }) => {
  const tab = window.locator('[data-test="tab"]').first();
  const audioBtn = tab.locator('[data-test="tab-audio"]');

  // No audio state initially: indicator hidden.
  await expect(audioBtn).toBeHidden();

  await tab.click({ button: 'right' });
  const muteItem = window.locator('#tab-context-menu [data-action="mute"]');
  await expect(muteItem).toHaveText('Mute Tab');
  await muteItem.click();

  // Muted: indicator shows the muted speaker even without audio playing.
  await expect(tab).toHaveAttribute('data-audio-state', 'muted');
  await expect(audioBtn).toBeVisible();

  // Clicking the indicator unmutes (and hides it again — nothing audible).
  await audioBtn.click();
  await expect(audioBtn).toBeHidden();

  await tab.click({ button: 'right' });
  await expect(muteItem).toHaveText('Mute Tab');
  await window.keyboard.press('Escape');
});

test('Close Tabs to the Left protects pinned tabs', async ({ window }) => {
  const tabs = window.locator('[data-test="tab"]');
  await window.locator('[data-test="new-tab-btn"]').click();
  await window.locator('[data-test="new-tab-btn"]').click();
  await expect(tabs).toHaveCount(3);

  // Pin the leftmost tab.
  await tabs.first().click({ button: 'right' });
  await window.locator('#tab-context-menu [data-action="pin"]').click();
  await expect(tabs.first()).toHaveClass(/pinned/);

  // Close-left from the rightmost tab: only the middle tab goes.
  await tabs.nth(2).click({ button: 'right' });
  await window.locator('#tab-context-menu [data-action="close-left"]').click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.first()).toHaveClass(/pinned/);
});

test('Copy URL puts the tab address on the clipboard', async ({ window, electronApp }) => {
  const input = window.locator('[data-test="address-input"]');
  await input.click();
  await input.fill('https://example.com');
  await input.press('Enter');
  await expect(input).toHaveValue(/^https:\/\/example\.com\/?$/);

  const tab = window.locator('[data-test="tab"]').first();
  await tab.click({ button: 'right' });
  await window.locator('#tab-context-menu [data-action="copy-url"]').click();

  await expect
    .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toMatch(/^https:\/\/example\.com\/?$/);
});

test('Reopen Closed Tab context-menu item restores the last closed tab', async ({ window }) => {
  const tabs = window.locator('[data-test="tab"]');
  const input = window.locator('[data-test="address-input"]');

  // Second tab on an internal page with a distinct title, then close it.
  await window.locator('[data-test="new-tab-btn"]').click();
  await input.click();
  await input.fill('freedom://history');
  await input.press('Enter');
  await expect(tabs.nth(1)).toContainText('History');
  await tabs.nth(1).locator('[data-test="tab-close"]').click();
  await expect(tabs).toHaveCount(1);

  await tabs.first().click({ button: 'right' });
  await window.locator('#tab-context-menu [data-action="reopen-closed"]').click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toContainText('History');
});
