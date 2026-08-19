jest.mock('./logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('./radicle-embedded', () => ({
  status: jest.fn(),
  listRepos: jest.fn(),
  buildRepoMeta: jest.fn(),
  treeAt: jest.fn(),
  blobAt: jest.fn(),
  readmeAt: jest.fn(),
  remotes: jest.fn(),
  repoStats: jest.fn(),
  issues: jest.fn(),
  issue: jest.fn(),
  patches: jest.fn(),
  patch: jest.fn(),
  repoInfo: jest.fn(),
}));
jest.mock('./settings-store', () => ({
  loadSettings: jest.fn(() => ({ enableRadicleIntegration: true })),
}));

const embedded = require('./radicle-embedded');
const { loadSettings } = require('./settings-store');
const {
  handleRadicleApiRequest,
  registerRadicleApiProtocol,
  serveRepoApi,
} = require('./radicle-api-protocol');

const RID = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5';
const REVISION = '0123456789abcdef0123456789abcdef01234567';

describe('radapi protocol', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadSettings.mockReturnValue({ enableRadicleIntegration: true });
    embedded.status.mockResolvedValue({
      version: '0.1.0',
      connectedPeers: 3,
    });
    embedded.listRepos.mockResolvedValue(Array.from({ length: 7 }, (_, index) => ({ index })));
    embedded.repoInfo.mockResolvedValue({ visibility: { type: 'public' } });
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

  test('gates every endpoint on the integration setting', async () => {
    loadSettings.mockReturnValue({ enableRadicleIntegration: false });
    const response = await handleRadicleApiRequest(new Request('radapi://local/api/v1/stats'));
    expect(response.status).toBe(403);
    expect(embedded.status).not.toHaveBeenCalled();
  });

  test('rejects remote web origins and does not expose node responses through wildcard CORS', async () => {
    const denied = await handleRadicleApiRequest(
      new Request('radapi://local/', { headers: { Origin: 'https://hostile.example' } })
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();

    const local = await handleRadicleApiRequest(
      new Request('radapi://local/', { headers: { Origin: 'null' } })
    );
    expect(local.status).toBe(200);
    expect(local.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('serves the local repository collection in viewer metadata shape', async () => {
    embedded.listRepos.mockResolvedValueOnce([{ rid: RID }]);
    embedded.buildRepoMeta.mockResolvedValueOnce({ rid: RID, payloads: {} });
    const response = await handleRadicleApiRequest(
      new Request('radapi://local/api/v1/repos?show=all')
    );
    await expect(response.json()).resolves.toEqual([{ rid: RID, payloads: {} }]);
    expect(embedded.buildRepoMeta).toHaveBeenCalledWith(RID);
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

  test('serves filtered issue and patch reads', async () => {
    embedded.issues.mockResolvedValue([
      { id: 'open', state: { status: 'open' } },
      { id: 'closed', state: { status: 'closed' } },
    ]);
    embedded.patch.mockResolvedValue({ id: 'abc123' });

    const issues = await serveRepoApi(RID, '/issues', { search: '?status=open' });
    await expect(issues.json()).resolves.toEqual([{ id: 'open', state: { status: 'open' } }]);
    const patch = await serveRepoApi(RID, '/patches/abc123');
    await expect(patch.json()).resolves.toEqual({ id: 'abc123' });
    expect(embedded.patch).toHaveBeenCalledWith(RID, 'abc123');
  });

  test('pins tree, blob, and readme reads to the requested commit', async () => {
    embedded.treeAt.mockResolvedValue({ entries: [], lastCommit: { id: REVISION } });
    embedded.blobAt.mockResolvedValue({ name: 'README.md', content: 'old' });
    embedded.readmeAt.mockResolvedValue({ name: 'README.md', content: 'old' });

    const tree = await serveRepoApi(RID, `/tree/${REVISION}/src`);
    const blob = await serveRepoApi(RID, `/blob/${REVISION}/README.md`);
    const readme = await serveRepoApi(RID, `/readme/${REVISION}`);

    expect(tree.status).toBe(200);
    expect(blob.status).toBe(200);
    expect(readme.status).toBe(200);
    expect(embedded.treeAt).toHaveBeenCalledWith(RID, REVISION, 'src');
    expect(embedded.blobAt).toHaveBeenCalledWith(RID, REVISION, 'README.md');
    expect(embedded.readmeAt).toHaveBeenCalledWith(RID, REVISION);
  });

  test('serves signed remotes and revision-scoped repository stats', async () => {
    embedded.remotes.mockResolvedValue([
      { id: 'z6MkDelegate', delegate: true, heads: { main: REVISION } },
    ]);
    embedded.repoStats.mockResolvedValue({ commits: 42, branches: 3, contributors: 5 });

    const remotes = await serveRepoApi(RID, '/remotes');
    const stats = await serveRepoApi(RID, `/stats/tree/${REVISION}`);

    await expect(remotes.json()).resolves.toEqual([
      { id: 'z6MkDelegate', delegate: true, heads: { main: REVISION } },
    ]);
    await expect(stats.json()).resolves.toEqual({ commits: 42, branches: 3, contributors: 5 });
    expect(embedded.remotes).toHaveBeenCalledWith(RID);
    expect(embedded.repoStats).toHaveBeenCalledWith(RID, REVISION);
  });

  test.each([
    '/tree/main/src',
    '/tree/0123456/src',
    '/blob/HEAD/README.md',
    '/readme/main',
    '/stats/tree/main',
  ])('rejects non-object-id revisions in %s', async (apiPath) => {
    const response = await serveRepoApi(RID, apiPath);
    expect(response.status).toBe(400);
    expect(embedded.treeAt).not.toHaveBeenCalled();
    expect(embedded.blobAt).not.toHaveBeenCalled();
    expect(embedded.readmeAt).not.toHaveBeenCalled();
    expect(embedded.repoStats).not.toHaveBeenCalled();
  });

  test('does not expose private repositories through the public repo API', async () => {
    embedded.repoInfo.mockResolvedValueOnce({ visibility: { type: 'private' } });
    const response = await serveRepoApi(RID, '/issues');
    expect(response.status).toBe(403);
    expect(embedded.issues).not.toHaveBeenCalled();
  });

  test.each([
    '/tree/main/..%2F..%2Fsecret',
    '/blob/main/%2e%2e',
    '/issues/%5csecret',
    '/patches/a%00b',
  ])('rejects encoded traversal and separator tricks in %s', async (apiPath) => {
    const response = await serveRepoApi(RID, apiPath);
    expect(response.status).toBe(400);
    expect(embedded.treeAt).not.toHaveBeenCalled();
    expect(embedded.blobAt).not.toHaveBeenCalled();
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
