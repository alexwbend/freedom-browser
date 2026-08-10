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

function createRpcFetch(
  recordValue,
  {
    expiry = { string: '2099-01-01T00:00:00Z' },
    headLevels = {},
    recordsByEndpoint = null,
  } = {}
) {
  return jest.fn(async (url) => {
    const origin = new URL(url).origin;
    if (url.endsWith('/chains/main/chain_id')) return response('NetXdQprcVkpaWU');
    if (url.endsWith('/blocks/head/header')) {
      return response({ level: headLevels[origin] ?? 1_000 });
    }
    if (url.endsWith('/blocks/992/hash')) return response('BLockHashSharedByProviders');
    if (url.includes('KT1F7JKNqwaoLzRsMio1MQC7zv3jG9dHcDdJ/script/normalized')) {
      return response(proxyScript);
    }
    if (url.includes('KT1GBZmSxmnKJXGMdMLbugPfLyUPmuLSMwKS/script/normalized')) {
      return response(registryScript);
    }
    if (url.includes('/big_maps/1264/')) {
      return response(recordsByEndpoint ? recordsByEndpoint[origin] : recordValue);
    }
    if (url.includes('/big_maps/1262/')) return response(expiry);
    throw new Error(`Unexpected RPC request: ${url}`);
  });
}

const THREE_ENDPOINTS = ['https://rpc-one.test', 'https://rpc-two.test', 'https://rpc-three.test'];

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

  test('rejects website records that point back at a dweb name', () => {
    // Self- or cross-referential records would be handed to the renderer,
    // re-parsed as a name and resolved again — an unbounded navigation loop.
    for (const uri of ['ipns://self.tez', 'ipfs://other.tez', 'ipns://vitalik.eth']) {
      expect(parsePublishedUri(uri)).toMatchObject({
        type: 'unsupported',
        reason: expect.stringContaining('must reference content, not a name'),
      });
    }
    // DNSLink hosts stay valid — only dweb *names* are refused.
    expect(parsePublishedUri('ipns://docs.example.org')).toMatchObject({ type: 'ok' });
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

  test('flags conflicting provider answers with a reason instead of picking a side', async () => {
    const fetchImpl = createRpcFetch(null, {
      recordsByEndpoint: {
        'https://rpc-one.test': record([['web:content_url', 'ipfs://bafybeigdyrzt/site']]),
        'https://rpc-two.test': record([['web:content_url', 'ipfs://bafyother/site']]),
      },
    });
    const result = await resolveTezosDomain('contested.tez', {
      fetchImpl,
      endpoints: ['https://rpc-one.test', 'https://rpc-two.test'],
    });

    expect(result.type).toBe('conflict');
    expect(result.reason).toBe('Tezos RPC providers returned conflicting results');
    expect(result.trust).toMatchObject({ level: 'conflict', k: 2, m: 1 });
    // Shape must match what pages/scripts/ens-conflict.js renders: provider
    // hosts under `urls`, the disputed answer under `value` (or `reason`).
    expect(result.groups).toEqual(
      expect.arrayContaining([
        { value: 'ipfs://bafybeigdyrzt/site', urls: ['rpc-one.test'] },
        { value: 'ipfs://bafyother/site', urls: ['rpc-two.test'] },
      ])
    );
  });

  test('refuses expired domains', async () => {
    const fetchImpl = createRpcFetch(record([['web:content_url', 'ipfs://bafybeigdyrzt/site']]), {
      expiry: { string: '2001-01-01T00:00:00Z' },
    });
    const result = await resolveTezosDomain('stale.tez', {
      fetchImpl,
      endpoints: THREE_ENDPOINTS,
    });

    expect(result).toMatchObject({ type: 'not_found', reason: 'domain record expired' });
  });

  test('excludes a provider whose head level deviates wildly from the median', async () => {
    const fetchImpl = createRpcFetch(record([['web:content_url', 'ipfs://bafybeigdyrzt/site']]), {
      headLevels: { 'https://rpc-three.test': 100 },
    });
    const result = await resolveTezosDomain('anchored.tez', {
      fetchImpl,
      endpoints: THREE_ENDPOINTS,
    });

    expect(result.trust).toMatchObject({ level: 'verified', k: 2, m: 2 });
    expect(result.trust.agreed).not.toContain('https://rpc-three.test');
  });

  test('coalesces concurrent resolutions of the same name into one quorum round', async () => {
    const fetchImpl = createRpcFetch(record([['web:content_url', 'ipfs://bafybeigdyrzt/site']]));
    const options = { fetchImpl, endpoints: THREE_ENDPOINTS };

    const [first, second] = await Promise.all([
      resolveTezosDomain('shared.tez', options),
      resolveTezosDomain('shared.tez', options),
    ]);

    expect(first).toBe(second);
    expect(
      fetchImpl.mock.calls.filter(([url]) => url.endsWith('/chains/main/chain_id'))
    ).toHaveLength(3);
  });

  test('reuses discovered registry big maps across names instead of refetching scripts', async () => {
    const fetchImpl = createRpcFetch(record([['web:content_url', 'ipfs://bafybeigdyrzt/site']]));
    const options = { fetchImpl, endpoints: THREE_ENDPOINTS };
    const scriptCalls = () =>
      fetchImpl.mock.calls.filter(([url]) => url.includes('/script/normalized')).length;

    await resolveTezosDomain('first.tez', options);
    const afterFirst = scriptCalls();
    expect(afterFirst).toBe(6); // proxy + registry script per provider

    await resolveTezosDomain('second.tez', options);
    expect(scriptCalls()).toBe(afterFirst);
  });

  test('short-caches unverified single-provider results so trust can recover', async () => {
    const realNow = Date.now.bind(Date);
    let offsetMs = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offsetMs);
    try {
      const fetchImpl = createRpcFetch(record([['web:content_url', 'ipfs://bafybeigdyrzt/site']]));
      const single = await resolveTezosDomain('solo.tez', {
        fetchImpl,
        endpoints: ['https://rpc-one.test'],
      });
      expect(single.trust.level).toBe('unverified');

      // Within the short TTL the unverified result is still served from cache…
      const cached = await resolveTezosDomain('solo.tez', {
        fetchImpl,
        endpoints: THREE_ENDPOINTS,
      });
      expect(cached.trust.level).toBe('unverified');

      // …but it does not outlive it: the next lookup re-runs the quorum.
      offsetMs = 31_000;
      const recovered = await resolveTezosDomain('solo.tez', {
        fetchImpl,
        endpoints: THREE_ENDPOINTS,
      });
      expect(recovered.trust.level).toBe('verified');
    } finally {
      Date.now.mockRestore();
    }
  });
});
