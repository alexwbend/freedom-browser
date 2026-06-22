const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_VERSION = 1;
const STORE_DIR_NAME = 'chrome-package-store';
const CURRENT_POINTER_FILE = 'current.json';
const PREVIOUS_POINTER_FILE = 'previous.json';
const INSTALL_METADATA_FILE = '.freedom-package-install.json';

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

function hashFileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function hashJsonSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function getChromePackageStoreRoot({ userDataDir } = {}) {
  if (typeof userDataDir !== 'string' || !userDataDir.trim()) {
    return '';
  }
  return path.join(userDataDir, STORE_DIR_NAME);
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}

function readJsonFile(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(filePath, 'utf-8')),
    };
  } catch (error) {
    return fail('STORE_JSON_INVALID', 'Store JSON could not be read', {
      path: filePath,
      cause: error?.message || String(error),
    });
  }
}

function safeSegment(value, fallback = 'value') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeStoreRelativePath(relativePath) {
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

function resolveStoreRelativePath(storeRoot, relativePath) {
  const normalized = normalizeStoreRelativePath(relativePath);
  if (!normalized) {
    return null;
  }
  const absoluteStoreRoot = path.resolve(storeRoot);
  const absolutePath = path.resolve(absoluteStoreRoot, ...normalized.split('/'));
  if (absolutePath !== absoluteStoreRoot && !absolutePath.startsWith(`${absoluteStoreRoot}${path.sep}`)) {
    return null;
  }
  return absolutePath;
}

function getPointerPath(storeRoot, name) {
  return path.join(storeRoot, name);
}

function readPointer(storeRoot, name) {
  const pointerPath = getPointerPath(storeRoot, name);
  if (!fs.existsSync(pointerPath)) {
    return null;
  }
  const result = readJsonFile(pointerPath);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    pointer: result.value,
  };
}

function createContentDigest(chromePackage) {
  const files = [...(chromePackage.files || [])]
    .map((file) => ({
      path: file.path,
      sha256: file.sha256,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return hashJsonSha256({
    packageId: chromePackage.packageId,
    packageType: chromePackage.packageType,
    version: chromePackage.version,
    entry: chromePackage.entry || path.basename(chromePackage.entryPath || ''),
    shellCompatibility: chromePackage.shellCompatibility,
    capabilities: [...(chromePackage.capabilities || [])].sort(),
    files,
  });
}

function createInstallRelativePath(chromePackage, contentDigest) {
  return path.posix.join(
    'packages',
    safeSegment(chromePackage.packageId, 'package'),
    safeSegment(chromePackage.version, 'version'),
    contentDigest.slice(0, 32)
  );
}

function createPointer(chromePackage, installPath, metadata, activatedAt = new Date().toISOString()) {
  return {
    storeVersion: STORE_VERSION,
    packageId: chromePackage.packageId,
    packageType: chromePackage.packageType,
    version: chromePackage.version,
    installPath,
    contentDigest: metadata.contentDigest,
    manifestSha256: metadata.manifestSha256,
    activatedAt,
  };
}

function createInstallMetadata(chromePackage, contentDigest) {
  return {
    storeVersion: STORE_VERSION,
    packageId: chromePackage.packageId,
    packageType: chromePackage.packageType,
    version: chromePackage.version,
    entry: chromePackage.entry || path.basename(chromePackage.entryPath || ''),
    contentDigest,
    manifestSha256: hashFileSha256(chromePackage.manifestPath),
    files: (chromePackage.files || []).map((file) => ({
      path: file.path,
      sha256: file.sha256,
    })),
    installedAt: new Date().toISOString(),
  };
}

function compareVersionPart(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }
  return left.localeCompare(right);
}

function comparePackageVersions(left, right) {
  const leftParts = String(left || '').split(/[.+-]/);
  const rightParts = String(right || '').split(/[.+-]/);
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index += 1) {
    const result = compareVersionPart(leftParts[index] || '0', rightParts[index] || '0');
    if (result !== 0) {
      return result < 0 ? -1 : 1;
    }
  }
  return 0;
}

function validateStoreRoot(storeRoot) {
  if (typeof storeRoot !== 'string' || !storeRoot.trim()) {
    return fail('STORE_ROOT_MISSING', 'Chrome package store root is required');
  }
  if (!path.isAbsolute(storeRoot)) {
    return fail('STORE_ROOT_NOT_ABSOLUTE', 'Chrome package store root must be absolute');
  }
  return { ok: true };
}

function validatePackageWith(validatePackage, packageDir, options = {}) {
  if (typeof validatePackage !== 'function') {
    return fail('STORE_VALIDATOR_MISSING', 'Chrome package validator is required');
  }
  return validatePackage(packageDir, {
    shellApiVersion: options.shellApiVersion,
  });
}

function copyPackageIntoStaging(chromePackage, stagingRoot) {
  ensureDirectory(stagingRoot);
  fs.copyFileSync(chromePackage.manifestPath, path.join(stagingRoot, 'manifest.json'));

  for (const file of chromePackage.files || []) {
    const sourcePath = path.join(chromePackage.packageRoot, ...file.path.split('/'));
    const destinationPath = path.join(stagingRoot, ...file.path.split('/'));
    ensureDirectory(path.dirname(destinationPath));
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function readInstallMetadata(installDir) {
  const metadataPath = path.join(installDir, INSTALL_METADATA_FILE);
  if (!fs.existsSync(metadataPath)) {
    return fail('STORE_METADATA_MISSING', 'Chrome package install metadata is missing');
  }
  const result = readJsonFile(metadataPath);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    metadata: result.value,
  };
}

function validatePointer(pointer) {
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer)) {
    return fail('STORE_POINTER_INVALID', 'Chrome package pointer is invalid');
  }
  if (pointer.storeVersion !== STORE_VERSION) {
    return fail('STORE_POINTER_VERSION_UNSUPPORTED', 'Chrome package pointer version is unsupported');
  }
  for (const field of ['packageId', 'packageType', 'version', 'installPath', 'contentDigest', 'manifestSha256']) {
    if (typeof pointer[field] !== 'string' || !pointer[field].trim()) {
      return fail('STORE_POINTER_FIELD_MISSING', `Chrome package pointer requires ${field}`, {
        field,
      });
    }
  }
  return { ok: true };
}

function loadChromePackageFromPointer(pointer, options = {}) {
  const storeRootValidation = validateStoreRoot(options.storeRoot);
  if (!storeRootValidation.ok) {
    return storeRootValidation;
  }

  const pointerValidation = validatePointer(pointer);
  if (!pointerValidation.ok) {
    return pointerValidation;
  }

  const installDir = resolveStoreRelativePath(options.storeRoot, pointer.installPath);
  if (!installDir || !fs.existsSync(installDir)) {
    return fail('STORE_PACKAGE_MISSING', 'Cached chrome package is missing', {
      installPath: pointer.installPath,
    });
  }

  const metadataResult = readInstallMetadata(installDir);
  if (!metadataResult.ok) {
    return metadataResult;
  }
  const metadata = metadataResult.metadata;
  if (
    metadata.storeVersion !== STORE_VERSION ||
    metadata.packageId !== pointer.packageId ||
    metadata.version !== pointer.version ||
    metadata.contentDigest !== pointer.contentDigest ||
    metadata.manifestSha256 !== pointer.manifestSha256
  ) {
    return fail('STORE_METADATA_MISMATCH', 'Chrome package install metadata does not match pointer', {
      installPath: pointer.installPath,
    });
  }

  const manifestPath = path.join(installDir, 'manifest.json');
  if (!fs.existsSync(manifestPath) || hashFileSha256(manifestPath) !== pointer.manifestSha256) {
    return fail('STORE_MANIFEST_HASH_MISMATCH', 'Cached chrome package manifest hash does not match pointer', {
      installPath: pointer.installPath,
    });
  }

  const validation = validatePackageWith(options.validatePackage, installDir, options);
  if (!validation.ok) {
    return fail('STORE_PACKAGE_INVALID', 'Cached chrome package failed validation', {
      installPath: pointer.installPath,
      cause: validation.error,
    });
  }

  const contentDigest = createContentDigest(validation.chromePackage);
  if (contentDigest !== pointer.contentDigest) {
    return fail('STORE_CONTENT_DIGEST_MISMATCH', 'Cached chrome package content digest does not match pointer', {
      installPath: pointer.installPath,
    });
  }

  return {
    ok: true,
    chromePackage: {
      ...validation.chromePackage,
      source: 'store',
      store: {
        installPath: pointer.installPath,
        contentDigest: pointer.contentDigest,
        manifestSha256: pointer.manifestSha256,
      },
    },
    pointer,
  };
}

function loadCurrentChromePackage(options = {}) {
  const storeRootValidation = validateStoreRoot(options.storeRoot);
  if (!storeRootValidation.ok) {
    return storeRootValidation;
  }

  const pointerResult = readPointer(options.storeRoot, CURRENT_POINTER_FILE);
  if (!pointerResult) {
    return fail('STORE_CURRENT_MISSING', 'No cached chrome package is active');
  }
  if (!pointerResult.ok) {
    return pointerResult;
  }
  return loadChromePackageFromPointer(pointerResult.pointer, options);
}

function shouldRejectInstallForCurrent(currentPointer, nextPointer, options = {}) {
  if (!currentPointer || currentPointer.packageId !== nextPointer.packageId) {
    return null;
  }

  const versionComparison = comparePackageVersions(nextPointer.version, currentPointer.version);
  if (versionComparison < 0 && options.allowDowngrade !== true) {
    return fail('PACKAGE_DOWNGRADE_REJECTED', 'Chrome package downgrade was rejected', {
      currentVersion: currentPointer.version,
      nextVersion: nextPointer.version,
    });
  }

  if (
    versionComparison === 0 &&
    currentPointer.contentDigest !== nextPointer.contentDigest &&
    options.allowSameVersionUpdate !== true
  ) {
    return fail('PACKAGE_REPLAY_REJECTED', 'Chrome package replay with changed content was rejected', {
      version: nextPointer.version,
    });
  }

  return null;
}

function installChromePackageFromDirectory(sourceDir, options = {}) {
  const storeRootValidation = validateStoreRoot(options.storeRoot);
  if (!storeRootValidation.ok) {
    return storeRootValidation;
  }

  const sourceValidation = validatePackageWith(options.validatePackage, sourceDir, options);
  if (!sourceValidation.ok) {
    return fail('SOURCE_PACKAGE_INVALID', 'Source chrome package failed validation', {
      cause: sourceValidation.error,
    });
  }

  ensureDirectory(options.storeRoot);

  const chromePackage = sourceValidation.chromePackage;
  const contentDigest = createContentDigest(chromePackage);
  const metadata = createInstallMetadata(chromePackage, contentDigest);
  const installPath = createInstallRelativePath(chromePackage, contentDigest);
  const nextPointer = createPointer(chromePackage, installPath, metadata);

  const currentPointerResult = readPointer(options.storeRoot, CURRENT_POINTER_FILE);
  const currentPointer = currentPointerResult?.ok ? currentPointerResult.pointer : null;
  const rejectResult = shouldRejectInstallForCurrent(currentPointer, nextPointer, options);
  if (rejectResult) {
    return rejectResult;
  }

  const finalInstallDir = resolveStoreRelativePath(options.storeRoot, installPath);
  const stagingRoot = path.join(
    options.storeRoot,
    'staging',
    `${Date.now()}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  );

  try {
    copyPackageIntoStaging(chromePackage, stagingRoot);
    writeJsonAtomic(path.join(stagingRoot, INSTALL_METADATA_FILE), metadata);

    const stagedValidation = validatePackageWith(options.validatePackage, stagingRoot, options);
    if (!stagedValidation.ok) {
      return fail('STAGED_PACKAGE_INVALID', 'Staged chrome package failed validation', {
        cause: stagedValidation.error,
      });
    }
    if (hashFileSha256(path.join(stagingRoot, 'manifest.json')) !== metadata.manifestSha256) {
      return fail('STAGED_MANIFEST_HASH_MISMATCH', 'Staged chrome package manifest hash changed');
    }

    ensureDirectory(path.dirname(finalInstallDir));
    if (fs.existsSync(finalInstallDir)) {
      fs.rmSync(finalInstallDir, { recursive: true, force: true });
    }
    fs.renameSync(stagingRoot, finalInstallDir);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }

  const finalValidation = loadChromePackageFromPointer(nextPointer, {
    ...options,
    storeRoot: options.storeRoot,
  });
  if (!finalValidation.ok) {
    return finalValidation;
  }

  if (currentPointer && currentPointer.installPath !== nextPointer.installPath) {
    writeJsonAtomic(getPointerPath(options.storeRoot, PREVIOUS_POINTER_FILE), currentPointer);
  }
  writeJsonAtomic(getPointerPath(options.storeRoot, CURRENT_POINTER_FILE), nextPointer);

  return {
    ok: true,
    chromePackage: finalValidation.chromePackage,
    current: nextPointer,
    previous: currentPointer && currentPointer.installPath !== nextPointer.installPath ? currentPointer : null,
  };
}

function rollbackChromePackageStore(options = {}) {
  const storeRootValidation = validateStoreRoot(options.storeRoot);
  if (!storeRootValidation.ok) {
    return storeRootValidation;
  }

  const previousPointerResult = readPointer(options.storeRoot, PREVIOUS_POINTER_FILE);
  if (!previousPointerResult) {
    return fail('STORE_PREVIOUS_MISSING', 'No previous chrome package is available for rollback');
  }
  if (!previousPointerResult.ok) {
    return previousPointerResult;
  }

  const previousValidation = loadChromePackageFromPointer(previousPointerResult.pointer, options);
  if (!previousValidation.ok) {
    return fail('STORE_PREVIOUS_INVALID', 'Previous chrome package is not usable for rollback', {
      cause: previousValidation.error,
    });
  }

  const currentPointerResult = readPointer(options.storeRoot, CURRENT_POINTER_FILE);
  if (currentPointerResult?.ok) {
    writeJsonAtomic(getPointerPath(options.storeRoot, PREVIOUS_POINTER_FILE), currentPointerResult.pointer);
  }
  writeJsonAtomic(getPointerPath(options.storeRoot, CURRENT_POINTER_FILE), previousPointerResult.pointer);

  return {
    ok: true,
    chromePackage: previousValidation.chromePackage,
    current: previousPointerResult.pointer,
    previous: currentPointerResult?.ok ? currentPointerResult.pointer : null,
  };
}

module.exports = {
  CURRENT_POINTER_FILE,
  INSTALL_METADATA_FILE,
  PREVIOUS_POINTER_FILE,
  STORE_DIR_NAME,
  STORE_VERSION,
  comparePackageVersions,
  createContentDigest,
  getChromePackageStoreRoot,
  installChromePackageFromDirectory,
  loadCurrentChromePackage,
  loadChromePackageFromPointer,
  rollbackChromePackageStore,
};
