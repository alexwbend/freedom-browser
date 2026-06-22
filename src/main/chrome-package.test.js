const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BUNDLED_CHROME_PACKAGE,
  SHELL_API_VERSION,
  getRequestedChromePackageDir,
  selectChromePackage,
  validateLocalChromePackage,
} = require('./chrome-package');

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-chrome-package-'));
  tempDirs.push(dir);
  return dir;
}

function writePackage(root, manifestOverrides = {}) {
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
    ...manifestOverrides,
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
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
    });
    expect(result.chromePackage.entryPath).toBe(path.join(fs.realpathSync(root), 'index.html'));
    expect(result.chromePackage.preloadPath.endsWith(path.join('src', 'main', 'package-preload.js'))).toBe(
      true
    );
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

  test('rejects missing package entry files', () => {
    const root = makeTempDir();
    writePackage(root, { entry: 'missing.html' });

    const result = validateLocalChromePackage(root);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ENTRY_MISSING');
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
