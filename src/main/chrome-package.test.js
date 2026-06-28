const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BUNDLED_CHROME_PACKAGE,
  SHELL_API_VERSION,
  getRequestedChromePackageFeedPath,
  getRequestedChromePackageInstallDir,
  getRequestedChromePackageDir,
  hashFileSha256,
  selectChromePackage,
  shouldUseChromePackageStore,
  validateLocalChromePackage,
} = require('./chrome-package');
const { getChromePackageStoreRoot } = require('./chrome-package-store');

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-chrome-package-'));
  tempDirs.push(dir);
  return dir;
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

function writePackage(root, manifestOverrides = {}, options = {}) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><h1>fixture</h1>');
  const manifest = {
    manifestVersion: 1,
    packageType: 'browser-chrome',
    packageId: 'baby.freedom.chrome.fixture',
    name: 'Fixture Chrome',
    version: '0.0.1',
    entry: 'index.html',
    shellCompatibility: {
      minShellApi: SHELL_API_VERSION,
      maxShellApi: '0.1.x',
    },
    capabilities: ['shell.info', 'navigation.resolve'],
    ...(options.includeFiles === false ? {} : { files: listPackageFiles(root) }),
    ...manifestOverrides,
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

function writeFeed(feedPath, packageDirs) {
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
        packages,
      },
      null,
      2
    )
  );
}

describe('chrome-package', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
  });

  test('uses bundled chrome when no local package is requested', () => {
    expect(selectChromePackage({ env: {}, argv: [] })).toBe(BUNDLED_CHROME_PACKAGE);
  });

  test('reads local package path from CLI before environment', () => {
    expect(
      getRequestedChromePackageDir({
        env: { FREEDOM_CHROME_PACKAGE_DIR: '/from/env' },
        argv: ['electron', '.', '--chrome-package', '/from/argv'],
      })
    ).toBe('/from/argv');
    expect(
      getRequestedChromePackageDir({
        env: { FREEDOM_CHROME_PACKAGE_DIR: '/from/env' },
        argv: ['electron', '.', '--chrome-package=/from/equals'],
      })
    ).toBe('/from/equals');
  });

  test('reads package install and cache selectors', () => {
    expect(
      getRequestedChromePackageInstallDir({
        env: { FREEDOM_CHROME_PACKAGE_INSTALL_DIR: '/from/env' },
        argv: ['electron', '.', '--chrome-package-install', '/from/argv'],
      })
    ).toBe('/from/argv');
    expect(
      getRequestedChromePackageInstallDir({
        env: { FREEDOM_CHROME_PACKAGE_INSTALL_DIR: '/from/env' },
        argv: ['electron', '.', '--chrome-package-install=/from/equals'],
      })
    ).toBe('/from/equals');
    expect(shouldUseChromePackageStore({ env: { FREEDOM_CHROME_PACKAGE_CACHE: '1' }, argv: [] })).toBe(
      true
    );
    expect(shouldUseChromePackageStore({ env: {}, argv: ['electron', '.', '--chrome-package-cache'] })).toBe(
      true
    );
  });

  test('reads package feed selectors', () => {
    expect(
      getRequestedChromePackageFeedPath({
        env: { FREEDOM_CHROME_PACKAGE_FEED_FILE: '/from/env/feed.json' },
        argv: ['electron', '.', '--chrome-package-feed', '/from/argv/feed.json'],
      })
    ).toBe('/from/argv/feed.json');
    expect(
      getRequestedChromePackageFeedPath({
        env: { FREEDOM_CHROME_PACKAGE_FEED_FILE: '/from/env/feed.json' },
        argv: ['electron', '.', '--chrome-package-feed=/from/equals/feed.json'],
      })
    ).toBe('/from/equals/feed.json');
  });

  test('validates a local package descriptor', () => {
    const root = makeTempDir();
    writePackage(root);

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(true);
    expect(result.chromePackage).toMatchObject({
      kind: 'local-package',
      runtimeMode: 'local-package',
      source: 'local',
      packageRoot: fs.realpathSync(root),
      packageId: 'baby.freedom.chrome.fixture',
      name: 'Fixture Chrome',
      version: '0.0.1',
      capabilities: ['shell.info', 'navigation.resolve'],
      webviewTag: false,
      guestContent: {
        webviews: false,
      },
      webviews: false,
      transitionalWebviews: false,
    });
    expect(result.chromePackage.files).toEqual([
      {
        path: 'index.html',
        sha256: hashFileSha256(path.join(root, 'index.html')),
      },
    ]);
    expect(result.chromePackage.entryPath).toBe(path.join(fs.realpathSync(root), 'index.html'));
    expect(result.chromePackage.preloadPath.endsWith(path.join('src', 'main', 'package-preload.js'))).toBe(
      true
    );
  });

  test('allows explicit guest webview support in local package manifests', () => {
    const root = makeTempDir();
    writePackage(root, {
      guestContent: {
        webviews: true,
      },
    });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(true);
    expect(result.chromePackage).toMatchObject({
      webviewTag: true,
      guestContent: {
        webviews: true,
      },
      webviews: true,
      transitionalWebviews: false,
    });
  });

  test('keeps legacy transitional webview manifests compatible', () => {
    const root = makeTempDir();
    writePackage(root, {
      guestContent: {
        transitionalWebviews: true,
      },
    });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(true);
    expect(result.chromePackage).toMatchObject({
      webviewTag: true,
      guestContent: {
        webviews: true,
      },
      webviews: true,
      transitionalWebviews: true,
    });
  });

  test('rejects malformed guest content policy', () => {
    const invalidRoot = makeTempDir();
    writePackage(invalidRoot, { guestContent: [] });

    const invalidResult = validateLocalChromePackage(invalidRoot);

    expect(invalidResult.ok).toBe(false);
    expect(invalidResult.error.code).toBe('GUEST_CONTENT_INVALID');

    const invalidFlagRoot = makeTempDir();
    writePackage(invalidFlagRoot, { guestContent: { webviews: 'yes' } });

    const invalidFlagResult = validateLocalChromePackage(invalidFlagRoot);

    expect(invalidFlagResult.ok).toBe(false);
    expect(invalidFlagResult.error.code).toBe('GUEST_CONTENT_WEBVIEWS_INVALID');

    const invalidLegacyFlagRoot = makeTempDir();
    writePackage(invalidLegacyFlagRoot, { guestContent: { transitionalWebviews: 'yes' } });

    const invalidLegacyFlagResult = validateLocalChromePackage(invalidLegacyFlagRoot);

    expect(invalidLegacyFlagResult.ok).toBe(false);
    expect(invalidLegacyFlagResult.error.code).toBe('GUEST_CONTENT_WEBVIEWS_INVALID');
  });

  test('normalizes and deduplicates known shell capabilities', () => {
    const root = makeTempDir();
    writePackage(root, {
      capabilities: ['shell.info', 'navigation.resolve', 'shell.info'],
    });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(true);
    expect(result.chromePackage.capabilities).toEqual(['shell.info', 'navigation.resolve']);
  });

  test('falls back to bundled chrome with a diagnostic for a missing package', () => {
    const logger = { warn: jest.fn() };
    const selected = selectChromePackage({
      env: { FREEDOM_CHROME_PACKAGE_DIR: path.join(makeTempDir(), 'missing') },
      argv: [],
      logger,
    });

    expect(selected.kind).toBe('bundled');
    expect(selected.fallback.error.code).toBe('PACKAGE_DIR_NOT_FOUND');
    expect(logger.warn).toHaveBeenCalledWith(
      '[chrome-package] falling back to bundled chrome',
      expect.objectContaining({ code: 'PACKAGE_DIR_NOT_FOUND' })
    );
  });

  test('installs and selects a cached package when install mode is requested', () => {
    const root = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    writePackage(root);

    const selected = selectChromePackage({
      env: { FREEDOM_CHROME_PACKAGE_INSTALL_DIR: root },
      argv: [],
      storeRoot,
    });

    expect(selected).toMatchObject({
      kind: 'local-package',
      source: 'store',
      packageId: 'baby.freedom.chrome.fixture',
      version: '0.0.1',
    });
  });

  test('selects cached package only when cache mode is requested', () => {
    const root = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    writePackage(root);
    expect(
      selectChromePackage({
        env: { FREEDOM_CHROME_PACKAGE_INSTALL_DIR: root },
        argv: [],
        storeRoot,
      }).source
    ).toBe('store');

    expect(selectChromePackage({ env: {}, argv: [], storeRoot })).toBe(BUNDLED_CHROME_PACKAGE);
    expect(
      selectChromePackage({
        env: { FREEDOM_CHROME_PACKAGE_CACHE: '1' },
        argv: [],
        storeRoot,
      })
    ).toMatchObject({
      source: 'store',
      packageId: 'baby.freedom.chrome.fixture',
    });
  });

  test('installs and selects a cached package when feed mode is requested', () => {
    const parent = makeTempDir();
    const packageDir = path.join(parent, 'v1');
    const feedPath = path.join(parent, 'feed.json');
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    writePackage(packageDir, { version: '1.0.0' });
    writeFeed(feedPath, [packageDir]);

    const selected = selectChromePackage({
      env: { FREEDOM_CHROME_PACKAGE_FEED_FILE: feedPath },
      argv: [],
      storeRoot,
    });

    expect(selected).toMatchObject({
      kind: 'local-package',
      source: 'store',
      packageId: 'baby.freedom.chrome.fixture',
      version: '1.0.0',
    });
  });

  test('uses cached package when requested feed is unavailable', () => {
    const logger = { warn: jest.fn() };
    const root = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    writePackage(root);
    expect(
      selectChromePackage({
        env: { FREEDOM_CHROME_PACKAGE_INSTALL_DIR: root },
        argv: [],
        storeRoot,
      }).source
    ).toBe('store');

    const selected = selectChromePackage({
      env: { FREEDOM_CHROME_PACKAGE_FEED_FILE: path.join(makeTempDir(), 'missing.json') },
      argv: [],
      logger,
      storeRoot,
    });

    expect(selected).toMatchObject({
      source: 'store',
      packageId: 'baby.freedom.chrome.fixture',
      version: '0.0.1',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[chrome-package] using cached chrome after feed failure',
      expect.objectContaining({ code: 'FEED_FILE_MISSING' })
    );
  });

  test('falls back to bundled chrome when requested cache is unusable', () => {
    const logger = { warn: jest.fn() };
    const selected = selectChromePackage({
      env: { FREEDOM_CHROME_PACKAGE_CACHE: '1' },
      argv: [],
      logger,
      storeRoot: getChromePackageStoreRoot({ userDataDir: makeTempDir() }),
    });

    expect(selected.kind).toBe('bundled');
    expect(selected.fallback.error.code).toBe('STORE_CURRENT_MISSING');
    expect(logger.warn).toHaveBeenCalledWith(
      '[chrome-package] falling back to bundled chrome',
      expect.objectContaining({ code: 'STORE_CURRENT_MISSING' })
    );
  });

  test('rejects malformed manifests', () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'manifest.json'), '{');

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MANIFEST_INVALID_JSON');
  });

  test('rejects incompatible shell API ranges', () => {
    const root = makeTempDir();
    writePackage(root, {
      shellCompatibility: {
        minShellApi: '9.0.0',
        maxShellApi: '9.0.x',
      },
    });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('SHELL_COMPATIBILITY_UNSUPPORTED');
  });

  test('rejects invalid or unknown shell capabilities', () => {
    const invalidRoot = makeTempDir();
    writePackage(invalidRoot, { capabilities: ['shell.info', ''] });

    const invalidResult = validateLocalChromePackage(invalidRoot);

    expect(invalidResult.ok).toBe(false);
    expect(invalidResult.error.code).toBe('CAPABILITY_INVALID');

    const unknownRoot = makeTempDir();
    writePackage(unknownRoot, { capabilities: ['shell.info', 'wallet.export'] });

    const unknownResult = validateLocalChromePackage(unknownRoot);

    expect(unknownResult.ok).toBe(false);
    expect(unknownResult.error.code).toBe('CAPABILITY_UNKNOWN');
    expect(unknownResult.error.capability).toBe('wallet.export');
  });

  test('rejects missing package entry files', () => {
    const root = makeTempDir();
    writePackage(root, { entry: 'missing.html' });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ENTRY_MISSING');
  });

  test('requires manifest file integrity records', () => {
    const root = makeTempDir();
    writePackage(root, {}, { includeFiles: false });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('PACKAGE_FILES_MISSING');
  });

  test('rejects tampered package files', () => {
    const root = makeTempDir();
    writePackage(root);
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><h1>tampered</h1>');

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('PACKAGE_FILE_HASH_MISMATCH');
    expect(result.error.path).toBe('index.html');
  });

  test('rejects missing files listed in package integrity records', () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><h1>fixture</h1>');
    const missingHash = 'a'.repeat(64);
    writePackage(root, {
      files: [
        {
          path: 'index.html',
          sha256: hashFileSha256(path.join(root, 'index.html')),
        },
        {
          path: 'missing.js',
          sha256: missingHash,
        },
      ],
    });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('PACKAGE_FILE_MISSING');
    expect(result.error.path).toBe('missing.js');
  });

  test('requires the package entry to be covered by integrity records', () => {
    const root = makeTempDir();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><h1>fixture</h1>');
    fs.writeFileSync(path.join(root, 'other.html'), '<!doctype html><h1>other</h1>');
    writePackage(root, {
      files: [
        {
          path: 'other.html',
          sha256: hashFileSha256(path.join(root, 'other.html')),
        },
      ],
    });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ENTRY_INTEGRITY_MISSING');
  });

  test('rejects package integrity paths that escape the package directory', () => {
    const root = makeTempDir();
    writePackage(root, {
      files: [
        {
          path: '../outside.html',
          sha256: 'a'.repeat(64),
        },
      ],
    });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('PACKAGE_FILE_PATH_INVALID');
  });

  test('rejects package entries that escape the package directory', () => {
    const parent = makeTempDir();
    const root = path.join(parent, 'package');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(parent, 'outside.html'), '<!doctype html>');
    writePackage(root, { entry: '../outside.html' });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ENTRY_OUTSIDE_PACKAGE');
  });
});
