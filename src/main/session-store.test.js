const fs = require('fs');
const path = require('path');
const IPC = require('../shared/ipc-channels');
const {
  createTempUserDataDir,
  loadMainModule,
  removeTempUserDataDir,
} = require('../../test/helpers/main-process-test-utils');

function loadSessionStore(options = {}) {
  return loadMainModule(require.resolve('./session-store'), {
    ...options,
    extraMocks: {
      ...(options.extraMocks || {}),
      [require.resolve('./logger')]: () => ({
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
      }),
    },
  });
}

const sessionPath = (dir) => path.join(dir, 'session.json');

const writeSessionFile = (dir, content) =>
  fs.writeFileSync(
    sessionPath(dir),
    typeof content === 'string' ? content : JSON.stringify(content),
    'utf-8'
  );

const readSessionFile = (dir) => JSON.parse(fs.readFileSync(sessionPath(dir), 'utf-8'));

const sampleWindow = () => ({
  tabs: [
    { url: 'https://example.com/', title: 'Example', pinned: false, faviconUrl: null },
    {
      url: 'freedom://history',
      title: 'History',
      pinned: true,
      faviconUrl: 'data:image/png;base64,AAAA',
    },
  ],
  activeTabIndex: 1,
});

// Serve the restore snapshot for `slot` as a renderer with webContents id
// `senderId` would receive it. ipcMain mock's invoke() passes an empty
// event, so we call the registered handler directly to control the sender.
const invokeGetRestore = (ipcMain, slot, senderId = 100) =>
  ipcMain.handlers.get(IPC.SESSION_GET_RESTORE)({ sender: { id: senderId } }, slot);

const emitUpdate = (ipcMain, senderId, snapshot) =>
  ipcMain.emit(IPC.SESSION_UPDATE, { sender: { id: senderId } }, snapshot);

describe('session-store', () => {
  let userDataDir;

  beforeEach(() => {
    userDataDir = createTempUserDataDir();
  });

  afterEach(() => {
    removeTempUserDataDir(userDataDir);
  });

  describe('restore payloads', () => {
    test('serves the persisted window snapshot for its slot', async () => {
      writeSessionFile(userDataDir, { version: 1, windows: [sampleWindow()] });
      const { mod, ipcMain } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();

      expect(mod.getRestorableWindowCount()).toBe(1);
      const payload = await invokeGetRestore(ipcMain, 0);
      expect(payload).toEqual(sampleWindow());
      expect(await invokeGetRestore(ipcMain, 1)).toBeNull();
    });

    test('a corrupt (truncated) session.json degrades to a fresh session', async () => {
      writeSessionFile(userDataDir, '{"version":1,"windows":[{"tabs":[{"url":"ht');
      const { mod, ipcMain } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();

      expect(mod.getRestorableWindowCount()).toBe(0);
      expect(await invokeGetRestore(ipcMain, 0)).toBeNull();
    });

    test('a structurally wrong session.json degrades to a fresh session', async () => {
      writeSessionFile(userDataDir, { version: 1, windows: 'not-an-array' });
      const { mod, ipcMain } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();

      expect(mod.getRestorableWindowCount()).toBe(0);
      expect(await invokeGetRestore(ipcMain, 0)).toBeNull();
    });

    test('windows whose tabs all fail sanitization are dropped', async () => {
      writeSessionFile(userDataDir, {
        version: 1,
        windows: [
          { tabs: [{ url: '' }, { url: 'about:blank' }, 'junk', null], activeTabIndex: 0 },
          sampleWindow(),
        ],
      });
      const { mod, ipcMain } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();

      // The all-junk window disappears; the valid one shifts to slot 0.
      expect(mod.getRestorableWindowCount()).toBe(1);
      expect(await invokeGetRestore(ipcMain, 0)).toEqual(sampleWindow());
    });

    test('startup setting "homepage" disables restore without touching the file', async () => {
      fs.writeFileSync(
        path.join(userDataDir, 'settings.json'),
        JSON.stringify({ onStartup: 'homepage' }),
        'utf-8'
      );
      writeSessionFile(userDataDir, { version: 1, windows: [sampleWindow()] });
      const { mod, ipcMain } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();

      expect(mod.getRestorableWindowCount()).toBe(0);
      expect(await invokeGetRestore(ipcMain, 0)).toBeNull();
      // The persisted session is not deleted — flipping the setting back
      // before the next quit would restore it again.
      expect(readSessionFile(userDataDir).windows).toHaveLength(1);
    });
  });

  describe('snapshot updates', () => {
    test('writes sanitized snapshots and clamps the active index', () => {
      const { mod, ipcMain } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();

      emitUpdate(ipcMain, 1, {
        tabs: [
          { url: 'https://a.example/', title: 'A', pinned: 'yes', faviconUrl: 42, junk: true },
          { url: 'about:blank', title: 'skipped' },
          { url: 'bzz://name.eth/', title: 7, pinned: true },
        ],
        activeTabIndex: 99,
      });

      const written = readSessionFile(userDataDir);
      expect(written).toEqual({
        version: 1,
        windows: [
          {
            tabs: [
              { url: 'https://a.example/', title: 'A', pinned: false, faviconUrl: null },
              { url: 'bzz://name.eth/', title: '', pinned: true, faviconUrl: null },
            ],
            activeTabIndex: 1,
          },
        ],
      });
      // Atomic write: no temp file left behind.
      expect(fs.existsSync(`${sessionPath(userDataDir)}.tmp`)).toBe(false);
    });

    test('malformed snapshots are refused without clobbering the file', () => {
      const { mod, ipcMain } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();

      emitUpdate(ipcMain, 1, { tabs: [{ url: 'https://a.example/' }], activeTabIndex: 0 });
      emitUpdate(ipcMain, 1, { tabs: 'garbage' });
      emitUpdate(ipcMain, 1, null);

      expect(readSessionFile(userDataDir).windows[0].tabs[0].url).toBe('https://a.example/');
    });

    test('EPHEMERAL-WINDOW GUARD: flagged windows never reach session.json', () => {
      const { mod, ipcMain } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();
      mod.markWindowSessionEphemeral(7);

      emitUpdate(ipcMain, 7, { tabs: [{ url: 'https://private.example/' }], activeTabIndex: 0 });
      expect(fs.existsSync(sessionPath(userDataDir))).toBe(false);

      emitUpdate(ipcMain, 1, { tabs: [{ url: 'https://a.example/' }], activeTabIndex: 0 });
      const written = readSessionFile(userDataDir);
      expect(JSON.stringify(written)).not.toContain('private.example');
    });
  });

  describe('window lifecycle', () => {
    test('closing one of several windows forgets it; the last window is kept', () => {
      const { mod, ipcMain } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();

      emitUpdate(ipcMain, 1, { tabs: [{ url: 'https://one.example/' }], activeTabIndex: 0 });
      emitUpdate(ipcMain, 2, { tabs: [{ url: 'https://two.example/' }], activeTabIndex: 0 });

      // Mid-session close of window 1: its tabs must not reappear next launch.
      mod.handleSessionWindowClosed(1);
      let written = readSessionFile(userDataDir);
      expect(written.windows).toHaveLength(1);
      expect(written.windows[0].tabs[0].url).toBe('https://two.example/');

      // The last window closing means the session is ending (e.g. macOS
      // close-then-quit) — keep its snapshot for the next launch.
      mod.handleSessionWindowClosed(2);
      written = readSessionFile(userDataDir);
      expect(written.windows).toHaveLength(1);
      expect(written.windows[0].tabs[0].url).toBe('https://two.example/');
    });

    test('windows destroyed during quit are kept for the next restore', () => {
      const { mod, ipcMain, app } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();

      emitUpdate(ipcMain, 1, { tabs: [{ url: 'https://one.example/' }], activeTabIndex: 0 });
      emitUpdate(ipcMain, 2, { tabs: [{ url: 'https://two.example/' }], activeTabIndex: 0 });

      app.emit('before-quit');
      mod.handleSessionWindowClosed(1);
      mod.handleSessionWindowClosed(2);

      expect(readSessionFile(userDataDir).windows).toHaveLength(2);
    });

    test('a window that restored but never changed keeps its session entry', async () => {
      writeSessionFile(userDataDir, { version: 1, windows: [sampleWindow()] });
      const { mod, ipcMain } = loadSessionStore({ userDataDir });
      mod.registerSessionIpc();

      // Window 5 restores slot 0 and never sends an update. Another window
      // updates, forcing a rewrite of the file — the restored window's tabs
      // must survive it.
      await invokeGetRestore(ipcMain, 0, 5);
      emitUpdate(ipcMain, 6, { tabs: [{ url: 'https://new.example/' }], activeTabIndex: 0 });

      const written = readSessionFile(userDataDir);
      expect(written.windows).toHaveLength(2);
      expect(written.windows.map((w) => w.tabs[0].url)).toEqual(
        expect.arrayContaining(['https://example.com/', 'https://new.example/'])
      );
    });
  });
});
