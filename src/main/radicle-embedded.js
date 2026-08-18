/**
 * Embedded Radicle node — napi addon wrapper (no radicle-httpd, no
 * spawned radicle-node; the node runs in-process on a background thread).
 *
 * The addon is `libradicle.node`, built from the libradicle repo
 * (rad:z2SzCC9zYnP17QRPZUhrP2RTEwZHj). Load order:
 *   1. FREEDOM_RADICLE_ADDON env override (absolute path)
 *   2. radicle-bin/<platform>/libradicle.node (prebuilt, like myotis-bin)
 *   3. ../libradicle/target/{release,debug}/libradicle.node (dev sibling)
 *
 * Every addon export resolves to a JSON string; this module parses them
 * and throws on `{error}` payloads so callers deal in plain objects.
 */

const log = require('./logger');
const path = require('path');
const fs = require('fs');

let addon = null;
let addonPath = null;
let started = false;

function platformKey() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'darwin') return `mac-${arch}`;
  if (process.platform === 'win32') return `win-${arch}`;
  return `linux-${arch}`;
}

function candidatePaths() {
  const candidates = [];
  if (process.env.FREEDOM_RADICLE_ADDON) {
    candidates.push(process.env.FREEDOM_RADICLE_ADDON);
  }
  candidates.push(
    path.join(__dirname, '..', '..', 'radicle-bin', platformKey(), 'libradicle.node')
  );
  for (const profile of ['release', 'debug']) {
    candidates.push(
      path.join(__dirname, '..', '..', '..', 'libradicle', 'target', profile, 'libradicle.node')
    );
  }
  return candidates;
}

/**
 * Load the addon if present. Returns null (and logs once) when no binary
 * is found — callers fall back to the legacy binary-spawning path.
 */
function loadAddon() {
  if (addon) return addon;
  for (const candidate of candidatePaths()) {
    if (fs.existsSync(candidate)) {
      try {
        addon = require(candidate);
        addonPath = candidate;
        log.info('[RadicleEmbedded] Loaded addon from', candidate);
        return addon;
      } catch (err) {
        log.warn('[RadicleEmbedded] Failed to load addon at', candidate, err.message);
      }
    }
  }
  return null;
}

function isAvailable() {
  return loadAddon() !== null;
}

function getAddonPath() {
  loadAddon();
  return addonPath;
}

async function call(name, ...args) {
  const a = loadAddon();
  if (!a) throw new Error('radicle addon not available');
  const raw = await a[name](...args);
  const value = JSON.parse(raw);
  if (value && value.error) {
    throw new Error(value.error);
  }
  return value;
}

/**
 * Start the embedded node. Resolves to `{ did }`.
 * @param {string} home - Radicle home directory (keys, storage, node dbs)
 * @param {string} alias - Alias used when initializing a fresh profile
 */
async function start(home, alias) {
  const result = await call('start', home, alias);
  started = true;
  return result;
}

async function shutdown() {
  if (!started) return { ok: true };
  started = false;
  return call('shutdown');
}

function isStarted() {
  return started;
}

const connectSeeds = (timeoutMs = 15000) => call('connectSeeds', timeoutMs);
const cloneRepo = (rid, timeoutMs = 120000) => call('cloneRepo', rid, timeoutMs);
const repoInfo = (rid) => call('repoInfo', rid);
const tree = (rid, treePath = '') => call('tree', rid, treePath);
const blob = (rid, blobPath) => call('blob', rid, blobPath);
const status = () => call('status');
const seeders = (rid) => call('seeders', rid);

/**
 * Repo metadata shaped like radicle-httpd's `GET /api/v1/repos/:rid`,
 * covering the fields pages/scripts/rad-browser.js consumes.
 */
async function buildRepoMeta(rid) {
  const info = await repoInfo(rid);
  let seeding = 0;
  try {
    seeding = (await seeders(rid)).seeding;
  } catch (err) {
    log.warn('[RadicleEmbedded] seeders() failed:', err.message);
  }
  return {
    rid: info.rid,
    payloads: {
      'xyz.radicle.project': {
        data: {
          name: info.name,
          description: info.description,
          defaultBranch: info.defaultBranch,
        },
        meta: {
          head: info.head,
          issues: { open: info.issuesOpen },
          patches: { open: info.patchesOpen },
        },
      },
    },
    visibility: { type: 'public' },
    seeding,
  };
}

const README_CANDIDATES = [
  'README.md',
  'README.markdown',
  'README.txt',
  'README',
  'readme.md',
];

/**
 * First readme blob found at the repository root, or null.
 * Shaped like a blob response: `{ binary, content, name, path }`.
 */
async function readme(rid) {
  const { entries } = await tree(rid, '');
  const names = new Set(entries.filter((e) => e.kind === 'blob').map((e) => e.name));
  for (const candidate of README_CANDIDATES) {
    if (names.has(candidate)) {
      const result = await blob(rid, candidate);
      return { ...result, path: candidate };
    }
  }
  return null;
}

module.exports = {
  isAvailable,
  getAddonPath,
  start,
  shutdown,
  isStarted,
  connectSeeds,
  cloneRepo,
  repoInfo,
  tree,
  blob,
  status,
  seeders,
  buildRepoMeta,
  readme,
};
