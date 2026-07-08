const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');
const IPC = require('../../shared/ipc-channels');
const FakeBetterSqlite3DownloadsDatabase = require('../../../test/helpers/fake-better-sqlite3-downloads');
const {
  createIpcMainMock,
  createTempUserDataDir,
  loadMainModule,
  removeTempUserDataDir,
} = require('../../../test/helpers/main-process-test-utils');

class FakeDownloadItem extends EventEmitter {
  constructor({ url, filename, mimeType = 'application/octet-stream', totalBytes = 0 } = {}) {
    super();
    this.url = url;
    this.filename = filename;
    this.mimeType = mimeType;
    this.totalBytes = totalBytes;
    this.receivedBytes = 0;
    this.savePath = '';
    this.saveDialogOptions = null;
    this.paused = false;
    this.resumable = false;
    this.pause = jest.fn(() => {
      this.paused = true;
      this.resumable = true;
    });
    this.resume = jest.fn(() => {
      this.paused = false;
    });
    this.cancel = jest.fn();
  }

  getURL() {
    return this.url;
  }
  getFilename() {
    return this.filename;
  }
  getMimeType() {
    return this.mimeType;
  }
  getTotalBytes() {
    return this.totalBytes;
  }
  getReceivedBytes() {
    return this.receivedBytes;
  }
  setSavePath(savePath) {
    this.savePath = savePath;
  }
  getSavePath() {
    return this.savePath;
  }
  setSaveDialogOptions(options) {
    this.saveDialogOptions = options;
  }
  isPaused() {
    return this.paused;
  }
  canResume() {
    return this.resumable;
  }
}

describe('downloads-manager', () => {
  let userDataDir;
  let downloadsDir;
  let ipcMain;
  let ownerWindow;
  let session;
  let shell;

  const loadManager = () => {
    ipcMain = createIpcMainMock();
    ownerWindow = {
      isDestroyed: () => false,
      webContents: { send: jest.fn() },
    };
    shell = {
      openPath: jest.fn(async () => ''),
      showItemInFolder: jest.fn(),
    };
    const { mod } = loadMainModule(require.resolve('./downloads-manager'), {
      userDataDir,
      appPaths: { userData: userDataDir, downloads: downloadsDir },
      ipcMain,
      electronOverrides: {
        shell,
        BrowserWindow: {
          getAllWindows: jest.fn(() => [ownerWindow]),
          fromWebContents: jest.fn(() => ownerWindow),
        },
        webContents: { getAllWebContents: jest.fn(() => []) },
      },
      extraMocks: {
        'better-sqlite3': () => FakeBetterSqlite3DownloadsDatabase,
      },
    });
    session = new EventEmitter();
    mod.attachDownloadsManager(session);
    mod.registerDownloadsIpc();
    return mod;
  };

  const startDownload = (itemProps) => {
    const item = new FakeDownloadItem(itemProps);
    const webContents = { hostWebContents: { id: 42 } };
    session.emit('will-download', {}, item, webContents);
    return item;
  };

  beforeEach(() => {
    userDataDir = createTempUserDataDir();
    downloadsDir = path.join(userDataDir, 'downloads');
  });

  afterEach(() => {
    removeTempUserDataDir(userDataDir);
  });

  describe('sanitizeFilename', () => {
    test('strips directory components and traversal', () => {
      const { mod } = loadMainModule(require.resolve('./downloads-manager'), {
        userDataDir,
        extraMocks: { 'better-sqlite3': () => FakeBetterSqlite3DownloadsDatabase },
      });
      expect(mod.sanitizeFilename('../../etc/passwd')).toBe('passwd');
      expect(mod.sanitizeFilename('dir\\sub\\file.txt')).toBe('file.txt');
      expect(mod.sanitizeFilename('..\\..\\boot.ini')).toBe('boot.ini');
    });

    test('removes control characters and unsafe punctuation', () => {
      const { mod } = loadMainModule(require.resolve('./downloads-manager'), {
        userDataDir,
        extraMocks: { 'better-sqlite3': () => FakeBetterSqlite3DownloadsDatabase },
      });
      expect(mod.sanitizeFilename('a\x00b\x1fc.txt')).toBe('abc.txt');
      expect(mod.sanitizeFilename('re<po>rt:v1?.pdf')).toBe('re_po_rt_v1_.pdf');
    });

    test('rejects hidden-file dots and empty names', () => {
      const { mod } = loadMainModule(require.resolve('./downloads-manager'), {
        userDataDir,
        extraMocks: { 'better-sqlite3': () => FakeBetterSqlite3DownloadsDatabase },
      });
      expect(mod.sanitizeFilename('...bashrc')).toBe('bashrc');
      expect(mod.sanitizeFilename('')).toBe('download');
      expect(mod.sanitizeFilename('..')).toBe('download');
      expect(mod.sanitizeFilename(null)).toBe('download');
    });

    test('caps overlong names while keeping the extension', () => {
      const { mod } = loadMainModule(require.resolve('./downloads-manager'), {
        userDataDir,
        extraMocks: { 'better-sqlite3': () => FakeBetterSqlite3DownloadsDatabase },
      });
      const long = 'a'.repeat(400) + '.txt';
      const sanitized = mod.sanitizeFilename(long);
      expect(sanitized.length).toBeLessThanOrEqual(255);
      expect(sanitized.endsWith('.txt')).toBe(true);
    });
  });

  describe('uniqueSavePath', () => {
    test('appends " (n)" before the extension on collision', () => {
      const { mod } = loadMainModule(require.resolve('./downloads-manager'), {
        userDataDir,
        extraMocks: { 'better-sqlite3': () => FakeBetterSqlite3DownloadsDatabase },
      });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-dl-'));
      try {
        expect(mod.uniqueSavePath(dir, 'file.txt')).toBe(path.join(dir, 'file.txt'));
        fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
        expect(mod.uniqueSavePath(dir, 'file.txt')).toBe(path.join(dir, 'file (1).txt'));
        fs.writeFileSync(path.join(dir, 'file (1).txt'), 'x');
        expect(mod.uniqueSavePath(dir, 'file.txt')).toBe(path.join(dir, 'file (2).txt'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  test('will-download saves to the downloads dir, records the row, and notifies the owner', async () => {
    loadManager();

    const item = startDownload({
      url: 'https://example.com/report.pdf',
      filename: 'report.pdf',
      totalBytes: 2048,
    });

    expect(item.savePath).toBe(path.join(downloadsDir, 'report.pdf'));
    expect(item.saveDialogOptions).toBeNull();

    const rows = await ipcMain.invoke(IPC.DOWNLOADS_GET, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        filename: 'report.pdf',
        state: 'in_progress',
        total_bytes: 2048,
      })
    );

    expect(ownerWindow.webContents.send).toHaveBeenCalledWith(
      IPC.DOWNLOADS_UPDATED,
      expect.objectContaining({ id: rows[0].id, state: 'in_progress' })
    );
  });

  test('sanitizes a hostile suggested filename before choosing the save path', () => {
    loadManager();

    const item = startDownload({
      url: 'https://evil.example/x',
      filename: '../../../etc/cron.d/evil',
    });

    expect(item.savePath).toBe(path.join(downloadsDir, 'evil'));
  });

  test('done → completed persists the terminal state and broadcasts it', async () => {
    loadManager();

    const item = startDownload({
      url: 'https://example.com/file.bin',
      filename: 'file.bin',
      totalBytes: 100,
    });
    item.receivedBytes = 100;
    item.emit('done', {}, 'completed');

    const rows = await ipcMain.invoke(IPC.DOWNLOADS_GET, {});
    expect(rows[0]).toEqual(
      expect.objectContaining({
        state: 'completed',
        received_bytes: 100,
        end_time: expect.any(Number),
      })
    );

    const finalCall = ownerWindow.webContents.send.mock.calls.at(-1);
    expect(finalCall[0]).toBe(IPC.DOWNLOADS_UPDATED);
    expect(finalCall[1]).toEqual(expect.objectContaining({ state: 'completed' }));
  });

  test('done → cancelled and interrupted map to their store states', async () => {
    loadManager();

    const cancelled = startDownload({ url: 'https://a.example/a', filename: 'a.bin' });
    const interrupted = startDownload({ url: 'https://b.example/b', filename: 'b.bin' });
    cancelled.emit('done', {}, 'cancelled');
    interrupted.emit('done', {}, 'interrupted');

    const rows = await ipcMain.invoke(IPC.DOWNLOADS_GET, {});
    const byName = Object.fromEntries(rows.map((row) => [row.filename, row.state]));
    expect(byName).toEqual({ 'a.bin': 'cancelled', 'b.bin': 'interrupted' });
  });

  test('pause / resume / cancel IPC act on the live item only', async () => {
    loadManager();

    const item = startDownload({ url: 'https://example.com/big.iso', filename: 'big.iso' });
    const rows = await ipcMain.invoke(IPC.DOWNLOADS_GET, {});
    const id = rows[0].id;

    await expect(ipcMain.invoke(IPC.DOWNLOADS_PAUSE, id)).resolves.toBe(true);
    expect(item.pause).toHaveBeenCalled();
    await expect(ipcMain.invoke(IPC.DOWNLOADS_RESUME, id)).resolves.toBe(true);
    expect(item.resume).toHaveBeenCalled();
    await expect(ipcMain.invoke(IPC.DOWNLOADS_CANCEL, id)).resolves.toBe(true);
    expect(item.cancel).toHaveBeenCalled();

    // Settled item drops out of the live map — controls become no-ops.
    item.emit('done', {}, 'cancelled');
    await expect(ipcMain.invoke(IPC.DOWNLOADS_PAUSE, id)).resolves.toBe(false);
    await expect(ipcMain.invoke(IPC.DOWNLOADS_CANCEL, id)).resolves.toBe(false);
  });

  test('resume is refused when the item cannot resume', async () => {
    loadManager();

    const item = startDownload({ url: 'https://example.com/x.bin', filename: 'x.bin' });
    item.resumable = false;
    const rows = await ipcMain.invoke(IPC.DOWNLOADS_GET, {});

    await expect(ipcMain.invoke(IPC.DOWNLOADS_RESUME, rows[0].id)).resolves.toBe(false);
    expect(item.resume).not.toHaveBeenCalled();
  });

  test('ask-where-to-save routes through the native save dialog', () => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({ askWhereToSave: true }),
      'utf-8'
    );
    loadManager();

    const item = startDownload({ url: 'https://example.com/pick.bin', filename: 'pick.bin' });

    expect(item.savePath).toBe('');
    expect(item.saveDialogOptions).toEqual({
      defaultPath: path.join(downloadsDir, 'pick.bin'),
    });
  });

  test('open-file refuses incomplete downloads and missing files, never auto-opens', async () => {
    loadManager();

    const item = startDownload({ url: 'https://example.com/doc.pdf', filename: 'doc.pdf' });
    const rows = await ipcMain.invoke(IPC.DOWNLOADS_GET, {});
    const id = rows[0].id;

    // In progress → refused.
    await expect(ipcMain.invoke(IPC.DOWNLOADS_OPEN_FILE, id)).resolves.toEqual(
      expect.objectContaining({ success: false })
    );

    // Completed but the file is gone → refused.
    item.emit('done', {}, 'completed');
    await expect(ipcMain.invoke(IPC.DOWNLOADS_OPEN_FILE, id)).resolves.toEqual(
      expect.objectContaining({ success: false, error: 'File no longer exists' })
    );
    expect(shell.openPath).not.toHaveBeenCalled();

    // Completed with the file on disk → opens.
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.writeFileSync(item.savePath, 'content');
    await expect(ipcMain.invoke(IPC.DOWNLOADS_OPEN_FILE, id)).resolves.toEqual({ success: true });
    expect(shell.openPath).toHaveBeenCalledWith(item.savePath);
  });

  test('show-in-folder resolves the stored path, not renderer input', async () => {
    loadManager();

    const item = startDownload({ url: 'https://example.com/pic.png', filename: 'pic.png' });
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.writeFileSync(item.savePath, 'content');
    item.emit('done', {}, 'completed');
    const rows = await ipcMain.invoke(IPC.DOWNLOADS_GET, {});

    await expect(ipcMain.invoke(IPC.DOWNLOADS_SHOW_IN_FOLDER, rows[0].id)).resolves.toEqual({
      success: true,
    });
    expect(shell.showItemInFolder).toHaveBeenCalledWith(item.savePath);
  });

  test('remove refuses in-flight downloads and clear keeps them', async () => {
    loadManager();

    const active = startDownload({ url: 'https://example.com/live.bin', filename: 'live.bin' });
    const settled = startDownload({ url: 'https://example.com/old.bin', filename: 'old.bin' });
    settled.emit('done', {}, 'completed');

    const rows = await ipcMain.invoke(IPC.DOWNLOADS_GET, {});
    const activeRow = rows.find((row) => row.filename === 'live.bin');
    const settledRow = rows.find((row) => row.filename === 'old.bin');

    await expect(ipcMain.invoke(IPC.DOWNLOADS_REMOVE, activeRow.id)).resolves.toBe(false);
    await expect(ipcMain.invoke(IPC.DOWNLOADS_REMOVE, settledRow.id)).resolves.toBe(true);

    await expect(ipcMain.invoke(IPC.DOWNLOADS_CLEAR)).resolves.toBe(0);
    const remaining = await ipcMain.invoke(IPC.DOWNLOADS_GET, {});
    expect(remaining).toHaveLength(1);
    expect(remaining[0].filename).toBe('live.bin');
    // Keep `active` referenced so the live map survives until here.
    expect(active.cancel).not.toHaveBeenCalled();
  });

  test('collision with an existing file lands on a numbered filename', () => {
    loadManager();

    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.writeFileSync(path.join(downloadsDir, 'dup.txt'), 'existing');

    const item = startDownload({ url: 'https://example.com/dup.txt', filename: 'dup.txt' });
    expect(item.savePath).toBe(path.join(downloadsDir, 'dup (1).txt'));
  });
});
