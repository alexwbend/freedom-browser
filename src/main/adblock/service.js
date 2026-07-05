/**
 * Desktop ad blocking: filter-engine lifecycle plus webRequest
 * interception, registered with the shared dispatcher as the 'adblock'
 * onBeforeRequest handler (between the request rewriter and x402).
 *
 * The engine backend (@ghostery/adblocker) is confined to this module:
 * callers only see install/refresh/cleanup and the classifier helpers,
 * so the engine can be swapped (e.g. for Brave's adblock-rust) without
 * touching the rest of the browser.
 *
 * Filter lists are read from an artifacts directory: a `manifest.json`
 * naming one ABP-syntax list file per category (see the desktop target
 * of freedom-adblock-service). Engine builds happen off the request hot
 * path and are swapped atomically; until the first build completes,
 * requests pass through.
 *
 * Blocking decisions match Freedom iOS: ads + privacy on by default,
 * cookie banners + annoyances opt-in, allowlist bypasses the engine for
 * the tab's whole top-level host rather than layering exception rules.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('../logger');
const { FiltersEngine, Request, ENGINE_VERSION } = require('@ghostery/adblocker');
const ADBLOCKER_VERSION = require('@ghostery/adblocker/package.json').version;
const { registerWebRequestHandler } = require('../webrequest-dispatcher');
const { loadSettings } = require('../settings-store');
const IPC = require('../../shared/ipc-channels');
const {
  getAllowlistedHosts,
  addAllowlistedHost,
  removeAllowlistedHost,
} = require('./allowlist-store');
const {
  mapResourceType,
  isInterceptableUrl,
  isLoopbackHost,
  hostnameFromUrl,
  normalizeHost,
  isHostAllowlisted,
} = require('./request-classifier');

// Category name in manifest.json -> settings key gating it.
const CATEGORY_SETTINGS = [
  ['ads', 'adblockAds'],
  ['privacy', 'adblockPrivacy'],
  ['cookies', 'adblockCookies'],
  ['annoyances', 'adblockAnnoyances'],
];

let artifactsDir = null;
let cacheDir = null;
let engine = null;
let lastManifest = null;
let allowlistedHosts = [];
// webContentsId -> top-level URL, maintained from mainFrame requests so
// subresources get first-party context and allowlist scoping.
const topLevelUrls = new Map();

// Lists live in assets/adblock (fetched by scripts/fetch-adblock-lists.js,
// gitignored); packaged builds ship the whole assets/ dir via extraResources.
// FREEDOM_ADBLOCK_DIR overrides for development and E2E tests.
function getDefaultArtifactsDir() {
  if (process.env.FREEDOM_ADBLOCK_DIR) {
    return process.env.FREEDOM_ADBLOCK_DIR;
  }
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      return path.join(process.resourcesPath, 'assets', 'adblock');
    }
  } catch {
    // Running outside Electron (e.g. Jest).
  }
  return path.join(__dirname, '..', '..', '..', 'assets', 'adblock');
}

function getDefaultCacheDir() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'adblock-cache');
  } catch {
    // Running outside Electron (e.g. Jest) — caching off unless injected.
    return null;
  }
}

async function readManifest() {
  try {
    const raw = await fs.promises.readFile(path.join(artifactsDir, 'manifest.json'), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    log.info(`[adblock] no filter-list artifacts at ${artifactsDir}: ${err.message}`);
    return null;
  }
}

async function readEnabledListsText(settings, manifest) {
  const texts = [];
  for (const [category, settingKey] of CATEGORY_SETTINGS) {
    const entry = manifest.categories?.[category];
    if (!entry || settings[settingKey] !== true) continue;
    try {
      texts.push(await fs.promises.readFile(path.join(artifactsDir, entry.file), 'utf-8'));
    } catch (err) {
      // A bad list disables that category, never the whole feature.
      log.warn(`[adblock] skipping unreadable list '${category}': ${err.message}`);
    }
  }
  return texts.length > 0 ? texts.join('\n') : null;
}

// The serialized-engine format is version-locked, so the cache key covers
// the exact library + format versions, the list bundle version, and which
// categories were compiled in. Any mismatch is simply a different filename,
// so stale caches are never read — and pruned on the next write.
function cacheFileFor(manifest, categoriesKey) {
  const key = crypto
    .createHash('sha256')
    .update(`${ADBLOCKER_VERSION}|${ENGINE_VERSION}|${manifest.version}|${categoriesKey}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(cacheDir, `engine-${key}.bin`);
}

async function readEngineCache(cacheFile) {
  try {
    const buf = await fs.promises.readFile(cacheFile);
    return FiltersEngine.deserialize(buf);
  } catch {
    return null; // Missing or unreadable cache is just a rebuild.
  }
}

async function writeEngineCache(cacheFile, builtEngine) {
  try {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    // Prune caches from other engine/list/category combinations.
    for (const entry of await fs.promises.readdir(cacheDir)) {
      if (entry.startsWith('engine-') && entry !== path.basename(cacheFile)) {
        await fs.promises.unlink(path.join(cacheDir, entry)).catch(() => {});
      }
    }
    const tmpFile = `${cacheFile}.tmp`;
    await fs.promises.writeFile(tmpFile, builtEngine.serialize());
    await fs.promises.rename(tmpFile, cacheFile);
  } catch (err) {
    log.warn(`[adblock] failed to write engine cache: ${err.message}`);
  }
}

/**
 * (Re)build the engine from the artifacts on disk for the current
 * settings, then swap it in. Called at install, by settings-store when
 * an adblock setting changes, and after a list update lands (WP5 Swarm
 * channel). Prefers a serialized-engine cache (milliseconds) over
 * parsing raw list text (hundreds of milliseconds of main-thread CPU).
 */
async function refreshEngine() {
  // Not installed yet (e.g. a settings save before bootstrap wires us up).
  if (!artifactsDir) return;

  const settings = loadSettings();
  const manifest = await readManifest();
  lastManifest = manifest;
  if (!manifest) {
    engine = null;
    return;
  }

  const categoriesKey = CATEGORY_SETTINGS.filter(([, key]) => settings[key] === true)
    .map(([category]) => category)
    .join(',');
  const cacheFile = cacheDir ? cacheFileFor(manifest, categoriesKey) : null;

  if (cacheFile) {
    const cached = await readEngineCache(cacheFile);
    if (cached) {
      engine = cached;
      log.info('[adblock] filter engine ready (cache)');
      return;
    }
  }

  const text = await readEnabledListsText(settings, manifest);
  if (text === null) {
    engine = null;
    return;
  }
  // Network filtering only for now; cosmetic filtering arrives with the
  // preload-injection milestone.
  engine = FiltersEngine.parse(text, { loadCosmeticFilters: false });
  log.info(`[adblock] filter engine ready (${manifest.version}, categories: ${categoriesKey})`);
  if (cacheFile) {
    await writeEngineCache(cacheFile, engine);
  }
}

/**
 * Pure dispatcher handler — returns `{cancel}` / `{redirectURL}` or
 * `null` to pass through. Runs on the request hot path: no I/O, no
 * awaits.
 */
function adblockRequestForDispatch(details) {
  const { url, resourceType, webContentsId } = details;

  // Record top-level context even while disabled so toggling adblock on
  // mid-session has correct first-party state. Top-level navigation is
  // never cancelled — network lists target subresources, and a broken
  // list must not be able to brick navigation.
  if (resourceType === 'mainFrame') {
    if (typeof webContentsId === 'number') {
      topLevelUrls.set(webContentsId, url);
    }
    return null;
  }

  if (!engine || loadSettings().adblockEnabled === false) return null;
  if (!isInterceptableUrl(url)) return null;

  // Each URL is parsed exactly once; the hostnames are handed to the
  // engine so it skips its own URL parse.
  const hostname = hostnameFromUrl(url);
  if (!hostname || isLoopbackHost(hostname)) return null;

  const sourceUrl = topLevelUrls.get(webContentsId) || details.referrer || '';
  const sourceHostname = hostnameFromUrl(sourceUrl) || '';
  if (
    allowlistedHosts.length > 0 &&
    isHostAllowlisted(normalizeHost(sourceHostname), allowlistedHosts)
  ) {
    return null;
  }

  const result = engine.match(
    Request.fromRawDetails({
      url,
      hostname,
      sourceUrl,
      sourceHostname,
      type: mapResourceType(resourceType),
    })
  );
  if (result.redirect?.dataUrl) return { redirectURL: result.redirect.dataUrl };
  if (result.match) return { cancel: true };
  return null;
}

/**
 * Register the adblock handler. Must run before
 * `attachWebRequestDispatcher()`. The initial engine build is kicked off
 * in the background; blocking starts once it completes.
 */
function installAdblockInterception(options = {}) {
  artifactsDir = options.artifactsDir || getDefaultArtifactsDir();
  cacheDir = options.cacheDir !== undefined ? options.cacheDir : getDefaultCacheDir();
  setAllowlistedHosts(getAllowlistedHosts());
  registerWebRequestHandler('onBeforeRequest', 'adblock', adblockRequestForDispatch);
  refreshEngine().catch((err) => {
    log.error(`[adblock] initial engine build failed: ${err.message}`);
  });
}

/**
 * Replace the set of allowlisted hosts. Called at install with the
 * persisted allowlist and by allowlist-store after each mutation.
 * Entries are normalized here, once, so the hot path only compares.
 */
function setAllowlistedHosts(hosts) {
  allowlistedHosts = Array.isArray(hosts) ? hosts.map(normalizeHost).filter(Boolean) : [];
}

function cleanupAdblockWebContents(webContentsId) {
  topLevelUrls.delete(webContentsId);
}

/**
 * Whether a filter engine is loaded and blocking is live. Consumed by the
 * E2E readiness poll and the settings-page status.
 */
function isEngineReady() {
  return engine !== null;
}

/** Status snapshot for the settings page. */
function getAdblockStatus() {
  const categories = {};
  for (const [category, meta] of Object.entries(lastManifest?.categories || {})) {
    categories[category] = { title: meta.title, ruleCount: meta.ruleCount };
  }
  return {
    engineReady: isEngineReady(),
    listsVersion: lastManifest?.version || null,
    categories,
  };
}

/** Register the settings-page IPC surface. */
function registerAdblockIpc() {
  const { ipcMain } = require('electron');
  ipcMain.handle(IPC.ADBLOCK_GET_STATUS, () => getAdblockStatus());
  ipcMain.handle(IPC.ADBLOCK_GET_ALLOWLIST, () => getAllowlistedHosts());
  ipcMain.handle(IPC.ADBLOCK_ADD_ALLOWLIST_HOST, (_event, host) => addAllowlistedHost(host));
  ipcMain.handle(IPC.ADBLOCK_REMOVE_ALLOWLIST_HOST, (_event, host) => removeAllowlistedHost(host));
}

/** Test-only: clear module state between suites. */
function _resetAdblockForTests() {
  artifactsDir = null;
  cacheDir = null;
  engine = null;
  lastManifest = null;
  allowlistedHosts = [];
  topLevelUrls.clear();
}

module.exports = {
  installAdblockInterception,
  registerAdblockIpc,
  adblockRequestForDispatch,
  refreshEngine,
  setAllowlistedHosts,
  cleanupAdblockWebContents,
  isEngineReady,
  _resetAdblockForTests,
};
