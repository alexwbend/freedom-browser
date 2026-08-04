const fs = require('fs');
const os = require('os');
const path = require('path');
const IPC = require('../../shared/ipc-channels');
const { createIpcMainMock, loadMainModule } = require('../../../test/helpers/main-process-test-utils');

describe('myotis-manager', () => {
  let tempDir;
  let originalNodePath;
  let originalDataDir;

  beforeEach(() => {
    jest.useFakeTimers();
    originalNodePath = process.env.MYOTIS_NODE_PATH;
    originalDataDir = process.env.MYOTIS_DATA_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-myotis-manager-'));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    if (originalNodePath === undefined) delete process.env.MYOTIS_NODE_PATH;
    else process.env.MYOTIS_NODE_PATH = originalNodePath;
    if (originalDataDir === undefined) delete process.env.MYOTIS_DATA_DIR;
    else process.env.MYOTIS_DATA_DIR = originalDataDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function loadManager(options = {}) {
    const addonPath = path.join(tempDir, 'myotis-addon.js');
    fs.writeFileSync(addonPath, 'module.exports = {};');
    process.env.MYOTIS_NODE_PATH = addonPath;

    const status = options.status || {
      beaconState: 'SYNCED',
      elReaderAvailable: true,
      elHunting: false,
      snapPeers: 2,
      peerCount: 5,
      finalizedBlockNumber: '1234',
    };
    const addon = {
      init: jest.fn(() => options.abi ?? 21),
      create: jest.fn(() => options.handle ?? 7),
      start: jest.fn(() => options.starts !== false),
      stop: jest.fn(),
      drainLogs: jest.fn(() => ''),
      statusJson: jest.fn(() => JSON.stringify(status)),
      ensRecordJson: jest.fn(),
      resolveEnsJson: jest.fn(),
      requestAccountJson: jest.fn(),
    };
    const activeProfile = {
      metadata: {
        nodes: {
          myotis: { mode: options.mode || 'managed', backend: 'myotis-native' },
        },
      },
    };
    const updateService = jest.fn();
    const ipcMain = createIpcMainMock();
    const window = { webContents: { send: jest.fn() } };
    const dataDir = path.join(tempDir, 'profile', 'myotis');

    const { mod } = loadMainModule(require.resolve('./myotis-manager'), {
      ipcMain,
      windows: [window],
      extraMocks: {
        [addonPath]: () => addon,
        [require.resolve('../logger')]: () => ({ info: jest.fn(), warn: jest.fn() }),
        [require.resolve('../profile-paths')]: () => ({
          getMyotisDataDir: jest.fn(() => dataDir),
        }),
        [require.resolve('../profile-resolver')]: () => ({
          getActiveProfile: jest.fn(() => activeProfile),
        }),
        [require.resolve('../service-registry')]: () => ({
          MODE: { BUNDLED: 'bundled', DISABLED: 'disabled', NONE: 'none' },
          updateService,
        }),
      },
    });

    return { addon, dataDir, ipcMain, mod, updateService, window };
  }

  test('starts an isolated native client in the active profile data directory', () => {
    const ctx = loadManager();

    expect(ctx.mod.startMyotis()).toBe(true);
    expect(ctx.addon.create).toHaveBeenCalledWith('mainnet', ctx.dataDir);
    expect(ctx.addon.start).toHaveBeenCalledWith(7);
    expect(ctx.mod.publicStatus()).toMatchObject({
      available: true,
      running: true,
      state: 'ready',
      peerCount: 5,
      finalizedBlockNumber: '1234',
    });
    expect(ctx.updateService).toHaveBeenCalledWith(
      'myotis',
      expect.objectContaining({ mode: 'bundled' })
    );

    ctx.mod.stopMyotis();
    expect(ctx.addon.stop).toHaveBeenCalledWith(7);
  });

  test('does not load or start the addon when the profile disables Myotis', () => {
    const ctx = loadManager({ mode: 'disabled' });

    expect(ctx.mod.isEnabled()).toBe(false);
    expect(ctx.mod.startMyotis()).toBe(false);
    expect(ctx.addon.init).not.toHaveBeenCalled();
    expect(ctx.mod.publicStatus()).toMatchObject({ running: false, state: 'disabled' });
    expect(ctx.updateService).toHaveBeenCalledWith(
      'myotis',
      expect.objectContaining({ mode: 'disabled' })
    );
  });

  test('registers start, stop, status, and status-update IPC', async () => {
    const ctx = loadManager();
    ctx.mod.registerMyotisIpc();

    await expect(ctx.ipcMain.invoke(IPC.MYOTIS_START)).resolves.toMatchObject({
      running: true,
      state: 'ready',
    });
    await expect(ctx.ipcMain.invoke(IPC.MYOTIS_STOP)).resolves.toMatchObject({
      running: false,
      state: 'off',
    });
    await expect(ctx.ipcMain.invoke(IPC.MYOTIS_GET_STATUS)).resolves.toMatchObject({
      running: false,
      state: 'off',
    });
    expect(ctx.window.webContents.send).toHaveBeenCalledWith(
      IPC.MYOTIS_STATUS_UPDATE,
      expect.any(Object)
    );
  });

  test('refuses an incompatible native ABI', () => {
    const ctx = loadManager({ abi: 20 });

    expect(ctx.mod.startMyotis()).toBe(false);
    expect(ctx.addon.create).not.toHaveBeenCalled();
    expect(ctx.mod.publicStatus()).toMatchObject({
      running: false,
      state: 'error',
      error: 'ABI mismatch: engine 20, expected 21',
    });
  });
});
