#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');
const {
  buildOfficialChromePackage,
  defaultOutputDir,
} = require('./build-official-chrome-package');

const repoRoot = path.resolve(__dirname, '..');

const MODES = Object.freeze({
  RUN: 'run',
  INSTALL: 'install',
});

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    mode: MODES.RUN,
    outputDir: defaultOutputDir,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--install') {
      options.mode = MODES.INSTALL;
    } else if (arg === '--run') {
      options.mode = MODES.RUN;
    } else if (arg === '--out') {
      options.outputDir = path.resolve(argv[++index] || '');
    } else if (arg.startsWith('--out=')) {
      options.outputDir = path.resolve(arg.slice('--out='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function getPackageEnvKey(mode) {
  if (mode === MODES.INSTALL) {
    return 'FREEDOM_CHROME_PACKAGE_INSTALL_DIR';
  }
  return 'FREEDOM_CHROME_PACKAGE_DIR';
}

function createLaunchEnvironment({ mode = MODES.RUN, packageDir, env = process.env } = {}) {
  if (!packageDir) {
    throw new Error('Package directory is required');
  }

  const nextEnv = { ...env };
  delete nextEnv.FREEDOM_CHROME_PACKAGE_DIR;
  delete nextEnv.FREEDOM_CHROME_PACKAGE_INSTALL_DIR;
  nextEnv[getPackageEnvKey(mode)] = path.resolve(packageDir);
  return nextEnv;
}

function runElectronApp({
  env = process.env,
  stdio = 'inherit',
  spawn = spawnSync,
  electronExecutable = require('electron'),
} = {}) {
  return spawn(electronExecutable, ['.'], {
    cwd: repoRoot,
    env,
    stdio,
  });
}

function runOfficialChromePackage(argv = process.argv.slice(2), options = {}) {
  const parsed = parseArgs(argv);
  const result = buildOfficialChromePackage({
    outputDir: parsed.outputDir,
  });
  const env = createLaunchEnvironment({
    mode: parsed.mode,
    packageDir: result.outputDir,
    env: options.env || process.env,
  });

  const child = (options.runElectronApp || options.runNpmStart || runElectronApp)({
    env,
    stdio: options.stdio || 'inherit',
  });
  if (child.error) {
    throw child.error;
  }
  return child.status ?? 1;
}

if (require.main === module) {
  try {
    process.exitCode = runOfficialChromePackage();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  MODES,
  createLaunchEnvironment,
  getPackageEnvKey,
  parseArgs,
  runElectronApp,
  runOfficialChromePackage,
};
