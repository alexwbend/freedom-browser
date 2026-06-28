#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { version: appVersion } = require('../package.json');
const { validateLocalChromePackage } = require('../src/main/chrome-package');

const repoRoot = path.resolve(__dirname, '..');
const defaultSourceDir = path.join(repoRoot, 'packages', 'official-browser-chrome', 'src');
const defaultOutputDir = path.join(repoRoot, 'dist', 'chrome-packages', 'official-browser-chrome');

const OFFICIAL_CHROME_CAPABILITIES = Object.freeze([
  'shell.info',
  'shell.ready',
  'navigation.resolve',
  'tabs.read',
  'tabs.write',
  'browserState.settings.read',
  'browserState.settings.write',
  'browserState.bookmarks.read',
  'browserState.bookmarks.write',
  'browserState.history.read',
  'browserState.history.write',
  'browserState.favicons.read',
  'browserState.favicons.write',
  'browserState.profiles.read',
  'services.read',
  'chrome.ui.commands',
  'clipboard.write',
  'downloads.saveImage',
  'surfaces.wallet.control',
  'surfaces.identity.control',
  'surfaces.payments.control',
  'surfaces.swarmPublish.control',
  'windows.control',
  'windows.open',
  'app.about',
  'app.updates',
]);

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    sourceDir: defaultSourceDir,
    outputDir: defaultOutputDir,
    quiet: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') {
      options.sourceDir = path.resolve(argv[++index] || '');
    } else if (arg.startsWith('--source=')) {
      options.sourceDir = path.resolve(arg.slice('--source='.length));
    } else if (arg === '--out') {
      options.outputDir = path.resolve(argv[++index] || '');
    } else if (arg.startsWith('--out=')) {
      options.outputDir = path.resolve(arg.slice('--out='.length));
    } else if (arg === '--quiet') {
      options.quiet = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function toPosixPath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function ensureInsideRepo(targetPath, label) {
  const relative = path.relative(repoRoot, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside the repository`);
  }
}

function ensureSafeOutputDirectory(outputDir) {
  const parsed = path.parse(outputDir);
  if (outputDir === parsed.root) {
    throw new Error('Official chrome output directory cannot be a filesystem root');
  }
  if (outputDir === repoRoot) {
    throw new Error('Official chrome output directory cannot be the repository root');
  }
}

function hashFileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isDevelopmentOnlyFile(relativePath) {
  const base = path.basename(relativePath);
  return (
    base === 'manifest.json' ||
    base.endsWith('.test.js') ||
    relativePath.includes(`${path.sep}__tests__${path.sep}`) ||
    relativePath.includes(`${path.sep}coverage${path.sep}`)
  );
}

function listFiles(root) {
  const files = [];
  const visit = (relativeDir = '') => {
    const absoluteDir = path.join(root, relativeDir);
    const names = fs.readdirSync(absoluteDir).sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const relativePath = path.join(relativeDir, name);
      if (isDevelopmentOnlyFile(relativePath)) {
        continue;
      }
      const absolutePath = path.join(root, relativePath);
      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) {
        visit(relativePath);
      } else if (stat.isFile()) {
        files.push(relativePath);
      }
    }
  };
  visit();
  return files;
}

function copyPackageSource(sourceDir, outputDir) {
  const sourceFiles = listFiles(sourceDir);
  for (const relativePath of sourceFiles) {
    const from = path.join(sourceDir, relativePath);
    const to = path.join(outputDir, relativePath);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  return sourceFiles;
}

function createManifest(outputDir, version = appVersion) {
  const files = listFiles(outputDir)
    .map((relativePath) => ({
      path: toPosixPath(relativePath),
      sha256: hashFileSha256(path.join(outputDir, relativePath)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    manifestVersion: 1,
    packageType: 'browser-chrome',
    packageId: 'baby.freedom.chrome.official-local',
    name: 'Freedom Official Local Chrome',
    version,
    entry: 'index.html',
    shellCompatibility: {
      minShellApi: '0.1.0',
      maxShellApi: '0.1.x',
    },
    capabilities: [...OFFICIAL_CHROME_CAPABILITIES],
    guestContent: {
      webviews: true,
    },
    files,
  };
}

function buildOfficialChromePackage(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || defaultSourceDir);
  const outputDir = path.resolve(options.outputDir || defaultOutputDir);

  ensureInsideRepo(sourceDir, 'Official chrome source directory');
  ensureSafeOutputDirectory(outputDir);

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Official chrome source directory does not exist: ${sourceDir}`);
  }
  if (!fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Official chrome source path is not a directory: ${sourceDir}`);
  }

  const sourceRelativeToOutput = path.relative(sourceDir, outputDir);
  if (sourceRelativeToOutput && !sourceRelativeToOutput.startsWith('..') && !path.isAbsolute(sourceRelativeToOutput)) {
    throw new Error('Official chrome output directory must not be inside the source directory');
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  copyPackageSource(sourceDir, outputDir);

  const manifest = createManifest(outputDir, options.version || appVersion);
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const validation = validateLocalChromePackage(outputDir);
  if (!validation.ok) {
    throw new Error(
      `Generated official chrome package failed validation: ${validation.error.code} ${validation.error.message}`
    );
  }

  return {
    sourceDir,
    outputDir,
    manifest,
    chromePackage: validation.chromePackage,
  };
}

if (require.main === module) {
  try {
    const options = parseArgs();
    const result = buildOfficialChromePackage(options);
    if (!options.quiet) {
      console.log(`Built official chrome package: ${path.relative(repoRoot, result.outputDir)}`);
      console.log(`Files: ${result.manifest.files.length}`);
      console.log(`Version: ${result.manifest.version}`);
    }
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  OFFICIAL_CHROME_CAPABILITIES,
  buildOfficialChromePackage,
  createManifest,
  defaultOutputDir,
  defaultSourceDir,
  listFiles,
  parseArgs,
};
