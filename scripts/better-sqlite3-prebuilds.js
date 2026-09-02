#!/usr/bin/env node

/**
 * Keep better-sqlite3 out of the @electron/rebuild pass.
 *
 * Since v13 the package ships Node-API prebuilds for every target we package
 * (`node_modules/better-sqlite3/prebuilds/{darwin,linux,linuxmusl,win32}-{x64,arm64}.node`)
 * and its loader (`lib/binding.js`) picks the one matching the *running*
 * process. We never build it from source.
 *
 * v13 also dropped `prebuild-install`, and its `prebuilds/` layout is flat
 * files rather than the `prebuilds/<platform>-<arch>/` directories
 * `prebuildify` produces, so @electron/rebuild recognises neither tool and
 * falls through to its node-gyp path. It only considers a module native at all
 * because a `binding.gyp` (a source-build fallback we never use) sits at the
 * package root:
 *
 *   // @electron/rebuild/lib/rebuild.js
 *   candidatePaths.filter((p) => fs.existsSync(path.resolve(p, 'binding.gyp')))
 *
 * Leaving that file in place breaks two documented flows:
 *
 *   - Cross-platform builds (the mac -> Windows release build in
 *     `docs/agent-playbooks/release-process.md` §5) hard-fail with
 *     "node-gyp does not support cross-compiling native modules from source".
 *   - Same-platform `electron-builder install-app-deps` (our `postinstall`)
 *     runs a node-gyp configure that compiles nothing — `binding.gyp` detects
 *     the prebuild and empties the target — but still fetches Electron headers
 *     and, on Windows, requires Visual Studio Build Tools
 *     (`docs/agent-playbooks/windows-utm-build.md`).
 *
 * Removing the unused `binding.gyp` takes better-sqlite3 out of the rebuild
 * pass entirely. It is not packaged (electron-builder drops `binding.gyp` from
 * the app), and any `npm install`/`npm ci` restores it, so this runs from
 * `postinstall` and again from `scripts/build.js` before every build.
 *
 * Usage: node scripts/better-sqlite3-prebuilds.js [--quiet]
 */

const fs = require('fs');
const path = require('path');

const MODULE_ROOT = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');

/** electron-builder platform flag -> the prefix better-sqlite3 names its prebuilds with. */
const PREBUILD_PLATFORM = { mac: 'darwin', linux: 'linux', win: 'win32' };

/**
 * Remove better-sqlite3's source-build fallback `binding.gyp`.
 *
 * The guard is deliberately *package-wide*, not per-target: `postinstall` runs
 * long before any build target is known, so all this can check is that the
 * package ships prebuilt addons at all. v13 ships eight, so in practice this
 * always prunes. A target with no matching prebuild would therefore end up
 * with no addon rather than falling back to a source build — `assertTargetPrebuild()`
 * (called from `scripts/build.js`) is what catches that, before packaging, and
 * `better-sqlite3-prebuilds.test.js` guards that all six targets we package
 * still have a prebuild.
 *
 * @param {string} moduleRoot path to the installed better-sqlite3 package
 * @returns {{ removed: boolean, reason: string }}
 */
function pruneSourceBuildFallback(moduleRoot = MODULE_ROOT) {
  if (!fs.existsSync(moduleRoot)) {
    return { removed: false, reason: 'better-sqlite3 is not installed' };
  }

  const bindingGyp = path.join(moduleRoot, 'binding.gyp');
  if (!fs.existsSync(bindingGyp)) {
    return { removed: false, reason: 'binding.gyp already removed' };
  }

  const prebuildsDir = path.join(moduleRoot, 'prebuilds');
  const prebuilds = fs.existsSync(prebuildsDir)
    ? fs.readdirSync(prebuildsDir).filter((f) => f.endsWith('.node'))
    : [];
  if (prebuilds.length === 0) {
    return {
      removed: false,
      reason: 'no prebuilt addons found; keeping the source-build fallback',
    };
  }

  fs.rmSync(bindingGyp);
  return { removed: true, reason: `${prebuilds.length} prebuilt addons available` };
}

/**
 * Target-aware counterpart to the package-wide prune above: confirm the
 * platform/arch about to be packaged actually has a prebuilt addon.
 *
 * Once `binding.gyp` is gone, @electron/rebuild skips better-sqlite3 entirely,
 * so a missing prebuild is silent — the app would package with no addon and
 * throw at startup. Fail the build here instead.
 *
 * @param {{ platform: string, archs: string[], moduleRoot?: string }} target
 * @returns {{ ok: boolean, missing: string[], expected: string[] }}
 */
function assertTargetPrebuild({ platform, archs, moduleRoot = MODULE_ROOT }) {
  const prefix = PREBUILD_PLATFORM[platform];
  const expected = prefix ? archs.map((arch) => `${prefix}-${arch}.node`) : [];
  if (!prefix || !fs.existsSync(moduleRoot)) {
    return { ok: true, missing: [], expected };
  }

  const prebuildsDir = path.join(moduleRoot, 'prebuilds');
  const missing = expected.filter((name) => !fs.existsSync(path.join(prebuildsDir, name)));
  return { ok: missing.length === 0, missing, expected };
}

module.exports = { MODULE_ROOT, PREBUILD_PLATFORM, pruneSourceBuildFallback, assertTargetPrebuild };

if (require.main === module) {
  const quiet = process.argv.includes('--quiet');
  const { removed, reason } = pruneSourceBuildFallback();
  if (!quiet) {
    console.log(
      removed
        ? `→ better-sqlite3: removed the unused binding.gyp (${reason}); @electron/rebuild will leave it alone`
        : `→ better-sqlite3: nothing to do (${reason})`
    );
  }
}
