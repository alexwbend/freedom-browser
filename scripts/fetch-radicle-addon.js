/**
 * Download the prebuilt libradicle napi addon from the GitHub release and
 * install it as radicle-bin/<platform>/libradicle.node, where
 * radicle-embedded.js looks for it.
 *
 * Usage:
 *   npm run radicle:download
 *   npm run radicle:download -- --win --x64
 *   npm run radicle:download -- --win --arm64
 *
 * Source repo: solardev-xyz/libradicle (canonical Radicle home:
 * rad:z2SzCC9zYnP17QRPZUhrP2RTEwZHj). To build from source instead, use
 * `npm run radicle:build-addon` with a sibling libradicle checkout.
 */

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { RADICLE_ADDON_RELEASE_TAG } = require('../src/shared/radicle-addon-version');

const RELEASE_BASE = `https://github.com/solardev-xyz/libradicle/releases/download/${RADICLE_ADDON_RELEASE_TAG}`;

function platformKey(
  args = process.argv.slice(2),
  hostPlatform = process.platform,
  hostArch = process.arch
) {
  const requestedPlatforms = ['mac', 'linux', 'win'].filter((name) => args.includes(`--${name}`));
  const requestedArchs = ['arm64', 'x64'].filter((arch) => args.includes(`--${arch}`));

  if (requestedPlatforms.length > 1) {
    throw new Error('specify at most one target platform: --mac, --linux, or --win');
  }
  if (requestedArchs.length > 1) {
    throw new Error('specify at most one target architecture: --arm64 or --x64');
  }

  const hostOs = hostPlatform === 'darwin' ? 'mac' : hostPlatform === 'win32' ? 'win' : 'linux';
  const os = requestedPlatforms[0] || hostOs;
  const hostTargetArch = hostArch === 'arm64' ? 'arm64' : 'x64';
  const arch =
    requestedArchs[0] || (requestedPlatforms.length && os === 'win' ? 'x64' : hostTargetArch);

  return `${os}-${arch}`;
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
  const assetName = `libradicle-${key}.node`;

  console.log(`Downloading ${assetName} (${RADICLE_ADDON_RELEASE_TAG})…`);
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
  if (!key.startsWith('win-')) fs.chmodSync(dest, 0o755);
  console.log(`Installed ${dest} (${(binary.length / 1e6).toFixed(1)} MB, sha256 verified)`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { platformKey, fetchBuffer, main };
