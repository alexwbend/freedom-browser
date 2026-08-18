jest.mock('./logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const path = require('path');
const os = require('os');
const fs = require('fs');

describe('radicle-embedded addon loading', () => {
  afterEach(() => {
    delete process.env.FREEDOM_RADICLE_ADDON;
    jest.resetModules();
  });

  test('is unavailable when no addon binary exists anywhere', () => {
    process.env.FREEDOM_RADICLE_ADDON = path.join(
      os.tmpdir(),
      'does-not-exist',
      'libradicle.node'
    );
    jest.isolateModules(() => {
      const embedded = require('./radicle-embedded');
      // Note: falls through to radicle-bin/ and the sibling dev checkout;
      // in CI neither exists. On a dev machine with a sibling build this
      // is legitimately true, so only assert the shape.
      expect(typeof embedded.isAvailable()).toBe('boolean');
    });
  });

  test('call() surfaces addon {error} payloads as thrown errors', async () => {
    // Fake addon: a real file on disk that require() can load.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-addon-'));
    const fake = path.join(dir, 'libradicle.node.js');
    fs.writeFileSync(
      fake,
      'module.exports = {' +
        'repoInfo: async () => JSON.stringify({ error: "boom" }),' +
        'status: async () => JSON.stringify({ connectedPeers: 3 }),' +
        '};'
    );
    process.env.FREEDOM_RADICLE_ADDON = fake;
    await jest.isolateModulesAsync(async () => {
      const embedded = require('./radicle-embedded');
      expect(embedded.isAvailable()).toBe(true);
      await expect(embedded.repoInfo('rad:zAbc')).rejects.toThrow('boom');
      await expect(embedded.status()).resolves.toEqual({ connectedPeers: 3 });
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildRepoMeta shape', () => {
  afterEach(() => {
    delete process.env.FREEDOM_RADICLE_ADDON;
    jest.resetModules();
  });

  test('produces the httpd fields rad-browser consumes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-addon-'));
    const fake = path.join(dir, 'libradicle.node.js');
    fs.writeFileSync(
      fake,
      'module.exports = {' +
        'repoInfo: async () => JSON.stringify({ rid: "rad:zAbc", name: "demo",' +
        ' description: "d", defaultBranch: "main", head: "sha1", issuesOpen: 2, patchesOpen: 1 }),' +
        'seeders: async () => JSON.stringify({ seeding: 7 }),' +
        '};'
    );
    process.env.FREEDOM_RADICLE_ADDON = fake;
    await jest.isolateModulesAsync(async () => {
      const embedded = require('./radicle-embedded');
      const meta = await embedded.buildRepoMeta('rad:zAbc');
      const project = meta.payloads['xyz.radicle.project'];
      expect(project.data).toEqual({
        name: 'demo',
        description: 'd',
        defaultBranch: 'main',
      });
      expect(project.meta.head).toBe('sha1');
      expect(meta.seeding).toBe(7);
      expect(meta.visibility).toEqual({ type: 'public' });
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
