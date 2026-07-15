jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }));
jest.mock('./logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const {
  invalidateTezosDomain,
  isTezosDomainName,
  parsePublishedUri,
  resolveTezosDomain,
  scriptExprHash,
} = require('./tezos-domains-resolver');

const jsonHex = (value) => Buffer.from(JSON.stringify(value)).toString('hex');

const proxyScript = {
  code: [
    {
      prim: 'storage',
      args: [
        {
          prim: 'pair',
          args: [
            { prim: 'address', annots: ['%contract'] },
            { prim: 'address', annots: ['%owner'] },
          ],
        },
      ],
    },
  ],
  storage: {
    prim: 'Pair',
    args: [
      { string: 'KT1GBZmSxmnKJXGMdMLbugPfLyUPmuLSMwKS' },
      { string: 'KT1BzeXvLtPR83aj5FHemXmia6DmdXkeV3Uk' },
    ],
  },
};

const recordType = {
  prim: 'pair',
  args: [
    { prim: 'map', annots: ['%data'] },
    { prim: 'option', annots: ['%expiry_key'] },
  ],
};
const registryScript = {
  code: [
    {
      prim: 'storage',
      args: [
        {
          prim: 'pair',
          args: [
            { prim: 'big_map', args: [{ prim: 'bytes' }, recordType], annots: ['%records'] },
            { prim: 'big_map', annots: ['%expiry_map'] },
          ],
        },
      ],
    },
  ],
  storage: { prim: 'Pair', args: [{ int: '1264' }, { int: '1262' }] },
};

const record = (entries) => ({
  prim: 'Pair',
  args: [
    entries.map(([key, value]) => ({
      prim: 'Elt',
      args: [{ string: key }, { bytes: jsonHex(value) }],
    })),
    { prim: 'Some', args: [{ bytes: 'aabbcc' }] },
  ],
});

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: jest.fn(() => null) },
    text: jest.fn().mockResolvedValue(JSON.stringify(value)),
  };
}

function createRpcFetch(recordValue) {
  return jest.fn(async (url) => {
    if (url.endsWith('/chains/main/chain_id')) return response('NetXdQprcVkpaWU');
    if (url.endsWith('/blocks/head/header')) return response({ level: 1_000 });
    if (url.endsWith('/blocks/992/hash')) return response('BLockHashSharedByProviders');
    if (url.includes('KT1F7JKNqwaoLzRsMio1MQC7zv3jG9dHcDdJ/script/normalized')) {
      return response(proxyScript);
    }
    if (url.includes('KT1GBZmSxmnKJXGMdMLbugPfLyUPmuLSMwKS/script/normalized')) {
      return response(registryScript);
    }
    if (url.includes('/big_maps/1264/')) return response(recordValue);
    if (url.includes('/big_maps/1262/')) return response({ string: '2099-01-01T00:00:00Z' });
    throw new Error(`Unexpected RPC request: ${url}`);
  });
}

describe('Tezos Domains resolver', () => {
  afterEach(() => invalidateTezosDomain());

  test('validates .tez names without treating them as ENS names', () => {
    expect(isTezosDomainName('docs.example.tez')).toBe(true);
    expect(isTezosDomainName('example.eth')).toBe(false);
    expect(isTezosDomainName('bad..tez')).toBe(false);
  });

  test('derives the canonical Tezos ScriptExpr hash', () => {
    expect(scriptExprHash(Buffer.from('awesome-tezos.tez'))).toBe(
      'exprusUkj4PJBxvW1zeyb2JWiGTWF77vDLxMzPBv8LKtHrKGbDzmeB'
    );
  });

  test('parses IPFS publication paths and rejects non-HTTP redirects', () => {
    expect(parsePublishedUri('ipfs://bafybeigdyrzt/site/')).toMatchObject({
      type: 'ok',
      protocol: 'ipfs',
      decoded: 'bafybeigdyrzt',
      basePath: '/site',
    });
    expect(parsePublishedUri('ipfs://bafybeigdyrzt', { redirect: true })).toMatchObject({
      type: 'unsupported',
    });
  });

  test('requires matching public RPC results and prefers redirect_url', async () => {
    const fetchImpl = createRpcFetch(
      record([
        ['web:content_url', 'ipfs://bafybeigdyrzt/site'],
        ['web:redirect_url', 'https://example.com/welcome'],
        ['td:ttl', 120],
      ])
    );
    const result = await resolveTezosDomain('example.tez', {
      fetchImpl,
      endpoints: ['https://rpc-one.test', 'https://rpc-two.test', 'https://rpc-three.test'],
    });

    expect(result).toMatchObject({
      type: 'ok',
      protocol: 'https',
      uri: 'https://example.com/welcome',
      redirect: true,
      trust: { level: 'verified', k: 3, m: 3 },
    });
  });

  test('returns native IPNS content with its published base path', async () => {
    const fetchImpl = createRpcFetch(record([['web:content_url', 'ipns://docs.example/site']]));
    const result = await resolveTezosDomain('docs.tez', {
      fetchImpl,
      endpoints: ['https://rpc-one.test', 'https://rpc-two.test'],
    });

    expect(result).toMatchObject({
      type: 'ok',
      protocol: 'ipns',
      decoded: 'docs.example',
      basePath: '/site',
      trust: { level: 'verified', m: 2 },
    });
  });
});
