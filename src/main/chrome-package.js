const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { version: appVersion } = require('../../package.json');
const {
  SHELL_API_VERSION,
  isKnownShellCapability,
  isShellApiVersionCompatible,
} = require('../shared/shell-api-policy');
const {
  installChromePackageFromDirectory,
  loadCurrentChromePackage,
} = require('./chrome-package-store');

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

function getRequestedChromePackageInstallDir({ env = process.env, argv = process.argv } = {}) {
  return parseChromePackageArgForName(argv, '--chrome-package-install') ||
    env.FREEDOM_CHROME_PACKAGE_INSTALL_DIR ||
    '';
}

function shouldUseChromePackageStore({ env = process.env, argv = process.argv } = {}) {
  if (argv.includes('--chrome-package-cache')) {
    return true;
  }
  return env.FREEDOM_CHROME_PACKAGE_CACHE === '1';
}

function parseChromePackageArgForName(argv = [], name) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (typeof value !== 'string') continue;
    if (value.startsWith(`${name}=`)) {
      return value.slice(`${name}=`.length);
    }
    if (value === name) {
      return argv[index + 1] || '';
    }
  }
  return '';
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

function normalizePackageFilePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    return null;
  }
  if (path.isAbsolute(relativePath)) {
    return null;
  }
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return null;
  }
  return normalized;
}

function hashFileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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

  const rawEntry = manifest.entry.trim();
  if (path.isAbsolute(rawEntry)) {
    return fail('ENTRY_NOT_RELATIVE', 'Chrome package entry must be a relative path', {
      packageRoot,
    });
  }

  const normalizedEntry = normalizePackageFilePath(rawEntry);
  if (!normalizedEntry) {
    return fail('ENTRY_OUTSIDE_PACKAGE', 'Chrome package entry cannot escape package directory', {
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

  const entryCandidate = path.join(packageRoot, normalizedEntry);
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

  if (
    manifest.guestContent !== undefined &&
    (!manifest.guestContent ||
      typeof manifest.guestContent !== 'object' ||
      Array.isArray(manifest.guestContent))
  ) {
    return fail('GUEST_CONTENT_INVALID', 'Chrome package guestContent must be an object', {
      packageRoot,
    });
  }

  const guestContent = manifest.guestContent || {};
  if (
    guestContent.transitionalWebviews !== undefined &&
    typeof guestContent.transitionalWebviews !== 'boolean'
  ) {
    return fail(
      'GUEST_CONTENT_WEBVIEWS_INVALID',
      'Chrome package guestContent.transitionalWebviews must be a boolean',
      { packageRoot }
    );
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return fail('PACKAGE_FILES_MISSING', 'Chrome package manifest requires a non-empty files array', {
      packageRoot,
    });
  }

  const files = [];
  const filePaths = new Set();
  for (const file of manifest.files) {
    const relativePath = normalizePackageFilePath(file?.path);
    if (!relativePath) {
      return fail('PACKAGE_FILE_PATH_INVALID', 'Chrome package file paths must be relative', {
        packageRoot,
        path: file?.path,
      });
    }
    if (filePaths.has(relativePath)) {
      return fail('PACKAGE_FILE_DUPLICATE', 'Chrome package file paths must be unique', {
        packageRoot,
        path: relativePath,
      });
    }
    if (typeof file?.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(file.sha256)) {
      return fail('PACKAGE_FILE_HASH_INVALID', 'Chrome package files require sha256 hashes', {
        packageRoot,
        path: relativePath,
      });
    }

    const fileCandidate = path.join(packageRoot, relativePath);
    let filePath;
    try {
      filePath = fs.realpathSync(fileCandidate);
    } catch {
      return fail('PACKAGE_FILE_MISSING', 'Chrome package file is missing', {
        packageRoot,
        path: relativePath,
      });
    }

    if (filePath !== packageRoot && !filePath.startsWith(`${packageRoot}${path.sep}`)) {
      return fail(
        'PACKAGE_FILE_OUTSIDE_PACKAGE',
        'Chrome package file cannot escape package directory',
        {
          packageRoot,
          path: relativePath,
        }
      );
    }
    if (!fs.statSync(filePath).isFile()) {
      return fail('PACKAGE_FILE_NOT_FILE', 'Chrome package file must be a file', {
        packageRoot,
        path: relativePath,
      });
    }

    const expectedHash = file.sha256.toLowerCase();
    const actualHash = hashFileSha256(filePath);
    if (actualHash !== expectedHash) {
      return fail('PACKAGE_FILE_HASH_MISMATCH', 'Chrome package file hash does not match manifest', {
        packageRoot,
        path: relativePath,
      });
    }

    filePaths.add(relativePath);
    files.push({
      path: relativePath,
      sha256: expectedHash,
    });
  }

  if (!filePaths.has(normalizedEntry)) {
    return fail('ENTRY_INTEGRITY_MISSING', 'Chrome package entry must be listed in files', {
      packageRoot,
      entry: normalizedEntry,
    });
  }

  const transitionalWebviews = guestContent.transitionalWebviews === true;

  return {
    ok: true,
    chromePackage: {
      kind: 'local-package',
      runtimeMode: 'local-package',
      source: 'local',
      packageRoot,
      manifestPath,
      entry: normalizedEntry,
      entryPath,
      preloadPath: path.join(__dirname, 'package-preload.js'),
      webviewTag: transitionalWebviews,
      transitionalWebviews,
      packageId: manifest.packageId,
      packageType: manifest.packageType,
      name: manifest.name,
      version: manifest.version,
      capabilities,
      files,
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
    const requestedInstallDir = getRequestedChromePackageInstallDir(options);
    if (requestedInstallDir) {
      const installResult = installChromePackageFromDirectory(requestedInstallDir, {
        allowDowngrade: options.allowDowngrade,
        allowSameVersionUpdate: options.allowSameVersionUpdate,
        shellApiVersion: options.shellApiVersion,
        storeRoot: options.storeRoot,
        validatePackage: validateLocalChromePackage,
      });
      if (installResult.ok) {
        return installResult.chromePackage;
      }

      options.logger?.warn?.('[chrome-package] falling back to bundled chrome', {
        code: installResult.error.code,
        message: installResult.error.message,
      });

      return {
        ...BUNDLED_CHROME_PACKAGE,
        fallback: {
          requestedDir: requestedInstallDir,
          error: installResult.error,
        },
      };
    }

    if (shouldUseChromePackageStore(options)) {
      const currentResult = loadCurrentChromePackage({
        shellApiVersion: options.shellApiVersion,
        storeRoot: options.storeRoot,
        validatePackage: validateLocalChromePackage,
      });
      if (currentResult.ok) {
        return currentResult.chromePackage;
      }

      options.logger?.warn?.('[chrome-package] falling back to bundled chrome', {
        code: currentResult.error.code,
        message: currentResult.error.message,
      });

      return {
        ...BUNDLED_CHROME_PACKAGE,
        fallback: {
          requestedStore: options.storeRoot || '',
          error: currentResult.error,
        },
      };
    }

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
  getRequestedChromePackageInstallDir,
  getRequestedChromePackageDir,
  hashFileSha256,
  isVersionCompatible,
  normalizePackageFilePath,
  selectChromePackage,
  setActiveChromePackage,
  shouldUseChromePackageStore,
  validateLocalChromePackage,
};
