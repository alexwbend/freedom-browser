const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('./logger');
const {
  getActiveChromePackage,
  normalizePackageFilePath,
} = require('./chrome-package');

const CHROME_PACKAGE_SCHEME = 'freedom-chrome';
const CHROME_PACKAGE_ACTIVE_HOST = 'active';
const CHROME_PACKAGE_ACTIVE_ORIGIN = `${CHROME_PACKAGE_SCHEME}://${CHROME_PACKAGE_ACTIVE_HOST}`;

const PACKAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https: bzz: ipfs: ipns:",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* http: https: bzz: ipfs: ipns:",
  "frame-src 'self' http: https: bzz: ipfs: ipns: freedom:",
  "child-src 'self' http: https: bzz: ipfs: ipns: freedom:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

function hashFileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function encodePackagePath(relativePath) {
  const normalized = normalizePackageFilePath(relativePath);
  if (!normalized) {
    return '';
  }
  return normalized.split('/').map(encodeURIComponent).join('/');
}

function getChromePackageAssetUrl(relativePath = '') {
  const encodedPath = encodePackagePath(relativePath);
  return `${CHROME_PACKAGE_ACTIVE_ORIGIN}/${encodedPath}`;
}

function getChromePackageEntryUrl(chromePackage) {
  if (!usesChromePackageProtocol(chromePackage)) {
    return null;
  }
  return getChromePackageAssetUrl(chromePackage.entry || 'index.html');
}

function usesChromePackageProtocol(chromePackage) {
  return chromePackage?.kind === 'local-package' && chromePackage.source === 'store';
}

function response(status, body, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': PACKAGE_CSP,
      ...headers,
    },
  });
}

function jsonResponse(status, code, message) {
  return response(
    status,
    JSON.stringify({ code, message }),
    { 'Content-Type': 'application/json; charset=utf-8' }
  );
}

function rawActivePathname(url) {
  const prefix = `${CHROME_PACKAGE_ACTIVE_ORIGIN}`;
  if (typeof url !== 'string' || !url.toLowerCase().startsWith(prefix)) {
    return null;
  }
  const raw = url.slice(prefix.length);
  const end = raw.search(/[?#]/);
  return end >= 0 ? raw.slice(0, end) : raw;
}

function decodeRequestPath(rawPathname) {
  if (rawPathname === null) {
    return { ok: false, code: 'PACKAGE_URL_INVALID', message: 'Invalid package URL' };
  }
  if (/%2f|%5c/i.test(rawPathname) || rawPathname.includes('\\')) {
    return {
      ok: false,
      code: 'PACKAGE_URL_PATH_INVALID',
      message: 'Package URL path contains an encoded or literal separator',
    };
  }

  let decoded;
  try {
    decoded = decodeURIComponent(rawPathname || '/');
  } catch {
    return {
      ok: false,
      code: 'PACKAGE_URL_ENCODING_INVALID',
      message: 'Package URL path is not valid percent-encoding',
    };
  }

  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return {
      ok: false,
      code: 'PACKAGE_URL_PATH_TRAVERSAL',
      message: 'Package URL path cannot contain dot segments',
    };
  }

  return { ok: true, decoded };
}

function getRequestedPackagePath(url, chromePackage) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: 'PACKAGE_URL_INVALID', message: 'Invalid package URL' };
  }

  if (
    parsed.protocol !== `${CHROME_PACKAGE_SCHEME}:` ||
    parsed.hostname !== CHROME_PACKAGE_ACTIVE_HOST
  ) {
    return {
      ok: false,
      code: 'PACKAGE_URL_SCOPE_INVALID',
      message: 'Package URL is outside the active chrome package scope',
    };
  }

  const rawPath = rawActivePathname(url);
  const decodedResult = decodeRequestPath(rawPath);
  if (!decodedResult.ok) {
    return decodedResult;
  }

  const withoutLeadingSlash = decodedResult.decoded.replace(/^\/+/, '');
  const requestedPath = withoutLeadingSlash || chromePackage.entry || 'index.html';
  const normalizedPath = normalizePackageFilePath(requestedPath);
  if (!normalizedPath) {
    return {
      ok: false,
      code: 'PACKAGE_URL_PATH_INVALID',
      message: 'Package URL path is invalid',
    };
  }

  return { ok: true, path: normalizedPath };
}

function getVerifiedPackageFile(chromePackage, relativePath) {
  if (!usesChromePackageProtocol(chromePackage)) {
    return {
      ok: false,
      code: 'PACKAGE_NOT_ACTIVE',
      message: 'No store-backed active chrome package is available',
    };
  }

  const fileRecord = (chromePackage.files || []).find((file) => file.path === relativePath);
  if (!fileRecord) {
    return {
      ok: false,
      code: 'PACKAGE_FILE_NOT_DECLARED',
      message: 'Package file is not declared in the active package manifest',
    };
  }

  const filePath = path.join(chromePackage.packageRoot, ...relativePath.split('/'));
  let realFilePath;
  try {
    realFilePath = fs.realpathSync(filePath);
  } catch {
    return {
      ok: false,
      code: 'PACKAGE_FILE_MISSING',
      message: 'Package file is missing',
    };
  }

  const realPackageRoot = fs.realpathSync(chromePackage.packageRoot);
  if (realFilePath !== realPackageRoot && !realFilePath.startsWith(`${realPackageRoot}${path.sep}`)) {
    return {
      ok: false,
      code: 'PACKAGE_FILE_OUTSIDE_PACKAGE',
      message: 'Package file resolved outside the active package root',
    };
  }

  if (!fs.statSync(realFilePath).isFile()) {
    return {
      ok: false,
      code: 'PACKAGE_FILE_NOT_FILE',
      message: 'Package file is not a regular file',
    };
  }

  const actualHash = hashFileSha256(realFilePath);
  if (actualHash !== fileRecord.sha256) {
    return {
      ok: false,
      code: 'PACKAGE_FILE_HASH_MISMATCH',
      message: 'Package file hash does not match the active package manifest',
    };
  }

  return { ok: true, filePath: realFilePath };
}

function contentTypeForPath(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function createChromePackageProtocolHandler(options = {}) {
  const getActivePackage = options.getActivePackage || getActiveChromePackage;
  return async function handleChromePackageRequest(request) {
    const chromePackage = getActivePackage();
    const pathResult = getRequestedPackagePath(request.url, chromePackage || {});
    if (!pathResult.ok) {
      return jsonResponse(400, pathResult.code, pathResult.message);
    }

    const fileResult = getVerifiedPackageFile(chromePackage, pathResult.path);
    if (!fileResult.ok) {
      const status = fileResult.code === 'PACKAGE_FILE_HASH_MISMATCH' ? 409 : 404;
      return jsonResponse(status, fileResult.code, fileResult.message);
    }

    return response(
      200,
      fs.readFileSync(fileResult.filePath),
      { 'Content-Type': contentTypeForPath(fileResult.filePath) }
    );
  };
}

function registerChromePackageProtocol(targetSession) {
  if (!targetSession?.protocol?.handle) {
    log.warn('[chrome-package-protocol] session.protocol.handle unavailable; skipping');
    return;
  }
  try {
    targetSession.protocol.handle(CHROME_PACKAGE_SCHEME, createChromePackageProtocolHandler());
    log.info(`[chrome-package-protocol] registered ${CHROME_PACKAGE_SCHEME}: handler`);
  } catch (error) {
    log.error('[chrome-package-protocol] failed to register handler:', error);
  }
}

module.exports = {
  CHROME_PACKAGE_ACTIVE_ORIGIN,
  CHROME_PACKAGE_SCHEME,
  PACKAGE_CSP,
  contentTypeForPath,
  createChromePackageProtocolHandler,
  getChromePackageAssetUrl,
  getChromePackageEntryUrl,
  getRequestedPackagePath,
  getVerifiedPackageFile,
  registerChromePackageProtocol,
  usesChromePackageProtocol,
};
