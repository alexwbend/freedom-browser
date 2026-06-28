const fs = require('fs');
const path = require('path');
const {
  OFFICIAL_CHROME_CAPABILITIES,
  buildOfficialChromePackage,
  defaultSourceDir,
} = require('./build-official-chrome-package');
const {
  DISALLOWED_RESIDUE_MARKERS,
  checkOfficialChromeBoundary,
} = require('./check-official-chrome-boundary');
const { validateLocalChromePackage } = require('../src/main/chrome-package');

const repoRoot = path.resolve(__dirname, '..');
const testOutputRoot = path.join(repoRoot, 'dist', 'official-chrome-package-tests');

function makeOutputDir(name) {
  fs.mkdirSync(testOutputRoot, { recursive: true });
  return fs.mkdtempSync(path.join(testOutputRoot, `${name}-`));
}

afterEach(() => {
  fs.rmSync(testOutputRoot, { recursive: true, force: true });
});

test('buildOfficialChromePackage materializes a valid deterministic package', () => {
  const outputDir = makeOutputDir('valid');
  const result = buildOfficialChromePackage({ outputDir, version: '9.9.9-test' });

  expect(result.outputDir).toBe(outputDir);
  expect(result.manifest).toMatchObject({
    manifestVersion: 1,
    packageType: 'browser-chrome',
    packageId: 'baby.freedom.chrome.official-local',
    name: 'Freedom Official Local Chrome',
    version: '9.9.9-test',
    entry: 'index.html',
    shellCompatibility: {
      minShellApi: '0.1.0',
      maxShellApi: '0.1.x',
    },
    guestContent: {
      webviews: true,
    },
  });
  expect(result.manifest.capabilities).toEqual([...OFFICIAL_CHROME_CAPABILITIES]);
  expect(result.manifest.files.length).toBeGreaterThan(0);
  expect(result.manifest.files).toEqual(
    [...result.manifest.files].sort((left, right) => left.path.localeCompare(right.path))
  );
  expect(result.manifest.files.some((file) => file.path === 'index.html')).toBe(true);
  expect(result.manifest.files.some((file) => file.path.endsWith('.test.js'))).toBe(false);

  const validation = validateLocalChromePackage(outputDir);
  expect(validation.ok).toBe(true);
  expect(validation.chromePackage.files).toEqual(result.manifest.files);
});

test('official chrome source and generated output pass boundary guardrails', () => {
  const outputDir = makeOutputDir('boundary');
  buildOfficialChromePackage({ outputDir, version: '9.9.9-test' });

  expect(checkOfficialChromeBoundary([defaultSourceDir, outputDir])).toEqual([]);
});

test('official chrome boundary guard catches broad preload globals', () => {
  const outputDir = makeOutputDir('bad-boundary');
  fs.writeFileSync(path.join(outputDir, 'index.js'), 'window.electronAPI.getSettings();\n');

  expect(checkOfficialChromeBoundary([outputDir])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        file: expect.stringContaining('index.js'),
        line: 1,
        rule: 'broad preload global',
      }),
      expect.objectContaining({
        file: expect.stringContaining('index.js'),
        line: 1,
        rule: 'broad preload adapter token',
      }),
    ])
  );
});

test('official chrome boundary guard catches indirect broad preload adapter tokens', () => {
  const outputDir = makeOutputDir('bad-broad-token');
  fs.writeFileSync(
    path.join(outputDir, 'index.js'),
    [
      'const runtimeWindow = window;',
      'runtimeWindow.electronAPI?.getSettings();',
      'globalThis.electronAPI?.getSettings();',
      'const { electronAPI } = runtimeWindow;',
      'electronAPI?.getSettings();',
    ].join('\n')
  );

  const violations = checkOfficialChromeBoundary([outputDir]);
  expect(violations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        file: expect.stringContaining('index.js'),
        line: 2,
        rule: 'broad preload adapter token',
      }),
      expect.objectContaining({
        file: expect.stringContaining('index.js'),
        line: 3,
        rule: 'broad preload adapter token',
      }),
      expect.objectContaining({
        file: expect.stringContaining('index.js'),
        line: 4,
        rule: 'broad preload adapter token',
      }),
      expect.objectContaining({
        file: expect.stringContaining('index.js'),
        line: 5,
        rule: 'broad preload adapter token',
      }),
    ])
  );
});

test('official chrome boundary guard catches trusted-only source files', () => {
  const outputDir = makeOutputDir('bad-trusted-source');
  fs.mkdirSync(path.join(outputDir, 'lib', 'wallet'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'styles'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'lib', 'onboarding.js'), 'export {};\n');
  fs.writeFileSync(path.join(outputDir, 'lib', 'wallet-ui.js'), 'export {};\n');
  fs.writeFileSync(path.join(outputDir, 'lib', 'wallet', 'index.js'), 'export {};\n');
  fs.writeFileSync(path.join(outputDir, 'styles', 'onboarding.css'), '.onboarding-modal {}\n');

  expect(checkOfficialChromeBoundary([outputDir])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: expect.stringContaining('lib/onboarding.js') }),
      expect.objectContaining({ file: expect.stringContaining('lib/wallet-ui.js') }),
      expect.objectContaining({ file: expect.stringContaining('lib/wallet/index.js') }),
      expect.objectContaining({ file: expect.stringContaining('styles/onboarding.css') }),
    ])
  );
});

test('official chrome boundary guard catches trusted sidebar residue markers', () => {
  const outputDir = makeOutputDir('bad-sidebar-residue');
  const stylesDir = path.join(outputDir, 'styles');
  fs.mkdirSync(stylesDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'index.html'),
    '<div id="sidebar-dapp-connect"></div><div id="wallet-settings-export-pk"></div>\n'
  );
  fs.writeFileSync(
    path.join(stylesDir, 'sidebar.css'),
    '.dapp-connect-origin {}\n.wallet-settings-export-btn {}\n'
  );

  const violations = checkOfficialChromeBoundary([outputDir]);
  expect(violations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        file: expect.stringContaining('index.html'),
        rule: 'trusted sidebar residue marker',
        text: 'id="sidebar-dapp-connect"',
      }),
      expect.objectContaining({
        file: expect.stringContaining('index.html'),
        rule: 'trusted sidebar residue marker',
        text: 'id="wallet-settings-export-pk"',
      }),
      expect.objectContaining({
        file: expect.stringContaining('styles/sidebar.css'),
        rule: 'trusted sidebar residue marker',
        text: '.dapp-connect-origin',
      }),
      expect.objectContaining({
        file: expect.stringContaining('styles/sidebar.css'),
        rule: 'trusted sidebar residue marker',
        text: '.wallet-settings-export-btn',
      }),
    ])
  );
  expect(DISALLOWED_RESIDUE_MARKERS).toContain('id="sidebar-x402-approval"');
});
