const fs = require('fs');
const path = require('path');
const { version: appVersion } = require('../../package.json');
const {
  SHELL_API_VERSION,
  isKnownShellCapability,
  isShellApiVersionCompatible,
} = require('../shared/shell-api-policy');

const BUNDLED_CHROME_PACKAGE = Object.freeze({
  kind: 'bundled',
  runtimeMode: 'bundled',
  source: 'bundled',
  packageId: 'baby.freedom.chrome.bundled',
  packageType: 'browser-chrome',
  name: 'Freedom Bundled Chrome',
  version: appVersion,
  capabilities: ['bundled.preload'],
  entryPath: path.join(__dirname, '..', 'renderer', 'index.html'),
  preloadPath: path.join(__dirname, 'preload.js'),
  webviewTag: true,
});

let activeChromePackage = BUNDLED_CHROME_PACKAGE;

function getActiveChromePackage() {
  return activeChromePackage;
}

function setActiveChromePackage(chromePackage) {
  activeChromePackage = chromePackage || BUNDLED_CHROME_PACKAGE;
}

function parseChromePackageArg(argv = []) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (typeof value !== 'string') continue;
    if (value.startsWith('--chrome-package=')) {
      return value.slice('--chrome-package='.length);
    }
    if (value === '--chrome-package') {
      return argv[index + 1] || '';
    }
  }
  return '';
}

function getRequestedChromePackageDir({ env = process.env, argv = process.argv } = {}) {
  return parseChromePackageArg(argv) || env.FREEDOM_CHROME_PACKAGE_DIR || '';
}

function readJsonFile(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(filePath, 'utf-8')),
    };
  } catch (error) {
    return {
      ok: false,
      code: 'MANIFEST_INVALID_JSON',
      message: error?.message || 'Manifest is not valid JSON',
    };
  }
}

function isVersionCompatible({ minShellApi, maxShellApi }, shellApiVersion = SHELL_API_VERSION) {
  return isShellApiVersionCompatible({ minShellApi, maxShellApi }, shellApiVersion);
}

function fail(code, message, details = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...details,
    },
  };
}

function validateLocalChromePackage(packageDir, options = {}) {
  const shellApiVersion = options.shellApiVersion || SHELL_API_VERSION;
  if (!packageDir || typeof packageDir !== 'string') {
    return fail('PACKAGE_DIR_MISSING', 'Chrome package directory is required');
  }
  if (!path.isAbsolute(packageDir)) {
    return fail('PACKAGE_DIR_NOT_ABSOLUTE', 'Chrome package directory must be absolute');
  }

  let packageRoot;
  try {
    packageRoot = fs.realpathSync(packageDir);
  } catch {
    return fail('PACKAGE_DIR_NOT_FOUND', 'Chrome package directory does not exist');
  }

  const manifestPath = path.join(packageRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return fail('MANIFEST_MISSING', 'Chrome package manifest is missing', { packageRoot });
  }

  const manifestResult = readJsonFile(manifestPath);
  if (!manifestResult.ok) {
    return fail(manifestResult.code, manifestResult.message, { packageRoot });
  }

  const manifest = manifestResult.value;
  if (manifest?.manifestVersion !== 1) {
    return fail('MANIFEST_VERSION_UNSUPPORTED', 'Chrome package manifestVersion must be 1', {
      packageRoot,
    });
  }
  if (manifest.packageType !== 'browser-chrome') {
    return fail('PACKAGE_TYPE_UNSUPPORTED', 'Chrome package type must be browser-chrome', {
      packageRoot,
    });
  }

  for (const field of ['packageId', 'name', 'version', 'entry']) {
    if (typeof manifest[field] !== 'string' || !manifest[field].trim()) {
      return fail('MANIFEST_FIELD_MISSING', `Chrome package manifest requires ${field}`, {
        packageRoot,
        field,
      });
    }
  }

  if (path.isAbsolute(manifest.entry)) {
    return fail('ENTRY_NOT_RELATIVE', 'Chrome package entry must be a relative path', {
      packageRoot,
    });
  }

  const compatibility = manifest.shellCompatibility || {};
  if (
    typeof compatibility.minShellApi !== 'string' ||
    typeof compatibility.maxShellApi !== 'string'
  ) {
    return fail(
      'SHELL_COMPATIBILITY_MISSING',
      'Chrome package manifest requires shellCompatibility minShellApi and maxShellApi',
      { packageRoot }
    );
  }
  if (!isVersionCompatible(compatibility, shellApiVersion)) {
    return fail('SHELL_COMPATIBILITY_UNSUPPORTED', 'Chrome package is incompatible with shell API', {
      packageRoot,
      shellApiVersion,
      minShellApi: compatibility.minShellApi,
      maxShellApi: compatibility.maxShellApi,
    });
  }

  const entryCandidate = path.join(packageRoot, manifest.entry);
  let entryPath;
  try {
    entryPath = fs.realpathSync(entryCandidate);
  } catch {
    return fail('ENTRY_MISSING', 'Chrome package entry file is missing', { packageRoot });
  }

  if (entryPath !== packageRoot && !entryPath.startsWith(`${packageRoot}${path.sep}`)) {
    return fail('ENTRY_OUTSIDE_PACKAGE', 'Chrome package entry cannot escape package directory', {
      packageRoot,
    });
  }

  const entryStat = fs.statSync(entryPath);
  if (!entryStat.isFile()) {
    return fail('ENTRY_NOT_FILE', 'Chrome package entry must be a file', { packageRoot });
  }

  if (manifest.capabilities !== undefined && !Array.isArray(manifest.capabilities)) {
    return fail('CAPABILITIES_INVALID', 'Chrome package capabilities must be an array', {
      packageRoot,
    });
  }

  const capabilities = [];
  for (const capability of manifest.capabilities || []) {
    if (typeof capability !== 'string' || !capability.trim()) {
      return fail('CAPABILITY_INVALID', 'Chrome package capabilities must be non-empty strings', {
        packageRoot,
      });
    }
    const normalizedCapability = capability.trim();
    if (!isKnownShellCapability(normalizedCapability)) {
      return fail('CAPABILITY_UNKNOWN', 'Chrome package declared an unknown capability', {
        packageRoot,
        capability: normalizedCapability,
      });
    }
    if (!capabilities.includes(normalizedCapability)) {
      capabilities.push(normalizedCapability);
    }
  }

  return {
    ok: true,
    chromePackage: {
      kind: 'local-package',
      runtimeMode: 'local-package',
      source: 'local',
      packageRoot,
      manifestPath,
      entryPath,
      preloadPath: path.join(__dirname, 'package-preload.js'),
      webviewTag: false,
      packageId: manifest.packageId,
      packageType: manifest.packageType,
      name: manifest.name,
      version: manifest.version,
      capabilities,
      shellCompatibility: {
        minShellApi: compatibility.minShellApi,
        maxShellApi: compatibility.maxShellApi,
      },
    },
  };
}

function selectChromePackage(options = {}) {
  const requestedDir = getRequestedChromePackageDir(options);
  if (!requestedDir) {
    return BUNDLED_CHROME_PACKAGE;
  }

  const result = validateLocalChromePackage(requestedDir, {
    shellApiVersion: options.shellApiVersion,
  });
  if (result.ok) {
    return result.chromePackage;
  }

  options.logger?.warn?.('[chrome-package] falling back to bundled chrome', {
    code: result.error.code,
    message: result.error.message,
  });

  return {
    ...BUNDLED_CHROME_PACKAGE,
    fallback: {
      requestedDir,
      error: result.error,
    },
  };
}

module.exports = {
  BUNDLED_CHROME_PACKAGE,
  SHELL_API_VERSION,
  getActiveChromePackage,
  getRequestedChromePackageDir,
  isVersionCompatible,
  selectChromePackage,
  setActiveChromePackage,
  validateLocalChromePackage,
};
