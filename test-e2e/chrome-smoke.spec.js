// Bundled chrome startup smoke.
//
// This spec intentionally exercises the launched Electron renderer rather
// than isolated modules. It is the gate for "the browser UI mounted but then
// stopped working" failures: renderer import aborts, dead menus, missing home
// page assets, and basic tab/navigation regressions.

const { test, expect } = require('./fixtures');

function installRendererErrorCapture(page) {
  const errors = [];
  const record = (label, value) => {
    const text = String(value || '');
    // The smoke poll asks the active webview for guest-page state. The first
    // poll can race Electron's dom-ready event; that transient is test-induced,
    // not a bundled chrome startup error.
    if (/The WebView must be attached to the DOM and the dom-ready event emitted/i.test(text)) {
      return;
    }
    errors.push(`${label}: ${text}`);
  };

  page.on('pageerror', (error) => {
    record('pageerror', error?.message || error);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Electron Security Warning/i.test(text)) return;
    record('console error', text);
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

async function expectHomeReady(page) {
  await expect
    .poll(() => getActiveWebviewHomeStatus(page), {
      message: 'Waiting for bundled home page and background asset',
      timeout: 10_000,
    })
    .toBe('ready');
}

test('bundled chrome starts and core UI remains interactive', async ({ electronApp }) => {
  const page = await electronApp.firstWindow();
  const rendererErrors = installRendererErrorCapture(page);

  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-test="address-input"]', { state: 'visible' });

  await expect(page.locator('[data-test="address-input"]')).toBeVisible();
  await expect(page.locator('[data-test="new-tab-btn"]')).toBeVisible();
  await expect(page.locator('[data-test="tab"]')).toHaveCount(1);
  await expectHomeReady(page);

  await page.locator('#menu-button').click();
  await expect(page.locator('#menu-dropdown')).toHaveClass(/open/);
  await page.locator('#menu-button').click();
  await expect(page.locator('#menu-dropdown')).not.toHaveClass(/open/);

  await page.locator('#bee-menu-button').click();
  await expect(page.locator('#bee-menu-dropdown')).toHaveClass(/open/);
  await page.locator('#bee-menu-button').click();
  await expect(page.locator('#bee-menu-dropdown')).not.toHaveClass(/open/);

  const profileIndicator = page.locator('#profile-indicator');
  if (await profileIndicator.isVisible()) {
    await profileIndicator.click();
    await expect(page.locator('#profile-menu')).toBeVisible();
    await profileIndicator.click();
    await expect(page.locator('#profile-menu')).toBeHidden();
  }

  await page.locator('[data-test="new-tab-btn"]').click();
  await expect(page.locator('[data-test="tab"]')).toHaveCount(2);
  await expect(page.locator('[data-test="tab"][data-tab-id="2"]')).toHaveClass(/active/);
  await page.locator('[data-test="tab"][data-tab-id="1"]').click();
  await expect(page.locator('[data-test="tab"][data-tab-id="1"]')).toHaveClass(/active/);
  await page.locator('[data-test="tab"][data-tab-id="2"] [data-test="tab-close"]').click();
  await expect(page.locator('[data-test="tab"]')).toHaveCount(1);

  await page.locator('#reload-btn').click();
  await expectHomeReady(page);

  const input = page.locator('[data-test="address-input"]');
  await input.click();
  await input.fill('freedom://settings');
  await input.press('Enter');
  await expect(input).toHaveValue('freedom://settings');
  await expect
    .poll(() => getActiveWebviewUrl(page), {
      message: 'Waiting for freedom://settings to load in active webview',
      timeout: 10_000,
    })
    .toContain('/pages/settings.html');

  await page.locator('#home-btn').click();
  await expectHomeReady(page);

  rendererErrors.assertClean();
});
