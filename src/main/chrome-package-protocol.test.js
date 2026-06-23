const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  CHROME_PACKAGE_ACTIVE_ORIGIN,
  PACKAGE_CSP,
  contentTypeForPath,
  createChromePackageProtocolHandler,
  getChromePackageEntryUrl,
  getRequestedPackagePath,
  getVerifiedPackageFile,
} = require('./chrome-package-protocol');

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-chrome-package-protocol-'));
  tempDirs.push(dir);
  return dir;
}

function hashFileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return {
    path: relativePath,
    sha256: hashFileSha256(filePath),
  };
}

function createStorePackage(root) {
  const files = [
    writeFile(root, 'index.html', '<!doctype html><h1>package</h1>'),
    writeFile(root, 'styles/app.css', 'body { color: red; }'),
  ];
  writeFile(root, 'secret.txt', 'not declared');
  return {
    kind: 'local-package',
    source: 'store',
    packageRoot: fs.realpathSync(root),
    entry: 'index.html',
    files,
  };
}

describe('chrome-package-protocol', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('builds the active package entry URL for store-backed packages only', () => {
    expect(
      getChromePackageEntryUrl({
        kind: 'local-package',
        source: 'store',
        entry: 'pages/home page.html',
      })
    ).toBe(`${CHROME_PACKAGE_ACTIVE_ORIGIN}/pages/home%20page.html`);

    expect(
      getChromePackageEntryUrl({
        kind: 'local-package',
        source: 'local',
        entry: 'index.html',
      })
    ).toBeNull();
  });

  test('maps root and declared asset URLs to package-relative paths', () => {
    const chromePackage = {
      kind: 'local-package',
      source: 'store',
      entry: 'index.html',
    };

    expect(getRequestedPackagePath(`${CHROME_PACKAGE_ACTIVE_ORIGIN}/`, chromePackage)).toEqual({
      ok: true,
      path: 'index.html',
    });
    expect(
      getRequestedPackagePath(`${CHROME_PACKAGE_ACTIVE_ORIGIN}/styles/app.css`, chromePackage)
    ).toEqual({
      ok: true,
      path: 'styles/app.css',
    });
  });

  test('rejects dot-segment and encoded-separator package URLs', () => {
    const chromePackage = {
      kind: 'local-package',
      source: 'store',
      entry: 'index.html',
    };

    expect(
      getRequestedPackagePath(`${CHROME_PACKAGE_ACTIVE_ORIGIN}/../secret.txt`, chromePackage)
    ).toMatchObject({
      ok: false,
      code: 'PACKAGE_URL_PATH_TRAVERSAL',
    });
    expect(
      getRequestedPackagePath(`${CHROME_PACKAGE_ACTIVE_ORIGIN}/pages/%2e%2e/secret.txt`, chromePackage)
    ).toMatchObject({
      ok: false,
      code: 'PACKAGE_URL_PATH_TRAVERSAL',
    });
    expect(
      getRequestedPackagePath(`${CHROME_PACKAGE_ACTIVE_ORIGIN}/pages%2fsecret.txt`, chromePackage)
    ).toMatchObject({
      ok: false,
      code: 'PACKAGE_URL_PATH_INVALID',
    });
  });

  test('serves only declared active package files with CSP and content type headers', async () => {
    const root = makeTempDir();
    const chromePackage = createStorePackage(root);
    const handler = createChromePackageProtocolHandler({
      getActivePackage: () => chromePackage,
    });

    const result = await handler({ url: `${CHROME_PACKAGE_ACTIVE_ORIGIN}/styles/app.css` });

    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('text/css; charset=utf-8');
    expect(result.headers.get('Content-Security-Policy')).toBe(PACKAGE_CSP);
    expect(await result.text()).toBe('body { color: red; }');
  });

  test('rejects unlisted package files without reading arbitrary store paths', async () => {
    const root = makeTempDir();
    const chromePackage = createStorePackage(root);
    const handler = createChromePackageProtocolHandler({
      getActivePackage: () => chromePackage,
    });

    const result = await handler({ url: `${CHROME_PACKAGE_ACTIVE_ORIGIN}/secret.txt` });

    expect(result.status).toBe(404);
    expect(await result.json()).toMatchObject({
      code: 'PACKAGE_FILE_NOT_DECLARED',
    });
  });

  test('rejects declared files that no longer match the active manifest hash', async () => {
    const root = makeTempDir();
    const chromePackage = createStorePackage(root);
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><h1>tampered</h1>');

    expect(getVerifiedPackageFile(chromePackage, 'index.html')).toMatchObject({
      ok: false,
      code: 'PACKAGE_FILE_HASH_MISMATCH',
    });

    const handler = createChromePackageProtocolHandler({
      getActivePackage: () => chromePackage,
    });
    const result = await handler({ url: `${CHROME_PACKAGE_ACTIVE_ORIGIN}/index.html` });

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      code: 'PACKAGE_FILE_HASH_MISMATCH',
    });
  });

  test('uses conservative MIME defaults for unknown extensions', () => {
    expect(contentTypeForPath('/package/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeForPath('/package/file.unknown')).toBe('application/octet-stream');
  });
});
