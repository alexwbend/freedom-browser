const fs = require('fs');
const path = require('path');
const {
  comparePackageVersions,
  installChromePackageFromDirectory,
  loadCurrentChromePackage,
} = require('./chrome-package-store');

const LOCAL_PACKAGE_FEED_VERSION = 1;

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

function readJsonFile(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(filePath, 'utf-8')),
    };
  } catch (error) {
    return fail('FEED_JSON_INVALID', 'Chrome package feed JSON could not be read', {
      path: filePath,
      cause: error?.message || String(error),
    });
  }
}

function validateFeedPath(feedPath) {
  if (typeof feedPath !== 'string' || !feedPath.trim()) {
    return fail('FEED_PATH_MISSING', 'Chrome package feed path is required');
  }
  if (!path.isAbsolute(feedPath)) {
    return fail('FEED_PATH_NOT_ABSOLUTE', 'Chrome package feed path must be absolute');
  }
  if (!fs.existsSync(feedPath)) {
    return fail('FEED_FILE_MISSING', 'Chrome package feed file is missing', { path: feedPath });
  }
  if (!fs.statSync(feedPath).isFile()) {
    return fail('FEED_FILE_NOT_FILE', 'Chrome package feed path must point to a file', {
      path: feedPath,
    });
  }
  return { ok: true };
}

function normalizeSourcePath(feedRoot, sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    return null;
  }
  if (path.isAbsolute(sourcePath)) {
    return path.normalize(sourcePath);
  }
  return path.resolve(feedRoot, sourcePath);
}

function validateFeed(feed, feedPath) {
  if (!feed || typeof feed !== 'object' || Array.isArray(feed)) {
    return fail('FEED_INVALID', 'Chrome package feed must be an object', { path: feedPath });
  }
  if (feed.feedVersion !== LOCAL_PACKAGE_FEED_VERSION) {
    return fail('FEED_VERSION_UNSUPPORTED', 'Chrome package feed version is unsupported', {
      path: feedPath,
      feedVersion: feed.feedVersion,
    });
  }
  if (!Array.isArray(feed.packages) || feed.packages.length === 0) {
    return fail('FEED_PACKAGES_INVALID', 'Chrome package feed requires a non-empty packages array', {
      path: feedPath,
    });
  }
  if (feed.packageId !== undefined && (typeof feed.packageId !== 'string' || !feed.packageId.trim())) {
    return fail('FEED_PACKAGE_ID_INVALID', 'Chrome package feed packageId must be a non-empty string', {
      path: feedPath,
    });
  }
  return { ok: true };
}

function readLocalPackageFeed(feedPath) {
  const pathValidation = validateFeedPath(feedPath);
  if (!pathValidation.ok) {
    return pathValidation;
  }

  const result = readJsonFile(feedPath);
  if (!result.ok) {
    return result;
  }

  const feedValidation = validateFeed(result.value, feedPath);
  if (!feedValidation.ok) {
    return feedValidation;
  }

  return {
    ok: true,
    feed: result.value,
    feedPath,
    feedRoot: path.dirname(feedPath),
  };
}

function normalizeFeedPackageSource(feedRoot, packageEntry) {
  if (!packageEntry || typeof packageEntry !== 'object' || Array.isArray(packageEntry)) {
    return fail('FEED_PACKAGE_INVALID', 'Chrome package feed entry must be an object');
  }
  if (typeof packageEntry.version !== 'string' || !packageEntry.version.trim()) {
    return fail('FEED_PACKAGE_VERSION_MISSING', 'Chrome package feed entry requires version');
  }
  if (
    packageEntry.packageId !== undefined &&
    (typeof packageEntry.packageId !== 'string' || !packageEntry.packageId.trim())
  ) {
    return fail('FEED_PACKAGE_ID_INVALID', 'Chrome package feed entry packageId must be a string');
  }

  const source = packageEntry.source || {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return fail('FEED_SOURCE_INVALID', 'Chrome package feed entry requires a source object');
  }
  if (source.type !== 'directory') {
    return fail('FEED_SOURCE_TYPE_UNSUPPORTED', 'Only directory chrome package feed sources are supported', {
      sourceType: source.type,
      version: packageEntry.version,
    });
  }

  const sourceDir = normalizeSourcePath(feedRoot, source.path);
  if (!sourceDir) {
    return fail('FEED_SOURCE_PATH_INVALID', 'Chrome package feed source path is invalid', {
      version: packageEntry.version,
    });
  }

  return {
    ok: true,
    sourceDir,
    version: packageEntry.version,
    packageId: packageEntry.packageId || '',
  };
}

function validatePackageWith(validatePackage, packageDir, options = {}) {
  if (typeof validatePackage !== 'function') {
    return fail('FEED_VALIDATOR_MISSING', 'Chrome package feed validator is required');
  }
  return validatePackage(packageDir, {
    shellApiVersion: options.shellApiVersion,
  });
}

function createFeedCandidate(feed, feedRoot, packageEntry, options = {}) {
  const sourceResult = normalizeFeedPackageSource(feedRoot, packageEntry);
  if (!sourceResult.ok) {
    return sourceResult;
  }

  const validation = validatePackageWith(options.validatePackage, sourceResult.sourceDir, options);
  if (!validation.ok) {
    return fail('FEED_SOURCE_PACKAGE_INVALID', 'Chrome package feed source failed validation', {
      sourceDir: sourceResult.sourceDir,
      version: sourceResult.version,
      cause: validation.error,
    });
  }

  const chromePackage = validation.chromePackage;
  if (feed.packageId && chromePackage.packageId !== feed.packageId) {
    return fail('FEED_PACKAGE_ID_MISMATCH', 'Chrome package feed source packageId does not match feed', {
      expectedPackageId: feed.packageId,
      actualPackageId: chromePackage.packageId,
      sourceDir: sourceResult.sourceDir,
    });
  }
  if (sourceResult.packageId && chromePackage.packageId !== sourceResult.packageId) {
    return fail('FEED_PACKAGE_ID_MISMATCH', 'Chrome package feed source packageId does not match entry', {
      expectedPackageId: sourceResult.packageId,
      actualPackageId: chromePackage.packageId,
      sourceDir: sourceResult.sourceDir,
    });
  }
  if (chromePackage.version !== sourceResult.version) {
    return fail('FEED_PACKAGE_VERSION_MISMATCH', 'Chrome package feed source version does not match entry', {
      expectedVersion: sourceResult.version,
      actualVersion: chromePackage.version,
      sourceDir: sourceResult.sourceDir,
    });
  }

  return {
    ok: true,
    sourceDir: sourceResult.sourceDir,
    chromePackage,
  };
}

function isCandidateNewerThanCurrent(candidate, currentPackage, options = {}) {
  if (!currentPackage || currentPackage.packageId !== candidate.chromePackage.packageId) {
    return true;
  }

  const versionComparison = comparePackageVersions(
    candidate.chromePackage.version,
    currentPackage.version
  );
  if (versionComparison > 0) {
    return true;
  }
  if (versionComparison < 0) {
    return options.allowDowngrade === true;
  }
  return options.allowSameVersionUpdate === true;
}

function installChromePackageFromLocalFeed(feedPath, options = {}) {
  const feedResult = readLocalPackageFeed(feedPath);
  if (!feedResult.ok) {
    return feedResult;
  }

  const currentResult = loadCurrentChromePackage({
    shellApiVersion: options.shellApiVersion,
    storeRoot: options.storeRoot,
    validatePackage: options.validatePackage,
  });
  const currentPackage = currentResult.ok ? currentResult.chromePackage : null;
  const failures = [];
  const candidates = [];

  for (const packageEntry of feedResult.feed.packages) {
    const candidateResult = createFeedCandidate(
      feedResult.feed,
      feedResult.feedRoot,
      packageEntry,
      options
    );
    if (candidateResult.ok) {
      candidates.push(candidateResult);
    } else {
      failures.push(candidateResult.error);
    }
  }

  candidates.sort((left, right) =>
    -comparePackageVersions(left.chromePackage.version, right.chromePackage.version)
  );

  for (const candidate of candidates) {
    if (!isCandidateNewerThanCurrent(candidate, currentPackage, options)) {
      continue;
    }

    const installResult = installChromePackageFromDirectory(candidate.sourceDir, {
      allowDowngrade: options.allowDowngrade,
      allowSameVersionUpdate: options.allowSameVersionUpdate,
      shellApiVersion: options.shellApiVersion,
      storeRoot: options.storeRoot,
      validatePackage: options.validatePackage,
    });
    if (installResult.ok) {
      return {
        ...installResult,
        feed: {
          feedPath: feedResult.feedPath,
          sourceDir: candidate.sourceDir,
        },
      };
    }
    failures.push(installResult.error);
  }

  if (currentResult.ok) {
    return {
      ok: true,
      chromePackage: currentResult.chromePackage,
      current: currentResult.pointer,
      feed: {
        feedPath: feedResult.feedPath,
        updateSkipped: true,
        failures,
      },
    };
  }

  return fail('FEED_NO_INSTALLABLE_PACKAGE', 'Chrome package feed has no installable package', {
    path: feedPath,
    failures,
    cacheError: currentResult.error,
  });
}

module.exports = {
  LOCAL_PACKAGE_FEED_VERSION,
  installChromePackageFromLocalFeed,
  readLocalPackageFeed,
};
