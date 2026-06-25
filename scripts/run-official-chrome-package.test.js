const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  MODES,
  createLaunchEnvironment,
  getPackageEnvKey,
  guardParentShutdownSignals,
  parseArgs,
  runElectronApp,
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

test('runElectronApp launches Electron directly from the repository root', () => {
  const calls = [];
  const result = runElectronApp({
    env: { FREEDOM_CHROME_PACKAGE_DIR: '/tmp/package' },
    stdio: 'pipe',
    electronExecutable: '/tmp/electron',
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  expect(result.status).toBe(0);
  expect(calls).toEqual([
    {
      command: '/tmp/electron',
      args: ['.'],
      options: {
        cwd: repoRoot,
        env: { FREEDOM_CHROME_PACKAGE_DIR: '/tmp/package' },
        stdio: 'pipe',
      },
    },
  ]);
});

test('runElectronApp guards parent shutdown signals while Electron runs', () => {
  const processTarget = new EventEmitter();
  const listenerCountsDuringSpawn = {};

  runElectronApp({
    env: { FREEDOM_CHROME_PACKAGE_DIR: '/tmp/package' },
    stdio: 'pipe',
    electronExecutable: '/tmp/electron',
    processTarget,
    spawn: () => {
      listenerCountsDuringSpawn.SIGINT = processTarget.listenerCount('SIGINT');
      listenerCountsDuringSpawn.SIGTERM = processTarget.listenerCount('SIGTERM');
      return { status: 0 };
    },
  });

  expect(listenerCountsDuringSpawn).toEqual({
    SIGINT: 1,
    SIGTERM: 1,
  });
  expect(processTarget.listenerCount('SIGINT')).toBe(0);
  expect(processTarget.listenerCount('SIGTERM')).toBe(0);
});

test('guardParentShutdownSignals unregisters no-op signal listeners', () => {
  const processTarget = new EventEmitter();
  const remove = guardParentShutdownSignals(processTarget);

  expect(processTarget.listenerCount('SIGINT')).toBe(1);
  expect(processTarget.listenerCount('SIGTERM')).toBe(1);

  remove();

  expect(processTarget.listenerCount('SIGINT')).toBe(0);
  expect(processTarget.listenerCount('SIGTERM')).toBe(0);
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
    runElectronApp: (launch) => {
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
    runElectronApp: (launch) => {
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
