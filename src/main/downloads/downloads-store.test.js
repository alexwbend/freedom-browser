const FakeBetterSqlite3DownloadsDatabase = require('../../../test/helpers/fake-better-sqlite3-downloads');
const {
  createTempUserDataDir,
  loadMainModule,
  removeTempUserDataDir,
} = require('../../../test/helpers/main-process-test-utils');

function loadDownloadsStore(options = {}) {
  return loadMainModule(require.resolve('./downloads-store'), {
    ...options,
    extraMocks: {
      'better-sqlite3': () => FakeBetterSqlite3DownloadsDatabase,
    },
  });
}

describe('downloads-store', () => {
  let userDataDir;
  let storeModule;

  beforeEach(() => {
    userDataDir = createTempUserDataDir();
    storeModule = null;
  });

  afterEach(() => {
    if (storeModule?.closeDb) {
      storeModule.closeDb();
    }
    removeTempUserDataDir(userDataDir);
  });

  test('inserts a download as in_progress and returns it with an id', () => {
    const { mod } = loadDownloadsStore({ userDataDir });
    storeModule = mod;

    const row = mod.insertDownload({
      url: 'https://example.com/file.zip',
      filename: 'file.zip',
      savePath: '/tmp/file.zip',
      mimeType: 'application/zip',
      totalBytes: 1024,
    });

    expect(row).toEqual(
      expect.objectContaining({
        id: 1,
        url: 'https://example.com/file.zip',
        filename: 'file.zip',
        state: 'in_progress',
        received_bytes: 0,
        total_bytes: 1024,
      })
    );
    expect(mod.getDownloadCount()).toBe(1);
  });

  test('updates progress and terminal state via patch semantics', () => {
    const { mod } = loadDownloadsStore({ userDataDir });
    storeModule = mod;

    const row = mod.insertDownload({
      url: 'https://example.com/file.zip',
      filename: 'file.zip',
      totalBytes: 1000,
    });

    expect(mod.updateDownload(row.id, { receivedBytes: 500 })).toBe(true);
    let stored = mod.getDownloadById(row.id);
    expect(stored.received_bytes).toBe(500);
    // Untouched fields survive a partial patch.
    expect(stored.state).toBe('in_progress');
    expect(stored.total_bytes).toBe(1000);

    expect(
      mod.updateDownload(row.id, { receivedBytes: 1000, state: 'completed', endTime: 123 })
    ).toBe(true);
    stored = mod.getDownloadById(row.id);
    expect(stored.state).toBe('completed');
    expect(stored.end_time).toBe(123);

    expect(mod.updateDownload(9999, { state: 'completed' })).toBe(false);
  });

  test('searches by filename or url, removes, and clears settled rows', () => {
    const { mod } = loadDownloadsStore({ userDataDir });
    storeModule = mod;

    const first = mod.insertDownload({
      url: 'https://example.com/report.pdf',
      filename: 'report.pdf',
    });
    const second = mod.insertDownload({
      url: 'bzz://somehash/photo.png',
      filename: 'photo.png',
    });

    expect(mod.searchDownloads('report')).toHaveLength(1);
    expect(mod.searchDownloads('somehash')).toHaveLength(1);
    expect(mod.searchDownloads('nothing')).toHaveLength(0);

    mod.updateDownload(first.id, { state: 'completed', endTime: Date.now() });
    expect(mod.removeDownload(first.id)).toBe(true);
    expect(mod.getDownloadCount()).toBe(1);

    // clearDownloads keeps in-progress rows.
    expect(mod.clearDownloads()).toBe(0);
    expect(mod.getDownloadCount()).toBe(1);
    mod.updateDownload(second.id, { state: 'cancelled', endTime: Date.now() });
    expect(mod.clearDownloads()).toBe(1);
    expect(mod.getDownloadCount()).toBe(0);
  });

  test('sweeps stale in_progress rows to interrupted on startup', () => {
    const { mod } = loadDownloadsStore({ userDataDir });
    storeModule = mod;

    mod.insertDownload({ url: 'https://example.com/a.bin', filename: 'a.bin' });
    const settled = mod.insertDownload({ url: 'https://example.com/b.bin', filename: 'b.bin' });
    mod.updateDownload(settled.id, { state: 'completed', endTime: Date.now() });

    expect(mod.markStaleInProgressAsInterrupted()).toBe(1);

    const rows = mod.getAllDownloads();
    const stale = rows.find((row) => row.filename === 'a.bin');
    expect(stale.state).toBe('interrupted');
    expect(stale.end_time).toEqual(expect.any(Number));
    expect(rows.find((row) => row.filename === 'b.bin').state).toBe('completed');
  });
});
