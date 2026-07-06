const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Wallet } = require('ethers');

jest.mock('../settings-store', () => ({ loadSettings: jest.fn() }));
jest.mock('./service', () => ({
  refreshEngine: jest.fn(() => Promise.resolve()),
  getEnabledCategories: jest.fn(() => ['ads', 'privacy']),
}));

const { loadSettings } = require('../settings-store');
const { getEnabledCategories } = require('./service');
const { canonicalManifestForSigning } = require('./update-manifest');
const { runUpdateOnce } = require('./update-manager');

const SIGNER = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const ADS = Buffer.from('||ads.example^\n');
const PRIV = Buffer.from('||track.example^\n');

function manifest(version = 1) {
  return {
    schema: 1,
    version,
    generated_at: '2026-07-06T03:00:00Z',
    engines: { adblock_rs: '0.12.3' },
    platforms: {
      desktop: {
        lists: [
          {
            category: 'ads',
            list_id: 'easylist',
            title: 'EasyList',
            source_url: 'u',
            license: 'l',
            ref: 'ref-ads',
            sha256: sha256(ADS),
            bytes: ADS.length,
            rule_count: 1,
          },
          {
            category: 'privacy',
            list_id: 'easyprivacy',
            title: 'EasyPrivacy',
            source_url: 'u',
            license: 'l',
            ref: 'ref-priv',
            sha256: sha256(PRIV),
            bytes: PRIV.length,
            rule_count: 1,
          },
        ],
      },
      ios: { lists: [] },
    },
  };
}

async function signedManifest(version) {
  const m = manifest(version);
  m.sig = await SIGNER.signMessage(canonicalManifestForSigning(m));
  return m;
}

const blobFor = (ref) => (ref === 'ref-ads' ? ADS : ref === 'ref-priv' ? PRIV : Buffer.from('x'));

let root;
function io(overrides = {}) {
  return {
    root,
    trustConfigured: true,
    sigAddress: SIGNER.address,
    downloadBlob: jest.fn(async (ref) => blobFor(ref)),
    activate: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

beforeEach(() => {
  loadSettings.mockReturnValue({ adblockEnabled: true });
  getEnabledCategories.mockReturnValue(['ads', 'privacy']);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'adblock-update-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('runUpdateOnce', () => {
  test('applies a valid update: writes lists + browser manifest, activates', async () => {
    const opts = io({ readFeed: async () => signedManifest(3) });
    const result = await runUpdateOnce(opts);
    expect(result).toEqual({ status: 'applied', version: 3 });

    const updated = path.join(root, 'updated');
    expect(fs.readFileSync(path.join(updated, 'easylist.txt'))).toEqual(ADS);
    expect(fs.readFileSync(path.join(updated, 'easyprivacy.txt'))).toEqual(PRIV);
    const local = JSON.parse(fs.readFileSync(path.join(updated, 'manifest.json'), 'utf-8'));
    expect(local.feedVersion).toBe(3);
    expect(local.categories.ads.file).toBe('easylist.txt');
    expect(local.categories.ads.ruleCount).toBe(1);
    expect(opts.activate).toHaveBeenCalledTimes(1);
  });

  test('only downloads enabled categories', async () => {
    getEnabledCategories.mockReturnValue(['ads']);
    const opts = io({ readFeed: async () => signedManifest(1) });
    await runUpdateOnce(opts);
    expect(opts.downloadBlob).toHaveBeenCalledTimes(1);
    expect(opts.downloadBlob).toHaveBeenCalledWith('ref-ads');
    expect(fs.existsSync(path.join(root, 'updated', 'easyprivacy.txt'))).toBe(false);
  });

  test('rejects an unsigned/invalid manifest without touching disk', async () => {
    const m = manifest(2); // no sig
    const result = await runUpdateOnce(io({ readFeed: async () => m }));
    expect(result.status).toBe('rejected');
    expect(fs.existsSync(path.join(root, 'updated'))).toBe(false);
  });

  test('rejects a downgrade (version <= applied)', async () => {
    // Seed an applied version of 5.
    fs.mkdirSync(path.join(root, 'updated'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'updated', 'manifest.json'),
      JSON.stringify({ feedVersion: 5, categories: {} })
    );
    const result = await runUpdateOnce(io({ readFeed: async () => signedManifest(4) }));
    expect(result).toEqual({ status: 'rejected', reason: 'not_newer' });
  });

  test('aborts on a blob whose hash does not match, leaving prior state', async () => {
    const opts = io({
      readFeed: async () => signedManifest(2),
      downloadBlob: async () => Buffer.from('tampered'),
    });
    const result = await runUpdateOnce(opts);
    expect(result.status).toBe('hash_mismatch');
    expect(fs.existsSync(path.join(root, 'updated'))).toBe(false);
    expect(opts.activate).not.toHaveBeenCalled();
  });

  test('rolls back to last-known-good when the engine rebuild fails', async () => {
    // First: a good apply at version 2.
    await runUpdateOnce(io({ readFeed: async () => signedManifest(2) }));
    const goodManifest = fs.readFileSync(path.join(root, 'updated', 'manifest.json'), 'utf-8');

    // Second: version 3 downloads fine but activation throws — must roll back.
    const failing = io({
      readFeed: async () => signedManifest(3),
      activate: jest.fn(() => Promise.reject(new Error('bad engine'))),
    });
    const result = await runUpdateOnce(failing);
    expect(result.status).toBe('activate_failed');
    // Rolled back to the version-2 manifest.
    expect(fs.readFileSync(path.join(root, 'updated', 'manifest.json'), 'utf-8')).toBe(
      goodManifest
    );
  });

  test('is dormant when the trust anchor is unconfigured', async () => {
    const result = await runUpdateOnce(
      io({ trustConfigured: false, readFeed: async () => signedManifest(1) })
    );
    expect(result).toEqual({ status: 'dormant' });
  });

  test('skips when adblock is disabled', async () => {
    loadSettings.mockReturnValue({ adblockEnabled: false });
    const result = await runUpdateOnce(io({ readFeed: async () => signedManifest(1) }));
    expect(result).toEqual({ status: 'disabled' });
  });
});
