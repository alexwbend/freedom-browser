const path = require('path');
const {
  MODES,
  createLaunchEnvironment,
  getPackageEnvKey,
  parseArgs,
} = require('./run-official-chrome-package');

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
