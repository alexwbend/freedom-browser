/**
 * Download the prebuilt libradicle napi addon from the GitHub release and
 * install it as radicle-bin/<platform>/libradicle.node, where
 * radicle-embedded.js looks for it.
 *
 * Usage: npm run radicle:download
 *
 * Source repo: solardev-xyz/libradicle (canonical Radicle home:
 * rad:z2SzCC9zYnP17QRPZUhrP2RTEwZHj). To build from source instead, use
 * `npm run radicle:build-addon` with a sibling libradicle checkout.
 */

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const ADDON_VERSION = 'v0.1.0';
const RELEASE_BASE = `https://github.com/solardev-xyz/libradicle/releases/download/${ADDON_VERSION}`;

function platformKey() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'darwin') return `mac-${arch}`;
  if (process.platform === 'win32') return `win-${arch}`;
  return `linux-${arch}`;
}

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          return fetchBuffer(res.headers.location, redirects + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  const key = platformKey();
  if (key.startsWith('win-')) {
    console.error('No Windows addon build yet — use radicleEmbedded: false (legacy path).');
    process.exit(1);
  }
  const assetName = `libradicle-${key}.node`;

  console.log(`Downloading ${assetName} (${ADDON_VERSION})…`);
  const [binary, sums] = await Promise.all([
    fetchBuffer(`${RELEASE_BASE}/${assetName}`),
    fetchBuffer(`${RELEASE_BASE}/SHA256SUMS`),
  ]);

  const expected = sums
    .toString('utf8')
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .find(([, name]) => name === assetName)?.[0];
  if (!expected) {
    throw new Error(`${assetName} not listed in SHA256SUMS`);
  }
  const actual = crypto.createHash('sha256').update(binary).digest('hex');
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${assetName}: ${actual} != ${expected}`);
  }

  const destDir = path.join(__dirname, '..', 'radicle-bin', key);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'libradicle.node');
  fs.writeFileSync(dest, binary);
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  console.log(`Installed ${dest} (${(binary.length / 1e6).toFixed(1)} MB, sha256 verified)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
