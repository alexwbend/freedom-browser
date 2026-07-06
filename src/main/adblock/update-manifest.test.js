const { Wallet } = require('ethers');
const {
  canonicalManifestForSigning,
  verifyManifest,
  desktopListsFor,
} = require('./update-manifest');

// A deterministic throwaway signer (never used outside tests).
const SIGNER = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

function baseManifest(overrides = {}) {
  return {
    schema: 1,
    version: 5,
    generated_at: '2026-07-06T03:00:00Z',
    engines: { adblock_rs: '0.12.3' },
    platforms: {
      desktop: {
        lists: [
          {
            category: 'ads',
            list_id: 'easylist',
            ref: 'aa',
            sha256: '11',
            bytes: 10,
            rule_count: 3,
          },
          {
            category: 'privacy',
            list_id: 'easyprivacy',
            ref: 'bb',
            sha256: '22',
            bytes: 20,
            rule_count: 4,
          },
        ],
      },
      ios: { lists: [] },
    },
    ...overrides,
  };
}

async function signed(manifest, signer = SIGNER) {
  const sig = await signer.signMessage(canonicalManifestForSigning(manifest));
  return { ...manifest, sig };
}

describe('canonicalManifestForSigning', () => {
  test('strips sig, sorts keys recursively, compact', () => {
    const out = canonicalManifestForSigning({
      version: 2,
      schema: 1,
      sig: '0xdead',
      engines: { b: '1', a: '2' },
    });
    expect(out).toBe('{"engines":{"a":"2","b":"1"},"schema":1,"version":2}');
  });

  test('is independent of the sig field value', () => {
    const m = baseManifest();
    expect(canonicalManifestForSigning({ ...m, sig: '0xaaa' })).toBe(
      canonicalManifestForSigning({ ...m, sig: '0xbbb' })
    );
  });
});

describe('verifyManifest', () => {
  const opts = () => ({ sigAddress: SIGNER.address, appliedVersion: 0 });

  test('accepts a well-formed, correctly-signed, newer manifest', async () => {
    const result = verifyManifest(await signed(baseManifest()), opts());
    expect(result).toEqual({ ok: true, version: 5 });
  });

  test('rejects a manifest tampered after signing (sig no longer matches)', async () => {
    const m = await signed(baseManifest());
    m.platforms.desktop.lists[0].sha256 = 'deadbeef'; // flip a hash post-signature
    expect(verifyManifest(m, opts())).toEqual({ ok: false, reason: 'wrong_signer' });
  });

  test('rejects a signature from the wrong key', async () => {
    const other = Wallet.createRandom();
    expect(verifyManifest(await signed(baseManifest(), other), opts())).toEqual({
      ok: false,
      reason: 'wrong_signer',
    });
  });

  test('rejects a downgrade or replay of the applied version', async () => {
    const m = await signed(baseManifest({ version: 5 }));
    expect(verifyManifest(m, { sigAddress: SIGNER.address, appliedVersion: 5 })).toEqual({
      ok: false,
      reason: 'not_newer',
      version: 5,
    });
    expect(verifyManifest(m, { sigAddress: SIGNER.address, appliedVersion: 9 }).reason).toBe(
      'not_newer'
    );
  });

  test('rejects a schema mismatch', async () => {
    expect(verifyManifest(await signed(baseManifest({ schema: 2 })), opts())).toEqual({
      ok: false,
      reason: 'schema_mismatch',
    });
  });

  test('rejects a missing or empty signature', () => {
    expect(verifyManifest(baseManifest(), opts())).toEqual({ ok: false, reason: 'missing_sig' });
  });

  test('rejects structural problems', () => {
    expect(verifyManifest(null, opts()).reason).toBe('not_an_object');
    expect(verifyManifest(baseManifest({ version: 0 }), opts()).reason).toBe('bad_version');
    expect(verifyManifest(baseManifest({ version: 1.5 }), opts()).reason).toBe('bad_version');
    expect(
      verifyManifest(baseManifest({ platforms: { desktop: {}, ios: { lists: [] } } }), opts())
        .reason
    ).toBe('bad_desktop_section');
  });
});

describe('desktopListsFor', () => {
  test('returns entries for enabled categories only, preserving order', () => {
    const m = baseManifest();
    expect(desktopListsFor(m, ['ads']).map((e) => e.category)).toEqual(['ads']);
    expect(desktopListsFor(m, ['ads', 'privacy']).map((e) => e.category)).toEqual([
      'ads',
      'privacy',
    ]);
    expect(desktopListsFor(m, new Set(['cookies'])).length).toBe(0);
  });
});
