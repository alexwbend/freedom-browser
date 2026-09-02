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

/**
 * Remove better-sqlite3's source-build fallback `binding.gyp`, but only when
 * the package actually carries prebuilt addons — on a hypothetical target with
 * no prebuild, building from source is the only option and must stay possible.
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

module.exports = { MODULE_ROOT, pruneSourceBuildFallback };

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
