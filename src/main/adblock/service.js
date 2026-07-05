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
const log = require('../logger');
const { FiltersEngine, Request } = require('@ghostery/adblocker');
const { registerWebRequestHandler } = require('../webrequest-dispatcher');
const { loadSettings } = require('../settings-store');
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
let engine = null;
let allowlistedHosts = [];
// webContentsId -> top-level URL, maintained from mainFrame requests so
// subresources get first-party context and allowlist scoping.
const topLevelUrls = new Map();

function getDefaultArtifactsDir() {
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      return path.join(process.resourcesPath, 'adblock');
    }
  } catch {
    // Running outside Electron (e.g. Jest).
  }
  return path.join(__dirname, '..', '..', '..', 'assets', 'adblock');
}

async function readEnabledListsText(settings) {
  let manifest;
  try {
    const raw = await fs.promises.readFile(path.join(artifactsDir, 'manifest.json'), 'utf-8');
    manifest = JSON.parse(raw);
  } catch (err) {
    log.info(`[adblock] no filter-list artifacts at ${artifactsDir}: ${err.message}`);
    return null;
  }

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

/**
 * (Re)build the engine from the artifacts on disk for the current
 * settings, then swap it in. Called at install, by settings-store when
 * an adblock setting changes, and after a list update lands (WP5 Swarm
 * channel).
 */
async function refreshEngine() {
  // Not installed yet (e.g. a settings save before bootstrap wires us up).
  if (!artifactsDir) return;
  const text = await readEnabledListsText(loadSettings());
  if (text === null) {
    engine = null;
    return;
  }
  // Network filtering only for now; cosmetic filtering arrives with the
  // preload-injection milestone.
  engine = FiltersEngine.parse(text, { loadCosmeticFilters: false });
  log.info('[adblock] filter engine ready');
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
  registerWebRequestHandler('onBeforeRequest', 'adblock', adblockRequestForDispatch);
  refreshEngine().catch((err) => {
    log.error(`[adblock] initial engine build failed: ${err.message}`);
  });
}

/**
 * Replace the set of allowlisted hosts (persistence lands with WP2).
 * Entries are normalized here, once, so the hot path only compares.
 */
function setAllowlistedHosts(hosts) {
  allowlistedHosts = Array.isArray(hosts) ? hosts.map(normalizeHost).filter(Boolean) : [];
}

function cleanupAdblockWebContents(webContentsId) {
  topLevelUrls.delete(webContentsId);
}

/** Test-only: clear module state between suites. */
function _resetAdblockForTests() {
  artifactsDir = null;
  engine = null;
  allowlistedHosts = [];
  topLevelUrls.clear();
}

module.exports = {
  installAdblockInterception,
  adblockRequestForDispatch,
  refreshEngine,
  setAllowlistedHosts,
  cleanupAdblockWebContents,
  _resetAdblockForTests,
};
