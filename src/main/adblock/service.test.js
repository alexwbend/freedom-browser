const fs = require('fs');
const os = require('os');
const path = require('path');

// The dispatcher's a singleton — mock it so install assertions don't trip
// over residue from other suites (same pattern as request-rewriter.test.js).
jest.mock('../webrequest-dispatcher', () => {
  const handlers = [];
  return {
    registerWebRequestHandler: jest.fn((event, name, handler) => {
      handlers.push({ event, name, handler });
    }),
    _getHandlers: () => handlers,
  };
});

jest.mock('../settings-store', () => ({
  loadSettings: jest.fn(),
}));

const dispatcherMock = require('../webrequest-dispatcher');
const { loadSettings } = require('../settings-store');
const {
  installAdblockInterception,
  adblockRequestForDispatch,
  refreshEngine,
  cleanupAdblockWebContents,
  setAllowlistedHosts,
  _resetAdblockForTests,
} = require('./service');

const DEFAULT_TEST_SETTINGS = {
  adblockEnabled: true,
  adblockAds: true,
  adblockPrivacy: true,
  adblockCookies: false,
  adblockAnnoyances: false,
};

// Minimal ABP-syntax fixture lists, one per category.
const FIXTURE_LISTS = {
  'easylist.txt': ['||ads.tracker.test^$third-party', '@@||ads.tracker.test/acceptable^'].join(
    '\n'
  ),
  'easyprivacy.txt': '||telemetry.test^',
  'easylist-cookies.txt': '||cookiewall.test^',
};

const MANIFEST = {
  version: '2026-07-05',
  categories: {
    ads: { file: 'easylist.txt' },
    privacy: { file: 'easyprivacy.txt' },
    cookies: { file: 'easylist-cookies.txt' },
  },
};

let artifactsDir;

function writeFixtureArtifacts() {
  artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adblock-test-'));
  fs.writeFileSync(path.join(artifactsDir, 'manifest.json'), JSON.stringify(MANIFEST));
  for (const [name, text] of Object.entries(FIXTURE_LISTS)) {
    fs.writeFileSync(path.join(artifactsDir, name), text);
  }
}

// A subresource request as the dispatcher hands it to handlers.
function makeDetails(overrides = {}) {
  return {
    url: 'https://ads.tracker.test/banner.js',
    resourceType: 'script',
    webContentsId: 7,
    referrer: '',
    ...overrides,
  };
}

// Record the tab's top-level navigation so first-party context exists.
function navigateTab(webContentsId, url) {
  adblockRequestForDispatch({ url, resourceType: 'mainFrame', webContentsId, referrer: '' });
}

beforeAll(() => {
  writeFixtureArtifacts();
});

afterAll(() => {
  fs.rmSync(artifactsDir, { recursive: true, force: true });
});

beforeEach(async () => {
  loadSettings.mockReturnValue({ ...DEFAULT_TEST_SETTINGS });
  _resetAdblockForTests();
  installAdblockInterception({ artifactsDir });
  await refreshEngine();
  navigateTab(7, 'https://news.example/story');
});

describe('installAdblockInterception', () => {
  test('registers an onBeforeRequest handler named adblock', () => {
    const entries = dispatcherMock
      ._getHandlers()
      .filter((h) => h.event === 'onBeforeRequest' && h.name === 'adblock');
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('adblockRequestForDispatch', () => {
  test('blocks a third-party request matching an enabled list', () => {
    expect(adblockRequestForDispatch(makeDetails())).toEqual({ cancel: true });
  });

  test('blocks requests from the privacy category', () => {
    expect(
      adblockRequestForDispatch(
        makeDetails({ url: 'https://telemetry.test/beacon', resourceType: 'ping' })
      )
    ).toEqual({ cancel: true });
  });

  test('respects @@ exception rules', () => {
    expect(
      adblockRequestForDispatch(makeDetails({ url: 'https://ads.tracker.test/acceptable/x.js' }))
    ).toBe(null);
  });

  test('never cancels main-frame navigation, even to a listed host', () => {
    expect(
      adblockRequestForDispatch(
        makeDetails({ url: 'https://ads.tracker.test/', resourceType: 'mainFrame' })
      )
    ).toBe(null);
  });

  test('does not load lists for disabled categories', () => {
    expect(
      adblockRequestForDispatch(makeDetails({ url: 'https://cookiewall.test/banner.js' }))
    ).toBe(null);
  });

  test('rebuilds the engine when a category setting changes', async () => {
    loadSettings.mockReturnValue({ ...DEFAULT_TEST_SETTINGS, adblockCookies: true });
    await refreshEngine();
    expect(
      adblockRequestForDispatch(makeDetails({ url: 'https://cookiewall.test/banner.js' }))
    ).toEqual({ cancel: true });
  });

  test('passes everything through when adblockEnabled is false', () => {
    loadSettings.mockReturnValue({ ...DEFAULT_TEST_SETTINGS, adblockEnabled: false });
    expect(adblockRequestForDispatch(makeDetails())).toBe(null);
  });

  test('ignores non-http(s) and loopback URLs', () => {
    expect(adblockRequestForDispatch(makeDetails({ url: 'file:///tmp/x.js' }))).toBe(null);
    expect(
      adblockRequestForDispatch(makeDetails({ url: 'http://127.0.0.1:1633/bzz/abc/ad.js' }))
    ).toBe(null);
  });

  test('bypasses the engine for allowlisted top-level hosts, including subdomains', () => {
    setAllowlistedHosts(['news.example']);
    expect(adblockRequestForDispatch(makeDetails())).toBe(null);

    navigateTab(7, 'https://m.news.example/story');
    expect(adblockRequestForDispatch(makeDetails())).toBe(null);

    setAllowlistedHosts([]);
    expect(adblockRequestForDispatch(makeDetails())).toEqual({ cancel: true });
  });

  test('normalizes allowlist entries at store time', () => {
    setAllowlistedHosts(['WWW.News.Example.', '', null]);
    expect(adblockRequestForDispatch(makeDetails())).toBe(null);
  });

  test('scopes the allowlist to the requesting tab', () => {
    setAllowlistedHosts(['news.example']);
    navigateTab(8, 'https://other.example/');
    expect(adblockRequestForDispatch(makeDetails({ webContentsId: 8 }))).toEqual({
      cancel: true,
    });
  });

  test('falls back to referrer for first-party context when the tab is unknown', () => {
    // No mainFrame was recorded for webContents 99 (e.g. service worker).
    const details = makeDetails({
      webContentsId: 99,
      url: 'https://ads.tracker.test/banner.js',
      referrer: 'https://news.example/story',
    });
    expect(adblockRequestForDispatch(details)).toEqual({ cancel: true });
  });

  test('does not block first-party requests for third-party-only rules', () => {
    navigateTab(7, 'https://ads.tracker.test/home');
    expect(adblockRequestForDispatch(makeDetails())).toBe(null);
  });
});

describe('cleanupAdblockWebContents', () => {
  test('drops the tab context so later requests lose first-party state', () => {
    const beacon = { url: 'https://telemetry.test/beacon' };
    setAllowlistedHosts(['news.example']);
    expect(adblockRequestForDispatch(makeDetails(beacon))).toBe(null);
    cleanupAdblockWebContents(7);
    // Without top-level context the allowlist no longer applies. (Rules
    // scoped $third-party stop matching too — unknown source is treated
    // as first-party for safety — so probe with an unscoped rule.)
    expect(adblockRequestForDispatch(makeDetails(beacon))).toEqual({ cancel: true });
  });
});

describe('engine cache', () => {
  let cacheDir;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adblock-cache-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  test('writes a serialized engine and can rebuild from it without list files', async () => {
    _resetAdblockForTests();
    installAdblockInterception({ artifactsDir, cacheDir });
    await refreshEngine();
    expect(fs.readdirSync(cacheDir).filter((f) => f.startsWith('engine-'))).toHaveLength(1);

    // Same manifest (same cache key) but no list files on disk: blocking
    // still works, proving the engine came from the serialized cache.
    const manifestOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'adblock-manifest-'));
    fs.copyFileSync(
      path.join(artifactsDir, 'manifest.json'),
      path.join(manifestOnly, 'manifest.json')
    );
    _resetAdblockForTests();
    installAdblockInterception({ artifactsDir: manifestOnly, cacheDir });
    await refreshEngine();
    navigateTab(7, 'https://news.example/story');
    expect(adblockRequestForDispatch(makeDetails())).toEqual({ cancel: true });

    fs.rmSync(manifestOnly, { recursive: true, force: true });
  });

  test('a category change misses the cache, rebuilds, and prunes stale caches', async () => {
    _resetAdblockForTests();
    installAdblockInterception({ artifactsDir, cacheDir });
    await refreshEngine();

    loadSettings.mockReturnValue({ ...DEFAULT_TEST_SETTINGS, adblockCookies: true });
    await refreshEngine();
    navigateTab(7, 'https://news.example/story');
    expect(
      adblockRequestForDispatch(makeDetails({ url: 'https://cookiewall.test/banner.js' }))
    ).toEqual({ cancel: true });
    expect(fs.readdirSync(cacheDir).filter((f) => f.startsWith('engine-'))).toHaveLength(1);
  });
});

describe('refreshEngine', () => {
  test('leaves blocking disabled when the artifacts dir is missing', async () => {
    _resetAdblockForTests();
    installAdblockInterception({ artifactsDir: path.join(artifactsDir, 'nope') });
    await refreshEngine();
    navigateTab(7, 'https://news.example/story');
    expect(adblockRequestForDispatch(makeDetails())).toBe(null);
  });

  test('skips unreadable list files without disabling the rest', async () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'adblock-broken-'));
    fs.writeFileSync(
      path.join(broken, 'manifest.json'),
      JSON.stringify({
        version: 'x',
        categories: {
          ads: { file: 'missing.txt' },
          privacy: { file: 'easyprivacy.txt' },
        },
      })
    );
    fs.writeFileSync(path.join(broken, 'easyprivacy.txt'), FIXTURE_LISTS['easyprivacy.txt']);

    _resetAdblockForTests();
    installAdblockInterception({ artifactsDir: broken });
    await refreshEngine();
    navigateTab(7, 'https://news.example/story');

    expect(
      adblockRequestForDispatch(makeDetails({ url: 'https://telemetry.test/beacon' }))
    ).toEqual({ cancel: true });

    fs.rmSync(broken, { recursive: true, force: true });
  });
});
