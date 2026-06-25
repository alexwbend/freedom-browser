const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MODES,
  createLaunchEnvironment,
  getPackageEnvKey,
  parseArgs,
  runOfficialChromePackage,
} = require('./run-official-chrome-package');

const repoRoot = path.resolve(__dirname, '..');
const testOutputRoot = path.join(repoRoot, 'dist', 'run-official-chrome-package-tests');

function makeOutputDir(name) {
  fs.mkdirSync(testOutputRoot, { recursive: true });
  return fs.mkdtempSync(path.join(testOutputRoot, `${name}-`));
}

afterEach(() => {
  fs.rmSync(testOutputRoot, { recursive: true, force: true });
});

test('parseArgs defaults to run mode and supports install mode', () => {
  expect(parseArgs([])).toMatchObject({
    mode: MODES.RUN,
  });
  expect(parseArgs(['--install'])).toMatchObject({
    mode: MODES.INSTALL,
  });
});

test('getPackageEnvKey selects the runtime package variable', () => {
  expect(getPackageEnvKey(MODES.RUN)).toBe('FREEDOM_CHROME_PACKAGE_DIR');
  expect(getPackageEnvKey(MODES.INSTALL)).toBe('FREEDOM_CHROME_PACKAGE_INSTALL_DIR');
});

test('createLaunchEnvironment passes absolute package dirs and clears the opposite mode', () => {
  const env = createLaunchEnvironment({
    mode: MODES.RUN,
    packageDir: 'dist/chrome-packages/official-browser-chrome',
    env: {
      FREEDOM_CHROME_PACKAGE_DIR: 'old-run',
      FREEDOM_CHROME_PACKAGE_INSTALL_DIR: 'old-install',
      KEEP_ME: 'yes',
    },
  });

  expect(env.KEEP_ME).toBe('yes');
  expect(env.FREEDOM_CHROME_PACKAGE_DIR).toBe(
    path.resolve('dist/chrome-packages/official-browser-chrome')
  );
  expect(env.FREEDOM_CHROME_PACKAGE_INSTALL_DIR).toBeUndefined();
  expect(path.isAbsolute(env.FREEDOM_CHROME_PACKAGE_DIR)).toBe(true);
});

test('createLaunchEnvironment passes absolute install dirs and clears the opposite mode', () => {
  const env = createLaunchEnvironment({
    mode: MODES.INSTALL,
    packageDir: 'dist/chrome-packages/official-browser-chrome',
    env: {
      FREEDOM_CHROME_PACKAGE_DIR: 'old-run',
      FREEDOM_CHROME_PACKAGE_INSTALL_DIR: 'old-install',
    },
  });

  expect(env.FREEDOM_CHROME_PACKAGE_DIR).toBeUndefined();
  expect(env.FREEDOM_CHROME_PACKAGE_INSTALL_DIR).toBe(
    path.resolve('dist/chrome-packages/official-browser-chrome')
  );
  expect(path.isAbsolute(env.FREEDOM_CHROME_PACKAGE_INSTALL_DIR)).toBe(true);
});

test('runOfficialChromePackage builds and launches with an absolute package dir', () => {
  const outputDir = makeOutputDir('run');
  const launches = [];

  const status = runOfficialChromePackage(['--out', outputDir], {
    env: {
      FREEDOM_CHROME_PACKAGE_DIR: 'relative-old',
      FREEDOM_CHROME_PACKAGE_INSTALL_DIR: 'relative-old-install',
      TMPDIR: os.tmpdir(),
    },
    runNpmStart: (launch) => {
      launches.push(launch);
      return { status: 0 };
    },
    stdio: 'pipe',
  });

  expect(status).toBe(0);
  expect(launches).toHaveLength(1);
  expect(launches[0].stdio).toBe('pipe');
  expect(launches[0].env.FREEDOM_CHROME_PACKAGE_DIR).toBe(outputDir);
  expect(launches[0].env.FREEDOM_CHROME_PACKAGE_INSTALL_DIR).toBeUndefined();
  expect(path.isAbsolute(launches[0].env.FREEDOM_CHROME_PACKAGE_DIR)).toBe(true);
  expect(fs.existsSync(path.join(outputDir, 'manifest.json'))).toBe(true);
});

test('runOfficialChromePackage install mode launches with an absolute install dir', () => {
  const outputDir = makeOutputDir('install');
  const launches = [];

  const status = runOfficialChromePackage(['--install', '--out', outputDir], {
    env: {
      FREEDOM_CHROME_PACKAGE_DIR: 'relative-old',
      FREEDOM_CHROME_PACKAGE_INSTALL_DIR: 'relative-old-install',
    },
    runNpmStart: (launch) => {
      launches.push(launch);
      return { status: 0 };
    },
    stdio: 'pipe',
  });

  expect(status).toBe(0);
  expect(launches).toHaveLength(1);
  expect(launches[0].env.FREEDOM_CHROME_PACKAGE_DIR).toBeUndefined();
  expect(launches[0].env.FREEDOM_CHROME_PACKAGE_INSTALL_DIR).toBe(outputDir);
  expect(path.isAbsolute(launches[0].env.FREEDOM_CHROME_PACKAGE_INSTALL_DIR)).toBe(true);
  expect(fs.existsSync(path.join(outputDir, 'manifest.json'))).toBe(true);
});
