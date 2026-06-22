const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CURRENT_POINTER_FILE,
  PREVIOUS_POINTER_FILE,
  getChromePackageStoreRoot,
  installChromePackageFromDirectory,
  loadCurrentChromePackage,
  rollbackChromePackageStore,
} = require('./chrome-package-store');
const {
  SHELL_API_VERSION,
  hashFileSha256,
  validateLocalChromePackage,
} = require('./chrome-package');

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-chrome-package-store-'));
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

function installPackage(sourceDir, storeRoot, options = {}) {
  return installChromePackageFromDirectory(sourceDir, {
    storeRoot,
    validatePackage: validateLocalChromePackage,
    ...options,
  });
}

function loadCurrent(storeRoot) {
  return loadCurrentChromePackage({
    storeRoot,
    validatePackage: validateLocalChromePackage,
  });
}

describe('chrome-package-store', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolves the store root under user data', () => {
    const userDataDir = makeTempDir();

    expect(getChromePackageStoreRoot({ userDataDir })).toBe(
      path.join(userDataDir, 'chrome-package-store')
    );
  });

  test('installs a verified package and loads it offline from cache', () => {
    const sourceDir = makeTempDir();
    const userDataDir = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir });
    writePackage(sourceDir);

    const installResult = installPackage(sourceDir, storeRoot);

    expect(installResult.ok).toBe(true);
    expect(installResult.chromePackage).toMatchObject({
      source: 'store',
      packageId: 'baby.freedom.chrome.fixture',
      version: '1.0.0',
    });
    expect(fs.existsSync(path.join(storeRoot, CURRENT_POINTER_FILE))).toBe(true);
    expect(fs.existsSync(path.join(storeRoot, PREVIOUS_POINTER_FILE))).toBe(false);

    fs.rmSync(sourceDir, { recursive: true, force: true });
    const cachedResult = loadCurrent(storeRoot);

    expect(cachedResult.ok).toBe(true);
    expect(cachedResult.chromePackage).toMatchObject({
      source: 'store',
      packageId: 'baby.freedom.chrome.fixture',
      version: '1.0.0',
    });
    expect(cachedResult.chromePackage.packageRoot.startsWith(storeRoot)).toBe(true);
  });

  test('maintains current and previous package pointers and rolls back', () => {
    const v1Dir = makeTempDir();
    const v2Dir = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    writePackage(v1Dir, { version: '1.0.0' }, { 'index.html': '<!doctype html><h1>v1</h1>' });
    writePackage(v2Dir, { version: '1.1.0' }, { 'index.html': '<!doctype html><h1>v2</h1>' });

    expect(installPackage(v1Dir, storeRoot).ok).toBe(true);
    const updateResult = installPackage(v2Dir, storeRoot);

    expect(updateResult.ok).toBe(true);
    expect(updateResult.current.version).toBe('1.1.0');
    expect(updateResult.previous.version).toBe('1.0.0');
    expect(loadCurrent(storeRoot).chromePackage.version).toBe('1.1.0');

    const rollbackResult = rollbackChromePackageStore({
      storeRoot,
      validatePackage: validateLocalChromePackage,
    });

    expect(rollbackResult.ok).toBe(true);
    expect(rollbackResult.current.version).toBe('1.0.0');
    expect(loadCurrent(storeRoot).chromePackage.version).toBe('1.0.0');
  });

  test('rejects downgrades unless explicitly allowed', () => {
    const v1Dir = makeTempDir();
    const v2Dir = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    writePackage(v1Dir, { version: '1.0.0' }, { 'index.html': '<!doctype html><h1>v1</h1>' });
    writePackage(v2Dir, { version: '2.0.0' }, { 'index.html': '<!doctype html><h1>v2</h1>' });
    expect(installPackage(v2Dir, storeRoot).ok).toBe(true);

    const downgradeResult = installPackage(v1Dir, storeRoot);

    expect(downgradeResult.ok).toBe(false);
    expect(downgradeResult.error.code).toBe('PACKAGE_DOWNGRADE_REJECTED');
    expect(loadCurrent(storeRoot).chromePackage.version).toBe('2.0.0');
  });

  test('rejects same-version replay with changed content', () => {
    const firstDir = makeTempDir();
    const replayDir = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    writePackage(firstDir, { version: '1.0.0' }, { 'index.html': '<!doctype html><h1>first</h1>' });
    writePackage(replayDir, { version: '1.0.0' }, { 'index.html': '<!doctype html><h1>replay</h1>' });
    expect(installPackage(firstDir, storeRoot).ok).toBe(true);

    const replayResult = installPackage(replayDir, storeRoot);

    expect(replayResult.ok).toBe(false);
    expect(replayResult.error.code).toBe('PACKAGE_REPLAY_REJECTED');
    expect(loadCurrent(storeRoot).chromePackage.version).toBe('1.0.0');
  });

  test('detects cached package file corruption', () => {
    const sourceDir = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    writePackage(sourceDir);
    const installResult = installPackage(sourceDir, storeRoot);
    expect(installResult.ok).toBe(true);
    fs.writeFileSync(
      path.join(installResult.chromePackage.packageRoot, 'index.html'),
      '<!doctype html><h1>tampered</h1>'
    );

    const cachedResult = loadCurrent(storeRoot);

    expect(cachedResult.ok).toBe(false);
    expect(cachedResult.error.code).toBe('STORE_PACKAGE_INVALID');
    expect(cachedResult.error.cause.code).toBe('PACKAGE_FILE_HASH_MISMATCH');
  });

  test('detects cached manifest corruption using install metadata', () => {
    const sourceDir = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    writePackage(sourceDir);
    const installResult = installPackage(sourceDir, storeRoot);
    expect(installResult.ok).toBe(true);
    const manifestPath = path.join(installResult.chromePackage.packageRoot, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.name = 'Tampered Chrome';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const cachedResult = loadCurrent(storeRoot);

    expect(cachedResult.ok).toBe(false);
    expect(cachedResult.error.code).toBe('STORE_MANIFEST_HASH_MISMATCH');
  });

  test('does not activate invalid source packages', () => {
    const sourceDir = makeTempDir();
    const storeRoot = getChromePackageStoreRoot({ userDataDir: makeTempDir() });
    writePackage(sourceDir, { files: [] });

    const installResult = installPackage(sourceDir, storeRoot);

    expect(installResult.ok).toBe(false);
    expect(installResult.error.code).toBe('SOURCE_PACKAGE_INVALID');
    expect(fs.existsSync(path.join(storeRoot, CURRENT_POINTER_FILE))).toBe(false);
  });
});
