const fs = require('fs');
const os = require('os');
const path = require('path');

function loadManager(options = {}) {
  jest.resetModules();
  const handlers = new Map();
  const ipcMain = { handle: jest.fn((channel, fn) => handlers.set(channel, fn)) };
  const settings = { enableRadicleIntegration: options.enabled !== false };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-radicle-manager-'));
  const embedded = {
    isAvailable: jest.fn(() => options.available !== false),
    isStarted: jest.fn(() => false),
    start: jest.fn(async () => ({ did: 'did:key:z6MkNative' })),
    shutdown: jest.fn(async () => ({ ok: true })),
    connectSeeds: jest.fn(async () => ({ connected: 1 })),
    cloneRepo: jest.fn(async () => ({ ok: true })),
    unseedRepo: jest.fn(async () => ({ unseeded: true })),
    repoInfo: jest.fn(async () => ({
      name: 'native', description: 'repo', defaultBranch: 'main',
    })),
    seeders: jest.fn(async () => ({ seeding: 2 })),
    status: jest.fn(async () => ({ connectedPeers: 3 })),
    ...options.embedded,
  };
  const registry = {
    updateService: jest.fn(),
    setStatusMessage: jest.fn(),
    clearService: jest.fn(),
    MODE: { EMBEDDED: 'embedded', DISABLED: 'disabled' },
  };

  jest.doMock('electron', () => ({
    ipcMain,
    BrowserWindow: { getAllWindows: jest.fn(() => []) },
  }));
  jest.doMock('./logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
  jest.doMock('./settings-store', () => ({ loadSettings: jest.fn(() => settings) }));
  jest.doMock('./profile-paths', () => ({ getRadicleDataDir: jest.fn(() => dataDir) }));
  jest.doMock('./profile-resolver', () => ({
    getActiveProfile: jest.fn(() => options.profile || { metadata: { nodes: {} } }),
  }));
  jest.doMock('./radicle-embedded', () => embedded);
  jest.doMock('./service-registry', () => registry);

  const mod = require('./radicle-manager');
  return { mod, embedded, registry, ipcMain, handlers, settings, dataDir };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('normalizes Radicle IDs without changing base58 case', () => {
  const ctx = loadManager();
  expect(ctx.mod.validateAndNormalizeRid('rad://z3gqcJUoA1n9HaHKufZs5FCSGazv5')).toBe(
    'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5'
  );
  expect(ctx.mod.validateAndNormalizeRid('rad:z0bad')).toBeNull();
  fs.rmSync(ctx.dataDir, { recursive: true, force: true });
});

test('starts and stops only the native addon', async () => {
  const ctx = loadManager();
  await expect(ctx.mod.startRadicle()).resolves.toEqual({ status: 'running', error: null });
  expect(ctx.embedded.start).toHaveBeenCalledWith(ctx.dataDir, 'FreedomBrowser');
  expect(ctx.registry.updateService).toHaveBeenCalledWith('radicle', {
    api: 'radapi://local', gateway: 'radapi://local', mode: 'embedded',
  });
  await expect(ctx.mod.stopRadicle()).resolves.toEqual({ status: 'stopped', error: null });
  expect(ctx.embedded.shutdown).toHaveBeenCalledTimes(1);
  fs.rmSync(ctx.dataDir, { recursive: true, force: true });
});

test('fails closed when the addon is unavailable', async () => {
  const ctx = loadManager({ available: false });
  await expect(ctx.mod.startRadicle()).resolves.toEqual({
    status: 'error', error: 'libradicle addon is not installed',
  });
  expect(ctx.embedded.start).not.toHaveBeenCalled();
  fs.rmSync(ctx.dataDir, { recursive: true, force: true });
});

test('a stop during native startup shuts the completed runtime down once', async () => {
  let finishStart;
  const start = jest.fn(() => new Promise((resolve) => { finishStart = resolve; }));
  const ctx = loadManager({ embedded: { start } });
  const starting = ctx.mod.startRadicle();
  const stopping = ctx.mod.stopRadicle();
  finishStart({ did: 'did:key:z6MkNative' });
  await Promise.all([starting, stopping]);
  expect(ctx.embedded.shutdown).toHaveBeenCalledTimes(1);
  expect(ctx.mod.getCurrentStatus()).toEqual({ status: 'stopped', error: null });
  fs.rmSync(ctx.dataDir, { recursive: true, force: true });
});

test('window.radicle operations use native calls and expose fetch status', async () => {
  const ctx = loadManager();
  await ctx.mod.startRadicle();
  const rid = 'rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5';
  await expect(ctx.mod.seedRepository(rid)).resolves.toMatchObject({
    success: true, status: { rid, state: 'fetching' },
  });
  await Promise.resolve();
  await Promise.resolve();
  await expect(ctx.mod.getSeedFetchStatus(rid)).resolves.toMatchObject({
    success: true, status: { rid, inStorage: true },
  });
  await expect(ctx.mod.getConnections()).resolves.toMatchObject({ success: true, count: 3 });
  await expect(ctx.mod.unseedRepository(rid)).resolves.toMatchObject({ success: true });
  expect(ctx.embedded.unseedRepo).toHaveBeenCalledWith(rid);
  await ctx.mod.stopRadicle();
  fs.rmSync(ctx.dataDir, { recursive: true, force: true });
});

test('disabled profiles never start the addon', async () => {
  const ctx = loadManager({ profile: { metadata: { nodes: { radicle: { mode: 'disabled' } } } } });
  await expect(ctx.mod.startRadicle()).resolves.toEqual({ status: 'stopped', error: null });
  expect(ctx.embedded.start).not.toHaveBeenCalled();
  expect(ctx.registry.updateService).toHaveBeenCalledWith('radicle', {
    api: null, gateway: null, mode: 'disabled',
  });
  fs.rmSync(ctx.dataDir, { recursive: true, force: true });
});

test('IPC keeps integration gating and RID validation', async () => {
  const ctx = loadManager({ enabled: false });
  ctx.mod.registerRadicleIpc();
  const IPC = require('../shared/ipc-channels');
  await expect(ctx.handlers.get(IPC.RADICLE_START)()).resolves.toMatchObject({ status: 'stopped' });
  await expect(ctx.handlers.get(IPC.RADICLE_SEED)(null, '')).resolves.toMatchObject({
    success: false, error: { code: 'RADICLE_DISABLED' },
  });
  fs.rmSync(ctx.dataDir, { recursive: true, force: true });
});
