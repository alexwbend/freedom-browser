const {
  parseEnsNavigationInput,
  resolveEnsContenthashNavigation,
  resolveNavigationInput,
} = require('./navigation-input');

const SWARM_HASH = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const IPFS_CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const IPNS_KEY = 'k51qzi5uqu5dgkkr5wjh0m796f9u3tou74wn2q2u3shgh6yn52ce4hitig3if4';
const RADICLE_ID = 'z3gqcJUoA1n9HaHKufZs5FCSGazv5';

describe('navigation-input', () => {
  test('normalizes bare domains to https URLs', () => {
    expect(resolveNavigationInput('example.com')).toEqual({
      ok: true,
      input: 'example.com',
      kind: 'https',
      targetUrl: 'https://example.com',
      displayValue: 'https://example.com',
    });
  });

  test('preserves explicit http and https URLs', () => {
    expect(resolveNavigationInput('http://example.com/path')).toMatchObject({
      ok: true,
      kind: 'http',
      targetUrl: 'http://example.com/path',
    });
    expect(resolveNavigationInput('https://example.com/path')).toMatchObject({
      ok: true,
      kind: 'https',
      targetUrl: 'https://example.com/path',
    });
  });

  test('recognizes internal freedom URLs without renderer involvement', () => {
    expect(resolveNavigationInput('freedom://home')).toEqual({
      ok: true,
      input: 'freedom://home',
      kind: 'internal',
      targetUrl: 'freedom://home',
      displayValue: 'freedom://home',
    });
    expect(resolveNavigationInput('freedom://settings')).toEqual({
      ok: true,
      input: 'freedom://settings',
      kind: 'internal',
      targetUrl: 'freedom://settings',
      displayValue: 'freedom://settings',
    });
    expect(resolveNavigationInput('FREEDOM://SETTINGS/PROFILES')).toEqual({
      ok: true,
      input: 'FREEDOM://SETTINGS/PROFILES',
      kind: 'internal',
      targetUrl: 'freedom://settings/profiles',
      displayValue: 'freedom://settings/profiles',
    });
  });

  test('recognizes direct decentralized protocol URLs without live network access', () => {
    expect(resolveNavigationInput(`bzz://${SWARM_HASH}/index.html`)).toEqual({
      ok: true,
      input: `bzz://${SWARM_HASH}/index.html`,
      kind: 'swarm',
      protocol: 'bzz',
      reference: SWARM_HASH,
      suffix: '/index.html',
      targetUrl: `bzz://${SWARM_HASH}/index.html`,
      displayValue: `bzz://${SWARM_HASH}/index.html`,
    });
    expect(resolveNavigationInput(`ipfs://${IPFS_CID}/readme`)).toMatchObject({
      ok: true,
      kind: 'ipfs',
      protocol: 'ipfs',
      reference: IPFS_CID,
      targetUrl: `ipfs://${IPFS_CID}/readme`,
    });
    expect(resolveNavigationInput(`ipns://${IPNS_KEY}/docs`)).toMatchObject({
      ok: true,
      kind: 'ipns',
      protocol: 'ipns',
      reference: IPNS_KEY,
      targetUrl: `ipns://${IPNS_KEY}/docs`,
    });
  });

  test('recognizes ENS names and transport-aware ENS assertions', () => {
    expect(parseEnsNavigationInput('bzz://Meinhard.ETH/path?x=1')).toEqual({
      name: 'meinhard.eth',
      suffix: '/path?x=1',
      assertedTransport: 'bzz',
      inputProtocol: 'bzz',
    });
    expect(resolveNavigationInput('vitalik.eth/docs')).toEqual({
      ok: true,
      input: 'vitalik.eth/docs',
      kind: 'ens',
      targetUrl: 'ens://vitalik.eth/docs',
      displayValue: 'vitalik.eth/docs',
      name: 'vitalik.eth',
      suffix: '/docs',
      assertedTransport: null,
    });
    expect(resolveNavigationInput('ipfs://Vitalik.ETH/docs')).toMatchObject({
      ok: true,
      kind: 'ens',
      targetUrl: 'ipfs://vitalik.eth/docs',
      assertedTransport: 'ipfs',
    });
    expect(resolveNavigationInput('ens://notdns.example')).toMatchObject({
      ok: false,
      error: {
        code: 'ENS_NAME_INVALID',
      },
    });
  });

  test('recognizes Radicle URLs and rejects invalid Radicle ids', () => {
    expect(resolveNavigationInput(`rad:${RADICLE_ID}/tree/main`)).toEqual({
      ok: true,
      input: `rad:${RADICLE_ID}/tree/main`,
      kind: 'radicle',
      protocol: 'rad',
      rid: RADICLE_ID,
      suffix: '/tree/main',
      targetUrl: `rad://${RADICLE_ID}/tree/main`,
      displayValue: `rad://${RADICLE_ID}/tree/main`,
    });
    expect(resolveNavigationInput('rad:not-a-rid')).toMatchObject({
      ok: false,
      error: {
        code: 'RADICLE_ID_INVALID',
      },
    });
  });

  test('handles ENS contenthash decisions without live ENS lookup', () => {
    expect(
      resolveEnsContenthashNavigation('vitalik.eth/docs', {
        type: 'ok',
        protocol: 'ipfs',
        uri: `ipfs://${IPFS_CID}`,
        trust: { level: 'verified' },
      })
    ).toEqual({
      ok: true,
      input: 'vitalik.eth/docs',
      kind: 'ipfs',
      protocol: 'ipfs',
      targetUrl: `ipfs://${IPFS_CID}/docs`,
      displayValue: 'ipfs://vitalik.eth/docs',
      ens: {
        name: 'vitalik.eth',
        suffix: '/docs',
        assertedTransport: null,
        resolvedTransport: 'ipfs',
      },
      contenthash: {
        uri: `ipfs://${IPFS_CID}`,
        reference: IPFS_CID,
        trust: { level: 'verified' },
      },
    });

    expect(
      resolveEnsContenthashNavigation('bzz://vitalik.eth/docs', {
        type: 'ok',
        protocol: 'ipfs',
        uri: `ipfs://${IPFS_CID}`,
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'ENS_TRANSPORT_MISMATCH',
        assertedTransport: 'bzz',
        resolvedTransport: 'ipfs',
      },
    });

    expect(
      resolveEnsContenthashNavigation('vitalik.eth', {
        type: 'conflict',
        groups: [{ protocol: 'ipfs' }, { protocol: 'bzz' }],
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'ENS_CONTENTHASH_CONFLICT',
        groups: [{ protocol: 'ipfs' }, { protocol: 'bzz' }],
      },
    });

    expect(
      resolveEnsContenthashNavigation('vitalik.eth', {
        type: 'not_found',
        reason: 'NO_CONTENTHASH',
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'ENS_CONTENTHASH_NOT_FOUND',
        reason: 'NO_CONTENTHASH',
      },
    });

    expect(
      resolveEnsContenthashNavigation('vitalik.eth', {
        type: 'fail',
        reason: 'rpc unreachable',
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'ENS_CONTENTHASH_UNAVAILABLE',
        reason: 'rpc unreachable',
      },
    });

    expect(
      resolveEnsContenthashNavigation('vitalik.eth', {
        type: 'ok',
        protocol: 'arweave',
        uri: 'ar://example',
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'ENS_CONTENTHASH_UNSUPPORTED',
        protocol: 'arweave',
        uri: 'ar://example',
      },
    });
  });

  test('rejects freedom URLs outside the shell allowlist', () => {
    expect(resolveNavigationInput('freedom://wallet-seed')).toMatchObject({
      ok: false,
      input: 'freedom://wallet-seed',
      error: {
        code: 'FREEDOM_PAGE_NOT_ALLOWED',
      },
    });
    expect(resolveNavigationInput('freedom://settings/profile/extra')).toMatchObject({
      ok: false,
      input: 'freedom://settings/profile/extra',
      error: {
        code: 'FREEDOM_URL_INVALID',
      },
    });
  });

  test('rejects empty and unresolved inputs with structured errors', () => {
    expect(resolveNavigationInput('   ')).toMatchObject({
      ok: false,
      error: { code: 'INPUT_EMPTY' },
    });
    expect(resolveNavigationInput('not a url')).toMatchObject({
      ok: false,
      input: 'not a url',
      error: { code: 'INPUT_UNRESOLVED' },
    });
  });
});
