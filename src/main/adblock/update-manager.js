/**
 * Swarm filter-list update manager (WP5 5.B2).
 *
 * One update cycle: read the signed manifest from the trust-anchored feed,
 * verify it, download the enabled categories' lists whose hashes changed,
 * verify each blob, write them + a browser-shaped manifest atomically to
 * userData/adblock/updated/, then rebuild the engine. On any failure the
 * previous updated dir (and the bundled floor beneath it) is left intact —
 * the browser never regresses on a bad update.
 *
 * The feed read and blob download are injected so the apply pipeline is
 * testable without a live node; the defaults use the browser's Swarm layer.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const log = require('../logger');
const { loadSettings } = require('../settings-store');
const {
  FEED_OWNER_ADDRESS,
  MANIFEST_SIG_ADDRESS,
  FEED_TOPIC,
  isTrustAnchorConfigured,
} = require('./feed-config');
const { verifyManifest, desktopListsFor } = require('./update-manifest');
const { refreshEngine, getEnabledCategories } = require('./service');

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ── Default Swarm-backed IO (replaced in tests) ──────────────────────────
async function defaultReadFeed() {
  const { Topic } = require('@ethersphere/bee-js');
  const { readFeedPayload } = require('../swarm/feed-service');
  const { payload } = await readFeedPayload(FEED_OWNER_ADDRESS, Topic.fromString(FEED_TOPIC));
  return JSON.parse(payload.toString('utf-8'));
}

async function defaultDownloadBlob(ref) {
  const { getBee } = require('../swarm/swarm-service');
  const data = await getBee().downloadData(ref);
  return Buffer.from(data.toUint8Array());
}

function getUpdateRoot() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'adblock');
}

// The feed version already applied on disk, or 0 if none.
function readAppliedVersion(updatedDir) {
  try {
    const raw = fs.readFileSync(path.join(updatedDir, 'manifest.json'), 'utf-8');
    const v = JSON.parse(raw).feedVersion;
    return Number.isInteger(v) ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Run one update cycle.
 *
 * @param {object} [io]
 * @param {() => Promise<object|null>} [io.readFeed]
 * @param {(ref: string) => Promise<Buffer>} [io.downloadBlob]
 * @param {string} [io.root] - override userData/adblock (tests)
 * @param {() => Promise<void>} [io.activate] - override refreshEngine (tests)
 * @returns {Promise<{status: string, version?: number, reason?: string}>}
 */
async function runUpdateOnce(io = {}) {
  const readFeed = io.readFeed || defaultReadFeed;
  const downloadBlob = io.downloadBlob || defaultDownloadBlob;
  const activate = io.activate || refreshEngine;
  const root = io.root || getUpdateRoot();
  const sigAddress = io.sigAddress || MANIFEST_SIG_ADDRESS;
  const trustConfigured = io.trustConfigured ?? isTrustAnchorConfigured();

  if (!trustConfigured) return { status: 'dormant' };
  if (loadSettings().adblockEnabled === false) return { status: 'disabled' };

  const updatedDir = path.join(root, 'updated');
  const appliedVersion = readAppliedVersion(updatedDir);

  let manifest;
  try {
    manifest = await readFeed();
  } catch (err) {
    log.info(`[adblock-update] feed read failed: ${err.message}`);
    return { status: 'feed_unavailable' };
  }
  if (!manifest) return { status: 'feed_empty' };

  const verdict = verifyManifest(manifest, { sigAddress, appliedVersion });
  if (!verdict.ok) {
    log.info(`[adblock-update] rejected manifest: ${verdict.reason}`);
    return { status: 'rejected', reason: verdict.reason };
  }

  const entries = desktopListsFor(manifest, getEnabledCategories());
  if (entries.length === 0) return { status: 'no_enabled_lists' };

  const stageDir = path.join(root, 'updated.next');

  // Download + verify every enabled list before touching disk.
  const files = [];
  for (const entry of entries) {
    // Belt-and-braces alongside verifyManifest's list_id schema check: the
    // resolved output path must stay a direct child of the staging dir, so
    // even a hostile list_id can never write outside it.
    const file = `${entry.list_id}.txt`;
    const dest = path.resolve(stageDir, file);
    if (path.dirname(dest) !== path.resolve(stageDir) || path.basename(dest) !== file) {
      log.warn(`[adblock-update] unsafe list_id ${JSON.stringify(entry.list_id)} — aborting`);
      return { status: 'rejected', reason: 'unsafe_list_id' };
    }
    let blob;
    try {
      blob = await downloadBlob(entry.ref);
    } catch (err) {
      log.warn(`[adblock-update] download failed for ${entry.category}: ${err.message}`);
      return { status: 'download_failed', reason: entry.category };
    }
    if (sha256Hex(blob) !== entry.sha256) {
      log.warn(`[adblock-update] sha256 mismatch for ${entry.category} — aborting`);
      return { status: 'hash_mismatch', reason: entry.category };
    }
    files.push({ entry, blob, file });
  }

  // Stage, then promote atomically. Keep the prior updated dir as last-known-good.
  const prevDir = path.join(root, 'updated.prev');
  await fs.promises.rm(stageDir, { recursive: true, force: true });
  await fs.promises.mkdir(stageDir, { recursive: true });

  const categories = {};
  for (const { entry, blob, file } of files) {
    await fs.promises.writeFile(path.join(stageDir, file), blob);
    categories[entry.category] = {
      file,
      title: entry.title,
      sourceUrl: entry.source_url,
      license: entry.license,
      sha256: entry.sha256,
      bytes: entry.bytes,
      ruleCount: entry.rule_count,
    };
  }
  // Browser-shaped manifest (what service.js reads) + the feed version for the
  // next applied-version check.
  await fs.promises.writeFile(
    path.join(stageDir, 'manifest.json'),
    JSON.stringify(
      { version: manifest.generated_at, feedVersion: manifest.version, categories },
      null,
      2
    )
  );

  // Promote: current → prev, next → current.
  await fs.promises.rm(prevDir, { recursive: true, force: true });
  if (fs.existsSync(updatedDir)) await fs.promises.rename(updatedDir, prevDir);
  await fs.promises.rename(stageDir, updatedDir);

  try {
    await activate();
  } catch (err) {
    // Roll back to last-known-good and rebuild from it.
    log.error(`[adblock-update] engine rebuild failed, rolling back: ${err.message}`);
    await fs.promises.rm(updatedDir, { recursive: true, force: true });
    if (fs.existsSync(prevDir)) await fs.promises.rename(prevDir, updatedDir);
    await activate().catch(() => {});
    return { status: 'activate_failed', reason: err.message };
  }

  await fs.promises.rm(prevDir, { recursive: true, force: true });
  log.info(`[adblock-update] applied version ${manifest.version} (${entries.length} lists)`);
  return { status: 'applied', version: manifest.version };
}

module.exports = { runUpdateOnce };
