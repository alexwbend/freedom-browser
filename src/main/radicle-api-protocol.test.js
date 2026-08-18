jest.mock('./logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('./radicle-embedded', () => ({
  status: jest.fn(),
  listRepos: jest.fn(),
  buildRepoMeta: jest.fn(),
  tree: jest.fn(),
  blob: jest.fn(),
  readme: jest.fn(),
}));

const embedded = require('./radicle-embedded');
const { handleRadicleApiRequest, registerRadicleApiProtocol } = require('./radicle-api-protocol');

const RID = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5';

describe('radapi protocol', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    embedded.status.mockResolvedValue({
      version: '0.1.0',
      connectedPeers: 3,
    });
    embedded.listRepos.mockResolvedValue(Array.from({ length: 7 }, (_, index) => ({ index })));
  });

  test('serves the root health check required by the repository viewer', async () => {
    const response = await handleRadicleApiRequest(new Request('radapi://local/'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ version: '0.1.0', mode: 'embedded' });
    expect(embedded.status).toHaveBeenCalledTimes(1);
  });

  test('serves node health HEAD requests without a body', async () => {
    const response = await handleRadicleApiRequest(
      new Request('radapi://local/', { method: 'HEAD' })
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
  });

  test('serves the node stats shape used by the Nodes panel', async () => {
    const response = await handleRadicleApiRequest(new Request('radapi://local/api/v1/stats'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      repos: { total: 7 },
      peers: { connected: 3 },
    });
  });

  test('routes repository metadata through the embedded serving core', async () => {
    embedded.buildRepoMeta.mockResolvedValue({ rid: RID });

    const response = await handleRadicleApiRequest(
      new Request(`radapi://local/api/v1/repos/${RID}`)
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rid: RID });
    expect(embedded.buildRepoMeta).toHaveBeenCalledWith(RID);
  });

  test('preserves status and headers but strips bodies from HEAD responses', async () => {
    embedded.buildRepoMeta.mockResolvedValue({ rid: RID });

    const response = await handleRadicleApiRequest(
      new Request(`radapi://local/api/v1/repos/${RID}`, { method: 'HEAD' })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.text()).resolves.toBe('');
  });

  test('registers the request handler on the target session', async () => {
    const targetSession = { protocol: { handle: jest.fn() } };
    registerRadicleApiProtocol(targetSession);

    expect(targetSession.protocol.handle).toHaveBeenCalledWith('radapi', expect.any(Function));
    const handler = targetSession.protocol.handle.mock.calls[0][1];
    const response = await handler(new Request('radapi://local/'));
    expect(response.status).toBe(200);
  });
});
