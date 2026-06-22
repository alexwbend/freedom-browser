const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  LOCAL_PACKAGE_FEED_VERSION,
  installChromePackageFromLocalFeed,
  readLocalPackageFeed,
} = require('./chrome-package-feed');
const {
  getChromePackageStoreRoot,
  installChromePackageFromDirectory,
  loadCurrentChromePackage,
} = require('./chrome-package-store');
const {
  SHELL_API_VERSION,
  hashFileSha256,
  validateLocalChromePackage,
} = require('./chrome-package');

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-chrome-package-feed-'));
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

function writePackage(root, manifestOverrides = {}, fileContents = {}) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'index.html'),
    fileContents['index.html'] || '<!doctype html><h1>fixture</h1>'
  );
  const manifest = {
    manifestVersion: 1,
    packageType: 'browser-chrome',
    packageId: 'baby.freedom.chrome.fixture',
    name: 'Fixture Chrome',
    version: '1.0.0',
    entry: 'index.html',
    shellCompatibility: {
      minShellApi: SHELL_API_VERSION,
      maxShellApi: '0.1.x',
    },
    capabilities: ['shell.info', 'shell.ready', 'navigation.resolve'],
    files: listPackageFiles(root),
    ...manifestOverrides,
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

function writeFeed(feedPath, packageDirs, overrides = {}) {
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
        feedVersion: LOCAL_PACKAGE_FEED_VERSION,
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

function installFromFeed(feedPath, storeRoot, options = {}) {
  return installChromePackageFromLocalFeed(feedPath, {
    storeRoot,
    validatePackage: validateLocalChromePackage,
    ...options,
  });
}

function installPackage(sourceDir, storeRoot) {
  return installChromePackageFromDirectory(sourceDir, {
    storeRoot,
    validatePackage: validateLocalChromePackage,
  });
}

function loadCurrent(storeRoot) {
  return loadCurrentChromePackage({
    storeRoot,
    validatePackage: validateLocalChromePackage,
  });
}

describe('chrome-package-feed', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reads a deterministic local package feed file', () => {
    const parent = makeTempDir();
    const packageDir = path.join(parent, 'v1');
    const feedPath = path.join(parent, 'feed.json');
    writePackage(packageDir, { version: '1.0.0' });
    writeFeed(feedPath, [packageDir]);

    const result = readLocalPackageFeed(feedPath);

    expect(result.ok).toBe(true);
    expect(result.feed).toMatchObject({
      feedVersion: LOCAL_PACKAGE_FEED_VERSION,
      packageId: 'baby.freedom.chrome.fixture',
      packages: [
        {
          version: '1.0.0',
          source: {
            type: 'directory',
            path: 'v1',
          },
        },
      ],
    });
  });

  test('installs the highest valid feed package into the store', () => {
    const parent = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    const v1Dir = path.join(parent, 'v1');
    const v2Dir = path.join(parent, 'v2');
    const feedPath = path.join(parent, 'feed.json');
    writePackage(v1Dir, { version: '1.0.0' }, { 'index.html': '<!doctype html><h1>v1</h1>' });
    writePackage(v2Dir, { version: '1.1.0' }, { 'index.html': '<!doctype html><h1>v2</h1>' });
    writeFeed(feedPath, [v1Dir, v2Dir]);

    const result = installFromFeed(feedPath, storeRoot);

    expect(result.ok).toBe(true);
    expect(result.chromePackage).toMatchObject({
      source: 'store',
      packageId: 'baby.freedom.chrome.fixture',
      version: '1.1.0',
    });
    expect(loadCurrent(storeRoot).chromePackage.version).toBe('1.1.0');
  });

  test('falls back to the cached current package when an advertised update is corrupt', () => {
    const parent = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    const v1Dir = path.join(parent, 'v1');
    const corruptV2Dir = path.join(parent, 'v2-corrupt');
    const feedPath = path.join(parent, 'feed.json');
    writePackage(v1Dir, { version: '1.0.0' }, { 'index.html': '<!doctype html><h1>v1</h1>' });
    writePackage(corruptV2Dir, { version: '1.1.0' }, { 'index.html': '<!doctype html><h1>v2</h1>' });
    fs.writeFileSync(path.join(corruptV2Dir, 'index.html'), '<!doctype html><h1>tampered</h1>');
    expect(installPackage(v1Dir, storeRoot).ok).toBe(true);
    writeFeed(feedPath, [corruptV2Dir]);

    const result = installFromFeed(feedPath, storeRoot);

    expect(result.ok).toBe(true);
    expect(result.chromePackage).toMatchObject({
      source: 'store',
      version: '1.0.0',
    });
    expect(result.feed.updateSkipped).toBe(true);
    expect(result.feed.failures[0]).toMatchObject({
      code: 'FEED_SOURCE_PACKAGE_INVALID',
      cause: {
        code: 'PACKAGE_FILE_HASH_MISMATCH',
      },
    });
  });

  test('returns a feed error when no feed package or cache can be used', () => {
    const parent = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    const corruptDir = path.join(parent, 'corrupt');
    const feedPath = path.join(parent, 'feed.json');
    writePackage(corruptDir, { version: '1.0.0' });
    fs.writeFileSync(path.join(corruptDir, 'index.html'), '<!doctype html><h1>tampered</h1>');
    writeFeed(feedPath, [corruptDir]);

    const result = installFromFeed(feedPath, storeRoot);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('FEED_NO_INSTALLABLE_PACKAGE');
    expect(result.error.failures[0]).toMatchObject({
      code: 'FEED_SOURCE_PACKAGE_INVALID',
      cause: {
        code: 'PACKAGE_FILE_HASH_MISMATCH',
      },
    });
    expect(result.error.cacheError.code).toBe('STORE_CURRENT_MISSING');
  });

  test('rejects missing and unsupported feed files', () => {
    const missingResult = readLocalPackageFeed(path.join(makeTempDir(), 'missing.json'));
    expect(missingResult.ok).toBe(false);
    expect(missingResult.error.code).toBe('FEED_FILE_MISSING');

    const parent = makeTempDir();
    const feedPath = path.join(parent, 'feed.json');
    fs.writeFileSync(
      feedPath,
      JSON.stringify({
        feedVersion: 999,
        packages: [],
      })
    );

    const unsupportedResult = readLocalPackageFeed(feedPath);
    expect(unsupportedResult.ok).toBe(false);
    expect(unsupportedResult.error.code).toBe('FEED_VERSION_UNSUPPORTED');
  });
});
