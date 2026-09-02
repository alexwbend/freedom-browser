/**
 * better-sqlite3 v13 ships prebuilt Node-API addons for every target we
 * package but still carries a `binding.gyp`, which is the *only* signal
 * @electron/rebuild uses to classify a module as native. Left in place it
 * routes better-sqlite3 down the node-gyp path, which cannot cross-compile
 * (mac → Windows release build) and needs Visual Studio Build Tools on
 * Windows even though it compiles nothing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { MODULE_ROOT, pruneSourceBuildFallback } = require('./better-sqlite3-prebuilds');

let tmpRoot;

function makeModule({ bindingGyp = true, prebuilds = ['linux-x64.node', 'win32-x64.node'] } = {}) {
  const moduleRoot = fs.mkdtempSync(path.join(tmpRoot, 'better-sqlite3-'));
  if (bindingGyp) fs.writeFileSync(path.join(moduleRoot, 'binding.gyp'), '{}');
  if (prebuilds) {
    fs.mkdirSync(path.join(moduleRoot, 'prebuilds'));
    for (const name of prebuilds) {
      fs.writeFileSync(path.join(moduleRoot, 'prebuilds', name), '');
    }
  }
  return moduleRoot;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bs3-prebuilds-test-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('pruneSourceBuildFallback', () => {
  test('removes binding.gyp when prebuilt addons are present', () => {
    const moduleRoot = makeModule();

    const result = pruneSourceBuildFallback(moduleRoot);

    expect(result.removed).toBe(true);
    expect(fs.existsSync(path.join(moduleRoot, 'binding.gyp'))).toBe(false);
    // The prebuilds themselves — the thing that actually gets packaged — stay.
    expect(fs.readdirSync(path.join(moduleRoot, 'prebuilds')).sort()).toEqual([
      'linux-x64.node',
      'win32-x64.node',
    ]);
  });

  test('keeps binding.gyp when no prebuilt addon is available', () => {
    const moduleRoot = makeModule({ prebuilds: [] });

    const result = pruneSourceBuildFallback(moduleRoot);

    expect(result.removed).toBe(false);
    expect(fs.existsSync(path.join(moduleRoot, 'binding.gyp'))).toBe(true);
  });

  test('keeps binding.gyp when the package ships no prebuilds directory', () => {
    const moduleRoot = makeModule({ prebuilds: null });

    expect(pruneSourceBuildFallback(moduleRoot).removed).toBe(false);
    expect(fs.existsSync(path.join(moduleRoot, 'binding.gyp'))).toBe(true);
  });

  test('is idempotent and safe on a missing module', () => {
    const moduleRoot = makeModule();

    expect(pruneSourceBuildFallback(moduleRoot).removed).toBe(true);
    expect(pruneSourceBuildFallback(moduleRoot).removed).toBe(false);
    expect(pruneSourceBuildFallback(path.join(tmpRoot, 'not-installed')).removed).toBe(false);
  });
});

describe('the installed better-sqlite3', () => {
  test('carries a prebuilt addon for every platform/arch we package', () => {
    const prebuildsDir = path.join(MODULE_ROOT, 'prebuilds');
    const present = new Set(fs.readdirSync(prebuildsDir));
    for (const platform of ['darwin', 'linux', 'win32']) {
      for (const arch of ['x64', 'arm64']) {
        expect(present).toContain(`${platform}-${arch}.node`);
      }
    }
  });

  // `npm install` restores binding.gyp every time, so the prune has to be wired
  // into both entry points that precede an @electron/rebuild pass. (The file's
  // presence in node_modules is not asserted directly: CI's lint/test jobs
  // install with `npm ci --ignore-scripts`, which never runs `postinstall`.)
  test('is pruned by postinstall before install-app-deps runs', () => {
    const { postinstall } = require('../package.json').scripts;
    expect(postinstall.indexOf('better-sqlite3-prebuilds')).toBeGreaterThanOrEqual(0);
    expect(postinstall.indexOf('better-sqlite3-prebuilds')).toBeLessThan(
      postinstall.indexOf('install-app-deps')
    );
  });

  test('is pruned by scripts/build.js before electron-builder runs', () => {
    const buildScript = fs.readFileSync(path.join(__dirname, 'build.js'), 'utf8');
    expect(buildScript).toContain('pruneSourceBuildFallback()');
    expect(buildScript.indexOf('pruneSourceBuildFallback()')).toBeLessThan(
      buildScript.indexOf('execSync(cmd')
    );
  });
});
