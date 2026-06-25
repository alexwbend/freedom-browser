# Local Package Chrome Runtime v1 Progress

Branch: `goal/local-package-chrome-runtime-v1`

Starting baseline: latest `origin/goal/local-package-chrome-runtime-v0`, known
at goal start as `5cdd68c` (`docs(chrome): record pre-swarm completion audit`).

Prior baseline ledger:
`docs/agent-progress/local-package-chrome-runtime-v0.md`.

Goal source spec:
`/root/codex/freedom-browser-goal4.md`.

## Checkpoint 1: Inventory And Separation Plan

Status: inventory recorded before large source moves, as required by the v1
hard gate.

### Renderer Source Inventory

Package-owned official chrome UI, intended to move under
`packages/official-browser-chrome/`:

- main chrome entry and shell: `src/renderer/index.html`,
  `src/renderer/index.js`, and package-specific entry wiring derived from that
  flow
- toolbar, tabs, address bar, menus, bookmarks bar, page context menu, link
  status, menu backdrop, update toast, profile indicator, and package-mode
  sidebar placeholder UI
- chrome styles under `src/renderer/styles.css` and `src/renderer/styles/*`
- browser UI modules that already use package-safe runtime adapters:
  `ant-ui.js`, `ipfs-ui.js`, `radicle-ui.js`, `menus.js`,
  `settings-ui.js`, `bookmarks-ui.js`, `tabs.js`, `navigation.js`,
  `autocomplete.js`, `github-bridge-ui.js`, `menu-backdrop.js`,
  `link-status.js`, `page-context-menu.js`, `chrome-input-context-menu.js`,
  `sidebar.js`, and `state.js`
- package-safe static assets used by the chrome UI and internal pages:
  `src/renderer/assets/**`, `src/renderer/pages/images/**`,
  `src/renderer/pages/styles/**`, and `src/renderer/vendor/**`

Package-safe adapter/shared logic:

- `src/renderer/lib/chrome-runtime-api.js` remains the narrow renderer-side
  adapter for `window.freedomShell` in package mode and `window.electronAPI` in
  bundled mode
- `src/renderer/lib/service-runtime-api.js` remains the narrow service-status
  adapter for `window.freedomShell` in package mode and broad service globals
  in bundled mode
- pure helpers are package-safe and may be moved or intentionally shared:
  `autocomplete-utils.js`, `cid-utils.js`, `debug.js`, `ethereum-uri.js`,
  `ipfs-progress-status.js`, `navigation-utils.js`,
  `navigation-utils-helpers.test.js` if test-only, `origin-utils.js`,
  `page-urls.js`, and `url-utils.js`

Package-safe internal pages, with existing package-mode restrictions preserved:

- `src/renderer/pages/home.html`
- `src/renderer/pages/error.html`
- `src/renderer/pages/history.html`
- `src/renderer/pages/links.html`
- `src/renderer/pages/protocol-test.html`
- `src/renderer/pages/ens-conflict.html`
- `src/renderer/pages/ens-unverified.html`
- `src/renderer/pages/rad-browser.html` and its package-safe read-only or
  restricted Radicle behavior
- `src/renderer/pages/settings.html`, preserving package-safe settings writes
  and disabled shell-owned profile/network/provider controls
- `src/renderer/pages/payments.html`, preserving package-mode unavailable
  behavior and the trusted payments surface open action
- `src/renderer/pages/publish.html`, preserving package-mode unavailable
  behavior and the trusted Swarm publish surface open action

Legacy trusted-only code that must stay out of ordinary package chrome source:

- `src/renderer/lib/onboarding.js`
- `src/renderer/lib/wallet-ui.js`
- `src/renderer/lib/wallet/**`
- any direct wallet, identity, vault, dApp permission, x402 approval, Swarm
  stamp/feed-store, provider approval, or private-key/signing UI code
- shell-owned trusted surface source under `src/main/trusted-*`

Provider bridge code that needs an explicit package-safe replacement before
completion:

- `src/renderer/lib/dapp-provider.js` and `src/renderer/lib/swarm-provider.js`
  currently reference broad bundled globals such as wallet, identity,
  permission, provider, and x402 surfaces. The official package source must not
  include those modules as-is. The package path should either use a
  package-safe tab/provider hook that relies on the hardened guest preload and
  main-owned provider paths, or split bundled-only provider UI from
  package-safe webview setup before adding boundary checks.

Code that may remain shared temporarily only with an explicit boundary note:

- pure helper modules listed above
- shared chrome UI modules that already route through `getChromeRuntimeApi()`
  or `getServiceRuntimeApi()`
- styles, image assets, and vendor browser-only libraries
- package-safe internal pages whose raw `freedomAPI` calls are already
  rejected or restricted by main when hosted in package mode

### Implementation Plan

1. Create `packages/official-browser-chrome/` with a package-specific source
   entry. The package entry should avoid importing bundled-only onboarding,
   wallet, dApp approval, or Swarm approval UI modules.
2. Move package-owned chrome source into that tree where practical. For the
   first deterministic build, allow only named curated sharing/copying from
   the inventory above, never a whole `src/renderer` copy.
3. Add a Node standard-library build/materialization script that cleans the
   output directory, copies package source and allowlisted shared assets,
   generates deterministic `manifest.json`, computes package-relative
   SHA-256 hashes, and validates output through the existing package validator.
4. Add ergonomic npm scripts for build/run/install and document the generated
   output path.
5. Replace `writeOfficialChromePackage(...)` in
   `test-e2e/chrome-package.spec.js` with the shared build/materialization
   path. If the helper remains, it should only call the shared builder.
6. Add a focused boundary regression check that scans package source and/or
   built output for broad authority references and trusted source files, with a
   narrow allowlist for explicit absence checks.
7. Triage the known package-mode address suggestions and `freedom://history`
   bugs during browser-state/source movement. Fix with smoke coverage if the
   cause is in this work; otherwise record explicit follow-up bugs.

### Verification

- `git status --short --branch` confirmed a clean starting worktree on
  `goal/local-package-chrome-runtime-v0`.
- `git fetch origin` completed.
- `origin/goal/local-package-chrome-runtime-v1` did not exist.
- Created local `goal/local-package-chrome-runtime-v1` from
  `origin/goal/local-package-chrome-runtime-v0` at
  `5cdd68c22c103571bd058f4957852edb5054c6cc`.
- Read the v1 goal spec and required branch/source/runtime context before
  recording this inventory.
- Committed and pushed as `4d3f9bb`
  (`docs(chrome): record v1 source separation inventory`).

### Remaining

- Commit and push this inventory checkpoint to establish
  `origin/goal/local-package-chrome-runtime-v1`.
- Implement first-class package source tree and deterministic builder.
- Replace the e2e official package copy helper.
- Add boundary guardrails, docs, smoke coverage, and final local/GitHub
  verification.

## Checkpoint 2: First-Class Package Source And Deterministic Build

Status: package source tree, deterministic builder, e2e harness replacement,
and focused boundary guardrail are implemented locally.

### What Changed

- Created `packages/official-browser-chrome/src/` as the official browser
  chrome package source tree.
- Seeded the package tree from the current renderer, then removed bundled-only
  wallet, onboarding, and legacy renderer-side provider modules from the
  package source.
- Patched the package-specific `index.js` so package chrome initializes normal
  browser chrome, service menus, bookmarks, tabs, navigation, autocomplete,
  context menus, profile display, update notifications, sidebar surface
  control, and package readiness without importing wallet/onboarding UI.
- Patched the package-specific `tabs.js` to rely on the hardened guest preload
  and main-owned provider IPC instead of importing legacy renderer-side dApp
  and Swarm provider UI modules.
- Patched the package-specific `navigation.js` so `ethereum:` URI handling in
  package mode opens the shell-owned wallet surface instead of importing the
  bundled wallet send-flow implementation.
- Added `scripts/build-official-chrome-package.js`, which materializes the
  package from `packages/official-browser-chrome/src`, cleans output, excludes
  development files, generates deterministic `manifest.json`, writes
  package-relative SHA-256 file records, declares official capabilities, opts
  into `guestContent.transitionalWebviews: true`, and validates the output
  with `validateLocalChromePackage(...)`.
- Added npm scripts:
  - `chrome:package:build`
  - `chrome:package:check-boundary`
  - `chrome:package:run`
  - `chrome:package:install`
- Replaced `writeOfficialChromePackage(...)` in
  `test-e2e/chrome-package.spec.js` with a thin call to the shared builder.
  The official package smoke no longer hand-copies `src/renderer`.
- Added `scripts/check-official-chrome-boundary.js` and focused Jest coverage
  for builder validity, deterministic file ordering, validator acceptance, and
  broad preload global detection.
- Updated ESLint config so package source JS is parsed as browser ESM.

### Verification

- `npm run chrome:package:build` passed and produced
  `dist/chrome-packages/official-browser-chrome` with 87 package files.
- `npm run chrome:package:check-boundary` passed.
- `npm test -- scripts/build-official-chrome-package.test.js` passed: 1 suite,
  3 tests.
- `npm run lint` initially failed because the new package source made copied
  minified vendor files visible to ESLint. Added
  `packages/official-browser-chrome/src/vendor/**` to the same ignore policy
  used for `src/renderer/vendor/**`.
- `npm run lint` passed after the vendor ignore update.
- First focused official package smoke failed before launch because the builder
  initially rejected temp output directories outside the repo. The builder now
  permits safe temp outputs while still keeping source inside the repo and
  blocking filesystem/repo roots.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch as a local package with transitional webviews"`
  passed: 1 launched Electron test.

### Remaining

- Source/build checkpoint committed and pushed as `5b1d071`
  (`feat(chrome): build official chrome package source`).
- Update `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md` for the new source/build layout.
- Run broader local verification: lint, full unit tests, and bundled plus
  package e2e smoke.
- Triage or record the known address suggestion and `freedom://history` manual
  smoke issues.
- Verify final GitHub `test` and `e2e-chrome-runtime` jobs on the final pushed
  head.

## Checkpoint 3: Source Layout Documentation

Status: runtime and trust-boundary docs updated for the v1 package source
layout.

### What Changed

- Updated `docs/local-package-chrome-runtime.md` with the official package
  source path, generated output path, builder behavior, npm build/run/install
  commands, and boundary-check command.
- Updated the official smoke description so it says the e2e harness uses
  `scripts/build-official-chrome-package.js` and
  `packages/official-browser-chrome/src/` instead of copying `src/renderer`.
- Added official package source/build tests to the runtime verification
  section.
- Updated `docs/package-chrome-trust-boundaries.md` to mark the v1 branch as
  the current source-separation audit and document the package source status,
  package-specific entry/tab split, shared builder, and boundary guard.
- Added a short README pointer to `packages/official-browser-chrome/src/`,
  `npm run chrome:package:build`, and `npm run chrome:package:run`.

### Verification

- `git diff --check` passed before commit.
- Committed and pushed as `a6601b1`
  (`docs(chrome): describe official package source build`).

### Remaining

- Run broader local verification: lint, full unit tests, and bundled plus
  package e2e smoke.
- Triage or record the known address suggestion and `freedom://history` manual
  smoke issues.
- Verify final GitHub `test` and `e2e-chrome-runtime` jobs on the final pushed
  head.

## Checkpoint 4: Trusted-Only Cleanup And Official Install Cache Smoke

Status: local package source hardening and focused install/cache coverage are
implemented locally.

### What Changed

- Removed copied onboarding dialog markup and `styles/onboarding.css` from
  `packages/official-browser-chrome/src/`. The package entry had already
  stopped importing onboarding code, and this removes the remaining trusted-only
  source remnants from the package tree.
- Extended `scripts/check-official-chrome-boundary.js` so it scans CSS and
  flags the legacy trusted-only source files called out in the inventory:
  onboarding, wallet UI, wallet internals, legacy dApp provider, legacy Swarm
  provider, and trusted surface source files.
- Added Jest coverage proving the boundary guard catches those trusted-only
  files, in addition to broad preload globals.
- Added a focused e2e smoke proving the generated official package can be
  installed into the package store and relaunched offline from cache. The test
  uses `writeOfficialChromePackage(...)`, which now delegates to
  `scripts/build-official-chrome-package.js`, then verifies
  `freedomShell.getInfo()` reports the official package with `source: "store"`
  on both install and cache launch.

### Verification

- `npm run chrome:package:check-boundary` passed.
- `npm test -- scripts/build-official-chrome-package.test.js` passed: 1 suite,
  4 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "generated official browser chrome installs into cache"`
  passed: 1 launched Electron test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch as a local package with transitional webviews"`
  passed after the onboarding source cleanup: 1 launched Electron test.
- `npm run lint` passed.
- `git diff --check` passed.

### Remaining

- Run broader local verification: lint, full unit tests, and bundled plus
  package e2e smoke.
- Confirm the known address suggestion and `freedom://history` issues are
  covered by current package smoke, or record explicit follow-up bugs if they
  reproduce outside this goal.
- Commit and push this cleanup/install-cache checkpoint.
- Verify final GitHub `test` and `e2e-chrome-runtime` jobs on the final pushed
  head.
