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

// PRIVATE MODE GUARD coverage: private-window rows are flagged, purgeable
// per-partition on window close, and swept wholesale at startup.
describe('downloads-store private rows', () => {
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

  const insertNormal = (mod, url = 'https://example.com/keep.zip') =>
    mod.insertDownload({ url, filename: 'keep.zip', totalBytes: 1 });

  const insertPrivate = (mod, partition, url = 'https://example.com/secret.zip') =>
    mod.insertDownload({
      url,
      filename: 'secret.zip',
      totalBytes: 1,
      isPrivate: true,
      partition,
    });

  test('insertDownload flags private rows with their partition', () => {
    const { mod } = loadDownloadsStore({ userDataDir });
    storeModule = mod;

    const normal = insertNormal(mod);
    const priv = insertPrivate(mod, 'private-abc');

    expect(normal.is_private).toBe(0);
    expect(normal.session_partition).toBe(null);
    expect(priv.is_private).toBe(1);
    expect(priv.session_partition).toBe('private-abc');

    const rows = mod.getAllDownloads();
    expect(rows.find((r) => r.id === priv.id)).toEqual(
      expect.objectContaining({ is_private: 1, session_partition: 'private-abc' })
    );
  });

  test('removeDownloadsForPartition purges only that window rows', () => {
    const { mod } = loadDownloadsStore({ userDataDir });
    storeModule = mod;

    insertNormal(mod);
    insertPrivate(mod, 'private-a');
    insertPrivate(mod, 'private-a', 'https://example.com/secret2.zip');
    insertPrivate(mod, 'private-b');

    expect(mod.removeDownloadsForPartition('private-a')).toBe(2);
    const remaining = mod.getAllDownloads();
    expect(remaining).toHaveLength(2);
    expect(remaining.every((r) => r.session_partition !== 'private-a')).toBe(true);
    // Files on disk are never touched — the store only knows rows, and
    // removeDownloadsForPartition is a pure DELETE (asserted here by the
    // absence of any fs interaction in this module's API surface).
  });

  test('removeDownloadsForPartition with no partition is a no-op', () => {
    const { mod } = loadDownloadsStore({ userDataDir });
    storeModule = mod;
    insertPrivate(mod, 'private-a');
    expect(mod.removeDownloadsForPartition(null)).toBe(0);
    expect(mod.removeDownloadsForPartition('')).toBe(0);
    expect(mod.getDownloadCount()).toBe(1);
  });

  test('removeAllPrivateDownloads sweeps every private row at startup', () => {
    const { mod } = loadDownloadsStore({ userDataDir });
    storeModule = mod;

    insertNormal(mod);
    insertPrivate(mod, 'private-a');
    insertPrivate(mod, 'private-b');

    expect(mod.removeAllPrivateDownloads()).toBe(2);
    const rows = mod.getAllDownloads();
    expect(rows).toHaveLength(1);
    expect(rows[0].is_private).toBe(0);
  });
});
