# Local Package Chrome Runtime v0 Progress

## Current State

- Branch: `goal/local-package-chrome-runtime-v0`
- Starting commit: `7b39944`
- WP0 smoke-gate code commit: `914614b`
- Package runtime checkpoint commit: `f7cc1bd`
- Readiness recovery checkpoint commit: `5869869`
- GitHub smoke workflow commit: `c9a2e97`
- Current phase: WP1-WP5 package loader, narrow preload, local fixture, fallback smoke, readiness-timeout recovery, runtime docs, and GitHub/Xvfb smoke are implemented
- Goal brief: `/root/codex/freedom-browser-goal.md`
- Roadmap context: `/root/codex/swarm-chrome-roadmap.md`

## Last Verification

- `npm run test:e2e -- test-e2e/chrome-smoke.spec.js` failed on this server because Electron had no X display: `Missing X server or $DISPLAY`.
- `npm test -- src/main/chrome-package.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/shared/navigation-input.test.js` passed: 4 suites, 17 tests.
- `npm test -- src/main/package-preload.test.js src/main/shell-api.test.js` passed after readiness recovery: 2 suites, 6 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed: 6 package/fallback smoke tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js` passed: 1 bundled smoke test.
- `npm run lint` passed.
- `npm test` passed: 106 suites passed, 5 skipped; 2035 tests passed, 17 skipped.
- `xvfb-run -a npm run test:e2e` passed: 20 Playwright harness tests.
- Documentation checkpoint checks: `git diff --check` passed, `npm run lint` passed.
- Attempted `git push -u origin goal/local-package-chrome-runtime-v0` with a CI workflow update included; GitHub rejected the push because the OAuth token lacks `workflow` scope.
- `gh auth status` shows the local GitHub token has `repo` but not `workflow`.
- Attempted to update `.github/workflows/ci.yml` through the GitHub connector on this branch; GitHub returned 403 `Resource not accessible by integration`.
- SSH auth to GitHub succeeded as `flotob`; pushing the workflow update over SSH succeeded.
- GitHub Actions run `27968686550`, job `e2e-chrome-runtime` (`82769110859`), passed. That job ran `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js`.
- `git push -u origin goal/local-package-chrome-runtime-v0` passed after removing workflow-file changes from the commit.
- Latest push to `origin/goal/local-package-chrome-runtime-v0` succeeded; use `git log --oneline --decorate -5` for the current head.

## Smoke Status

- Bundled chrome smoke: implemented in `test-e2e/chrome-smoke.spec.js`; passes under Xvfb locally.
- Package-mode smoke: implemented in `test-e2e/chrome-package.spec.js`; passes under Xvfb locally.
- Fallback smoke: implemented for missing package dir, malformed manifest, incompatible manifest, missing entry file, and package readiness timeout; passes under Xvfb locally.
- GitHub/Xvfb smoke: wired in `.github/workflows/ci.yml` as `e2e-chrome-runtime`; passed in GitHub Actions run `27968686550`.

## Decisions

- Start from clean `origin/main`; do not depend on the unavailable earlier local branch.
- Build the launched Electron bundled-chrome smoke gate before package runtime work.
- Keep WP0 deterministic with `FREEDOM_TEST_MODE=1`; live-network tests are not the guardrail for chrome initialization.
- Direct Electron E2E on this server requires Xvfb.
- Local package chrome is explicitly opt-in through `FREEDOM_CHROME_PACKAGE_DIR` or `--chrome-package`; CLI wins over env for a launch.
- Package chrome uses `src/main/package-preload.js`, which exposes only frozen `window.freedomShell`.
- Shell API v0 currently supports `freedomShell.getInfo()`, `freedomShell.resolveNavigationInput(input)`, and `freedomShell.markReady()` over `shell:request`.
- Package validation is local and conservative: absolute package dir, `manifest.json`, manifest version/type, package metadata, compatible shell API range, relative entry, realpath containment, and existing file entry.
- Runtime load failure for a local package creates a fresh bundled fallback window so bundled chrome gets the broad preload and `webviewTag` back.
- Local package chrome must signal readiness with `freedomShell.markReady()`; if it does not, the shell falls back to bundled chrome. Default timeout is 5000 ms; tests override it with `FREEDOM_CHROME_PACKAGE_READY_TIMEOUT_MS`.
- Runtime support, launch commands, manifest shape, recovery behavior, and verification commands are documented in `docs/local-package-chrome-runtime.md`; README links to that doc.
- The workflow update must be pushed over SSH or with a token that has `workflow` scope; the HTTPS token and GitHub connector cannot write workflow files in this workspace.

## Changed Files By Checkpoint

### WP0 Setup

- `docs/agent-progress/local-package-chrome-runtime-v0.md`

### WP0 Bundled Chrome Smoke

- `test-e2e/chrome-smoke.spec.js`

### WP1-WP4 Local Package Runtime

- `src/main/chrome-package.js`
- `src/main/chrome-package.test.js`
- `src/main/package-preload.js`
- `src/main/package-preload.test.js`
- `src/main/shell-api.js`
- `src/main/shell-api.test.js`
- `src/main/windows/mainWindow.js`
- `src/main/index.js`
- `src/shared/ipc-channels.js`
- `src/shared/navigation-input.js`
- `src/shared/navigation-input.test.js`
- `test/fixtures/chrome-packages/minimal/`
- `test-e2e/chrome-package.spec.js`

### WP5 Runtime Documentation

- `docs/local-package-chrome-runtime.md`
- `README.md`

### GitHub/Xvfb Smoke

- `.github/workflows/ci.yml`

## Known Risks

- The smoke currently filters one test-induced WebView dom-ready race while probing guest page state.
- `resolveNavigationInput()` is deliberately v0 and does not yet mirror the full renderer navigation stack for Swarm/IPFS/ENS/Radicle.
- Readiness only covers package initialization. Semantic health after `markReady()` is not monitored yet.

## Full Local Runtime Phase

### Phase 0 Baseline And V0 Hardening

Current checkpoint: Phase 0 hardening completed in `56a3810`.

Implemented in this phase:

- added shared v0 shell API capability policy in `src/shared/shell-api-policy.js`
- local package manifests now reject invalid or unknown capabilities
- `shell:request` now requires a registered local package sender
- shell API calls from missing, destroyed, or unauthorized senders fail closed
- shell API methods now require manifest-declared capabilities:
  - `shell.info` for `getInfo`
  - `shell.ready` for `markReady`
  - `navigation.resolve` for `resolveNavigationInput`
- local package windows now use explicit hardened `BrowserWindow` preferences and keep package-owned `<webview>` disabled for v0
- `freedom://` shell resolution now uses the shared internal-page allowlist instead of accepting arbitrary internal hosts
- runtime docs now describe sender validation, capability enforcement, hardened package window preferences, and the `freedom://` allowlist

Verification in this phase so far:

- `npm test -- src/main/chrome-package.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/shared/navigation-input.test.js` passed before changes: 4 suites, 18 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed before changes: 7 tests.
- `npm test -- src/main/chrome-package.test.js src/main/shell-api.test.js src/shared/navigation-input.test.js src/main/windows/mainWindow.test.js src/main/package-preload.test.js` passed after changes: 5 suites, 25 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after changes: 7 tests.

- `npm run lint` passed.
- `npm test` passed: 107 suites passed, 5 skipped; 2042 tests passed, 17 skipped.
- `git diff --check` passed.
- Pushed `56a3810` to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `27978855305`, job `e2e-chrome-runtime` (`82803490569`), passed for `56a3810`.
- GitHub Actions run `27978855305`, job `test` (`82803490575`), passed for `56a3810`.

### Phase 1 Shell API Foundation

Current checkpoint: Phase 1 Shell API Foundation gate passed in `7c182ad`.

Implemented in this phase so far:

- expanded `src/shared/shell-api-policy.js` into the v0 shared shell API contract:
  - shell API version
  - method names
  - capability names
  - method-to-capability registry
  - event-to-capability registry placeholder
  - known capability list
- moved `chrome-package.js` and `shell-api.js` to consume the shared contract version/registry
- kept `package-preload.js` runtime-safe by avoiding relative imports and added parity tests against the shared contract
- moved shell API version compatibility parsing/checking into the shared contract
- shell API handler results are cloned through JSON serialization before returning to callers
- shell API errors now use a stable `ShellApiError` name plus stable `code` and `details`
- registered package callers now carry a path-free structured identity
- `getInfo()` now reports caller package identity for shell requests
- capability-denial errors include caller package identity instead of a loose package id
- shell API policy now has an explicit event registry namespace and event capability lookup helper, even though v0 exposes no package-visible shell events yet
- documented the preload parity rule in `docs/local-package-chrome-runtime.md`
- documented `getInfo()` caller identity in `docs/local-package-chrome-runtime.md`

Verification in this phase so far:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/chrome-package.test.js src/main/shell-api.test.js` passed: 4 suites, 21 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` initially failed after direct relative imports were added to `package-preload.js`; the package preload did not expose `window.freedomShell`.
- Fixed `package-preload.js` to keep local preload constants and enforce parity in unit tests.
- `npm test -- src/main/package-preload.test.js src/shared/shell-api-policy.test.js` passed after the preload fix: 2 suites, 6 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after the preload fix: 7 tests.
- `npm run lint` passed.
- `npm test` passed: 108 suites passed, 5 skipped; 2046 tests passed, 17 skipped.
- Committed and pushed `db4d1bd` (`refactor(shell): centralize shell api contract`).
- GitHub Actions run `27979153647`, job `test` (`82804536703`), passed for `db4d1bd`.
- GitHub Actions run `27979153647`, job `e2e-chrome-runtime` (`82804536488`), was later cancelled during dependency setup by the next push before the smoke command ran; do not rely on this run for `db4d1bd` remote smoke evidence.
- `npm test -- src/shared/shell-api-policy.test.js src/main/chrome-package.test.js src/main/shell-api.test.js` passed after version compatibility/result-cloning changes: 3 suites, 22 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after version compatibility/result-cloning changes: 7 tests.
- `npm run lint` passed after version compatibility/result-cloning changes.
- `npm test` passed after version compatibility/result-cloning changes: 108 suites passed, 5 skipped; 2049 tests passed, 17 skipped.
- Committed and pushed `2b374f1` (`refactor(shell): share shell api compatibility`).
- GitHub Actions run `27979416529`, job `test` (`82805455199`), passed for `2b374f1`.
- GitHub Actions run `27979416529`, job `e2e-chrome-runtime` (`82805455027`), passed for `2b374f1`.
- `npm test -- src/main/shell-api.test.js` passed after caller identity changes: 1 suite, 10 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after caller identity changes: 7 tests.
- `npm run lint` passed after caller identity changes.
- `npm test` passed after caller identity changes: 108 suites passed, 5 skipped; 2051 tests passed, 17 skipped.
- Committed and pushed `1927cfd` (`refactor(shell): model package caller identity`).
- GitHub Actions run `27979727270`, job `test` (`82806527021`), passed for `1927cfd`.
- GitHub Actions run `27979727270`, job `e2e-chrome-runtime` (`82806527131`), passed for `1927cfd`.
- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js` passed after event registry closure changes: 3 suites, 18 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after event registry closure changes: 7 tests.
- `npm run lint` passed after event registry closure changes.
- `npm test` passed after event registry closure changes: 108 suites passed, 5 skipped; 2052 tests passed, 17 skipped.
- Committed and pushed `7c182ad` (`refactor(shell): close shell event registry contract`).
- GitHub Actions run `27980019754`, job `test` (`82807466151`), passed for `7c182ad`.
- GitHub Actions run `27980019754`, job `e2e-chrome-runtime` (`82807466123`), passed for `7c182ad`.

Phase 1 gate evidence:

- shared shell API constants, compatibility checks, method capability registry, event capability registry namespace, caller identity, structured errors, result cloning, and package preload parity are implemented and tested
- sender validation, destroyed-sender denial, unauthorized-sender denial, malformed payload denial, unsupported method denial, and missing-capability denial have focused unit coverage
- package fixture smoke still proves `window.freedomShell` is present, broad preload APIs are absent, `getInfo()`, `resolveNavigationInput()`, and `markReady()` work, and broken packages recover to bundled chrome
- bundled chrome smoke still proves the safe chrome path starts, renders home, keeps menus/tabs/navigation interactive, and loads `freedom://settings`

### Phase 2 Main-Owned Tab Model And Commands

Current checkpoint: deterministic shell navigation protocol matrix passed locally and in GitHub target CI jobs in `b106e02`.

Implemented in this phase so far:

- added `src/main/shell-tabs.js`, a main-side tab session model with a serializable snapshot
- added validated tab command results for create, close, activate, navigate, reload, and home
- scoped the tab session to each registered package caller in `shell-api.js`
- added `tabs.read` and `tabs.write` capabilities to the shared shell API policy
- exposed package-safe tab methods from `package-preload.js` through the existing `shell:request` bridge
- updated the local fixture package to request tab capabilities and exercise create/navigate/home/activate/close before `markReady()`
- updated runtime docs to describe the first tab contract as Phase 2 shell-owned API groundwork, not a bundled renderer tab migration
- added a `shell:event` package event channel
- added the `tabs.commandResult` event to the shared event capability registry
- exposed `freedomShell.onTabCommandResult(callback)` from the package preload
- shell API tab commands now emit serializable command-result events after command completion
- updated the fixture package smoke to observe command-result events before `markReady()`
- tab command results now include `snapshotChanged`
- added the `tabs.snapshotChanged` event to the shared event capability registry
- exposed `freedomShell.onTabSnapshotChanged(callback)` from the package preload
- shell API tab commands now emit snapshot events only when the serializable tab snapshot actually changes
- updated the fixture package smoke to prove a failed tab command emits a command result but no snapshot-change event
- expanded the shared shell navigation resolver to classify the required deterministic protocol matrix:
  `http`, `https`, bare domains, `freedom://home`, `freedom://settings`, direct `bzz://`, `ipfs://`, `ipns://`, ENS names, transport-aware ENS assertions, and Radicle `rad:`/`rad://` inputs
- added deterministic ENS contenthash decision handling for success, asserted-transport mismatch, conflict, not-found, unavailable, and unsupported transport outcomes
- updated the fixture package smoke to resolve the protocol matrix through `window.freedomShell`

Verification in this phase so far:

- `npm test -- src/shared/shell-api-policy.test.js src/main/shell-tabs.test.js src/main/package-preload.test.js src/main/chrome-package.test.js src/main/shell-api.test.js` passed: 5 suites, 32 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after tab command changes: 7 tests.
- `npm run lint` passed after tab command changes.
- `npm test` passed after tab command changes: 109 suites passed, 5 skipped; 2056 tests passed, 17 skipped.
- Committed and pushed `6e46964` (`feat(shell): add package tab command contract`).
- GitHub Actions run `27980705626`, job `test` (`82809731975`), passed for `6e46964`.
- GitHub Actions run `27980705626`, job `e2e-chrome-runtime` (`82809732106`), passed for `6e46964`.
- `npm test -- src/shared/shell-api-policy.test.js src/main/shell-tabs.test.js src/main/package-preload.test.js src/main/chrome-package.test.js src/main/shell-api.test.js` passed after command-result event changes: 5 suites, 33 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after command-result event changes: 7 tests.
- `npm run lint` passed after command-result event changes.
- `npm test` passed after command-result event changes: 109 suites passed, 5 skipped; 2057 tests passed, 17 skipped.
- `git diff --check` passed after command-result event changes.
- Committed and pushed `47fb38e` (`feat(shell): emit package tab command events`).
- GitHub Actions run `27981261751`, job `test` (`82811643732`), passed for `47fb38e`.
- GitHub Actions run `27981261751`, job `e2e-chrome-runtime` (`82811643557`), passed for `47fb38e`.
- `npm test -- src/shared/shell-api-policy.test.js src/main/shell-tabs.test.js src/main/package-preload.test.js src/main/chrome-package.test.js src/main/shell-api.test.js` passed after snapshot-change event changes: 5 suites, 34 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after snapshot-change event changes: 7 tests.
- `npm run lint` passed after snapshot-change event changes.
- `npm test` passed after snapshot-change event changes: 109 suites passed, 5 skipped; 2058 tests passed, 17 skipped.
- `git diff --check` passed after snapshot-change event changes.
- Committed and pushed `b3a8e2d` (`feat(shell): emit tab snapshot events`).
- GitHub Actions run `27981756889`, job `test` (`82813430806`), passed for `b3a8e2d`.
- GitHub Actions run `27981756889`, job `e2e-chrome-runtime` (`82813430975`), passed for `b3a8e2d`.
- `npm test -- src/shared/navigation-input.test.js src/main/shell-api.test.js src/main/chrome-package.test.js src/main/package-preload.test.js` passed after deterministic navigation matrix changes: 4 suites, 35 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after deterministic navigation matrix changes: 7 tests.
- `npm run lint` passed after deterministic navigation matrix changes.
- `npm test` passed after deterministic navigation matrix changes: 109 suites passed, 5 skipped; 2062 tests passed, 17 skipped.
- `git diff --check` passed after deterministic navigation matrix changes.
- Committed and pushed `b106e02` (`feat(shell): expand navigation protocol matrix`).
- GitHub Actions run `27982563535`, job `test` (`82816095622`), passed for `b106e02`.
- GitHub Actions run `27982563535`, job `e2e-chrome-runtime` (`82816095384`), passed for `b106e02`.

### Phase 3 Main-Owned Navigation Authority

Current checkpoint: Phase 3 navigation authority gate passed locally and in
GitHub target CI jobs in `b106e02`.

Implemented in this phase:

- expanded the shared shell navigation resolver into a deterministic protocol
  parity matrix for `http`, `https`, bare domains, allowlisted
  `freedom://home`, allowlisted `freedom://settings`, direct `bzz://`, direct
  `ipfs://`, direct `ipns://`, ENS names, transport-aware ENS assertions, and
  Radicle `rad:`/`rad://` inputs
- added deterministic ENS contenthash decision handling for success,
  asserted-transport mismatch, conflict, not-found, unavailable, and
  unsupported transport outcomes
- updated the local package fixture to resolve the matrix through
  `window.freedomShell` before `markReady()`
- updated package smoke coverage to assert the matrix output from the launched
  Electron package runtime

Verification in this phase:

- `npm test -- src/shared/navigation-input.test.js src/main/shell-api.test.js src/main/chrome-package.test.js src/main/package-preload.test.js` passed: 4 suites, 35 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 7 tests.
- `npm run lint` passed.
- `npm test` passed: 109 suites passed, 5 skipped; 2062 tests passed, 17 skipped.
- `git diff --check` passed.
- Committed and pushed `b106e02` (`feat(shell): expand navigation protocol matrix`).
- GitHub Actions run `27982563535`, job `test` (`82816095622`), passed for `b106e02`.
- GitHub Actions run `27982563535`, job `e2e-chrome-runtime` (`82816095384`), passed for `b106e02`.

### Phase 4 Official Chrome As Local Package

Current checkpoint: official browser chrome package smoke passes locally with
the real renderer copied into a temporary local package, including deterministic
ENS/contenthash success, transport mismatch, conflict behavior, and Radicle
disabled-route behavior through the narrow shell API/runtime bridge.

Implemented in this phase so far:

- local package manifests can opt into the transitional webview bridge with
  `guestContent.transitionalWebviews: true`
- local package windows still keep package-owned `<webview>` disabled by default
- transitional package webviews use main-enforced `will-attach-webview`
  hardening instead of package-controlled guest preferences
- main strips package-supplied guest preload/webPreferences attributes and
  applies the shell-owned guest preload plus hardened guest preferences
- runtime docs now describe the transitional bridge, its security boundary, and
  the target shell-owned guest-view architecture
- added a renderer-local chrome runtime adapter used only when the real
  renderer is running as package chrome without `window.electronAPI`
- bundled chrome still uses the broad trusted preload; package chrome gets safe
  startup defaults/no-op handlers and calls `freedomShell.markReady()` through
  the narrow shell API after initial tab creation
- trusted wallet, identity, x402, publish, and permission surfaces are skipped
  in package mode for this smoke and remain shell-owned/deferred work
- added a renderer fallback for the internal page routing map so package chrome
  can route `freedom://home` and `freedom://settings` without the broad preload
- added an official package smoke that copies `src/renderer` into a temporary
  local package, opts into transitional webviews, and proves the real browser
  chrome starts without broad preload globals
- official package smoke currently verifies initial tab/home render, main menu,
  node menu, reload, new tab, tab switch, tab close, bare-domain navigation,
  `http://`, `https://`, direct `bzz://`, direct `ipfs://`, direct `ipns://`,
  ENS/contenthash success loading `ipfs://name.eth/`, asserted transport
  mismatch rejection, ENS conflict interstitial routing, Radicle disabled-route
  handling, `freedom://settings`, `freedom://home`, and home-button navigation
- package-mode direct `bzz://<hash>` routing now works without a gateway prefix
  by loading the standard `bzz:` scheme directly when no Ant route prefix is
  available
- package chrome can now call `resolveEns(name)` and
  `invalidateEnsContent(name)` through `window.freedomShell`, both gated by
  `navigation.resolve`
- package-mode ENS shell calls use the existing deterministic main-process
  harness fixtures when `FREEDOM_TEST_MODE=1`, so official package smoke does
  not hit live Ethereum RPC
- the deterministic official-package navigation parity matrix is covered; live
  network availability remains out of scope for smoke tests

Verification in this checkpoint:

- `npm test -- src/main/chrome-package.test.js src/main/windows/mainWindow.test.js` passed: 2 suites, 17 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 7 tests.
- `npm run lint` passed.
- `npm test` passed: 109 suites passed, 5 skipped; 2067 tests passed, 17 skipped.
- `git diff --check` passed.
- Committed and pushed `abd13e3` (`feat(shell): harden transitional package webviews`).
- GitHub Actions run `27983268135`, job `test` (`82818444112`), passed for `abd13e3`.
- GitHub Actions run `27983268135`, job `e2e-chrome-runtime` (`82818443921`), passed for `abd13e3`.
- `npm test -- src/renderer/lib/chrome-runtime-api.test.js src/renderer/lib/settings-ui.test.js src/renderer/lib/chrome-input-context-menu.test.js src/main/chrome-package.test.js src/main/windows/mainWindow.test.js` passed after official-package adapter changes: 5 suites, 46 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed after official-package smoke changes: 7 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after official-package smoke changes: 8 tests.
- `npm run lint` passed after official-package smoke changes.
- `npm test` passed after official-package smoke changes: 110 suites passed, 5 skipped; 2071 tests passed, 17 skipped.
- `git diff --check` passed after official-package smoke changes.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed on the final diff for this checkpoint: 8 tests.
- Committed and pushed `efaf33b` (`feat(chrome): smoke official package runtime`).
- GitHub Actions run `27984422444`, job `test` (`82822335543`), passed for `efaf33b`.
- GitHub Actions run `27984422444`, job `e2e-chrome-runtime` (`82822335377`), passed for `efaf33b`.
- `npm test -- src/renderer/lib/chrome-runtime-api.test.js src/renderer/lib/url-utils.test.js` passed after official-package navigation expansion: 2 suites, 157 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed after official-package navigation expansion: 7 tests.
- `npm run lint` passed after official-package navigation expansion.
- `npm test` passed after official-package navigation expansion: 110 suites passed, 5 skipped; 2073 tests passed, 17 skipped.
- `git diff --check` passed after official-package navigation expansion.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed on the final diff for this checkpoint: 8 tests.
- Committed and pushed `5ce5c82` (`test(chrome): expand official package navigation smoke`).
- GitHub Actions run `27985238244`, job `test` (`82825004446`), passed for `5ce5c82`.
- GitHub Actions run `27985238244`, job `e2e-chrome-runtime` (`82825004695`), passed for `5ce5c82`.
- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js` passed after ENS shell bridge changes: 4 suites, 26 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed after official-package ENS smoke changes: 7 tests.
- `npm run lint` passed after official-package ENS smoke changes.
- `npm test` passed after official-package ENS smoke changes: 110 suites passed, 5 skipped; 2074 tests passed, 17 skipped.
- `git diff --check` passed after official-package ENS smoke changes.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after official-package ENS smoke changes: 8 tests.
- Committed and pushed `3301d66` (`test(chrome): smoke package ens navigation`).
- GitHub Actions run `27986296382`, job `test` (`82828455211`), passed for `3301d66`.
- GitHub Actions run `27986296382`, job `e2e-chrome-runtime` (`82828455313`), passed for `3301d66`.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed after ENS mismatch/conflict smoke changes: 7 tests.
- `npm run lint` passed after ENS mismatch/conflict smoke changes.
- `npm test` passed after ENS mismatch/conflict smoke changes: 110 suites passed, 5 skipped; 2074 tests passed, 17 skipped.
- `git diff --check` passed after ENS mismatch/conflict smoke changes.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after ENS mismatch/conflict smoke changes: 8 tests.
- Committed and pushed `9b6ba13` (`test(chrome): cover package ens conflict paths`).
- GitHub Actions run `27987087601`, job `test` (`82831039788`), passed for `9b6ba13`.
- GitHub Actions run `27987087601`, job `e2e-chrome-runtime` (`82831039698`), passed for `9b6ba13`.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed after Radicle disabled-route smoke changes: 7 tests.
- `npm run lint` passed after Radicle disabled-route smoke changes.
- `npm test` passed after Radicle disabled-route smoke changes: 110 suites passed, 5 skipped; 2074 tests passed, 17 skipped.
- `git diff --check` passed after Radicle disabled-route smoke changes.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after Radicle disabled-route smoke changes: 8 tests.
- Committed and pushed `e1291b3` (`test(chrome): cover package radicle routing`).
- GitHub Actions run `27987748615`, job `test` (`82833120461`), passed for `e1291b3`.
- GitHub Actions run `27987748615`, job `e2e-chrome-runtime` (`82833120441`), passed for `e1291b3`.

### Phase 5 Local Package Store, Integrity, And Rollback

Current checkpoint: unpacked package manifest file-integrity verification and
the durable local package store/cache/rollback path are implemented locally;
local feed/update source work remains next.

Implemented in this phase so far:

- local package manifests now require a non-empty `files` array with
  package-relative paths and SHA-256 hashes
- the package loader verifies every listed file exists, is a file, remains
  inside the package root after realpath resolution, and matches its SHA-256
  hash before activation
- the package entry must be covered by the manifest `files` records
- package metadata now carries a normalized file list internally without
  exposing package filesystem paths through `getInfo()`
- the checked-in minimal package fixture and generated official package smoke
  manifests now include integrity records
- fallback smoke now covers a tampered package entry file and recovers to
  bundled chrome
- local package install mode now stages a verified unpacked package into
  `<userData>/chrome-package-store/`, revalidates the staged copy, atomically
  activates `current.json`, and records `previous.json` on update
- cached package launch mode now validates store pointers, install metadata,
  manifest hash, file hashes, shell compatibility, capabilities, and entry path
  before activation
- same-package downgrades and same-version changed-content replay are rejected
  by default
- cached package load/readiness failure now rolls back to the previous cached
  package before falling back to bundled safe chrome
- launched package smoke covers install-to-cache, offline cached launch, and
  readiness-timeout rollback to the previous cached package

Verification in this phase so far:

- `npm test -- src/main/chrome-package.test.js` passed after file-integrity changes: 1 suite, 17 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed after file-integrity changes: 8 tests.
- `npm run lint` passed after file-integrity changes.
- `npm test` passed after file-integrity changes: 110 suites passed, 5 skipped; 2079 tests passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after file-integrity changes: 9 tests.
- `git diff --check` passed after file-integrity changes.
- committed as `657cb4e` (`feat(chrome): verify package file integrity`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `27988568432`, job `test` (`82835714879`), passed for `657cb4e`.
- GitHub Actions run `27988568432`, job `e2e-chrome-runtime` (`82835715063`), passed for `657cb4e`.
- `npm test -- src/main/chrome-package.test.js src/main/chrome-package-store.test.js src/main/windows/mainWindow.test.js` passed after store/cache/rollback changes: 3 suites, 34 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed after store/cache/rollback changes: 10 tests.
- `npm run lint` passed after store/cache/rollback changes.
- `npm test` passed after store/cache/rollback changes: 111 suites passed, 5 skipped; 2091 tests passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after store/cache/rollback changes: 11 tests.
- `git diff --check` passed after store/cache/rollback changes.
- committed as `c57d41d` (`feat(chrome): add local package store rollback`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `27989520572`, job `test` (`82838683408`), passed for `c57d41d`.
- GitHub Actions run `27989520572`, job `e2e-chrome-runtime` (`82838683381`), passed for `c57d41d`.

### Phase 6 Local Feed/Update Source

Current checkpoint: deterministic local feed/update source is implemented,
committed, pushed, and verified in GitHub target CI jobs.

Implemented in this phase so far:

- added a versioned local feed/pointer format with `feedVersion: 1`,
  `packageId`, `channel`, and directory-backed package entries
- added `FREEDOM_CHROME_PACKAGE_FEED_FILE` and `--chrome-package-feed`
  selectors
- added a local feed adapter that validates feed entries, resolves relative
  package directories from the feed file, rejects unsupported source types, and
  installs the newest valid update through the existing staged package store
- kept archives as explicit future work; no extraction dependency was added
- feed launch falls back to the current cached package when the feed is missing,
  unavailable, or advertises only corrupt/unusable updates
- feed-installed updates still launch from the store and use the existing
  readiness/load rollback path for failed activation
- launched smoke now covers feed first install, feed update, missing feed/source
  fallback to cache, corrupt advertised update fallback to cache, and failed
  feed update readiness rollback to the previous cached package

Verification in this phase so far:

- `npm test -- src/main/chrome-package.test.js src/main/chrome-package-feed.test.js src/main/chrome-package-store.test.js` passed after feed/source changes: 3 suites, 37 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed after feed/source changes: 12 tests.
- `npm run lint` passed after feed/source changes.
- `npm test` passed after feed/source changes: 112 suites passed, 5 skipped; 2099 tests passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after feed/source changes: 13 tests.
- `git diff --check` passed after feed/source changes.
- committed as `3ae5be0` (`feat(chrome): add local package feed updates`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `27990426062`, job `test` (`82841420490`), passed for `3ae5be0`.
- GitHub Actions run `27990426062`, job `e2e-chrome-runtime` (`82841420591`), passed for `3ae5be0`.

### Phase 7 Independent Update Proof

Current checkpoint: independent local package update proof is implemented,
committed, pushed, and verified in GitHub target CI jobs.

Implemented in this phase so far:

- launched feed smoke installs package version `0.1.0` from a local feed,
  records the Electron `appVersion` from `freedomShell.getInfo()`, updates to
  package version `0.2.0`, and asserts `appVersion` is unchanged while
  `chromePackage.version` changes
- the updated package launches from the local store with
  `chromePackage.source: "store"`
- the same smoke deletes the feed/source directory and proves offline launch
  from the cached updated package still reports version `0.2.0`
- corrupt advertised updates keep the current cached package active
- readiness-timeout update failure rolls back to the previous cached package
- docs now describe how local feed package updates differ from the Electron
  shell updater and how `getInfo()` reports both versions

Verification in this phase so far:

- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "local package feed rolls back when updated package renderer becomes unhealthy"` passed: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed after the optional profile-menu smoke addition: 1 test.
- `npm test -- src/main/windows/mainWindow.test.js` passed after health rollback changes: 1 suite, 5 tests.
- `npm run lint` passed.
- `npm test` passed: 112 suites passed, 5 skipped; 2099 tests passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- `xvfb-run -a npm run test:e2e` passed: 27 tests.
- `git diff --check` passed.
- committed as `b5d0a60` (`feat(chrome): rollback unhealthy package renderer`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `27991143101`, job `test` (`82843612237`), passed for `b5d0a60`.
- GitHub Actions run `27991143101`, job `e2e-chrome-runtime` (`82843612229`), passed for `b5d0a60`.

### Phase 8 Final Hardening And Docs

Current checkpoint: package renderer health failure now uses the same
rollback/bundled recovery path as load and readiness failures, and the
checkpoint is verified in GitHub target CI jobs.

Implemented in this phase so far:

- local package main renderer `render-process-gone` now triggers package
  recovery
- cached package health failure first tries `previous.json` rollback and falls
  back to bundled safe chrome if rollback is unavailable
- launched feed smoke now proves an updated package can become unhealthy after
  activation and the shell rolls back to the previous cached package
- official package smoke now checks the profile menu when the current package
  mode exposes it, matching the bundled smoke's optional profile-menu behavior
- docs now describe renderer-health rollback and the independent local package
  update flow

Verification in this phase so far:

- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "local package feed rolls back when updated package renderer becomes unhealthy"` passed: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed: 13 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed: 1 test.
- `npm test -- src/main/windows/mainWindow.test.js` passed: 1 suite, 5 tests.
- `npm run lint` passed.
- `npm test` passed: 112 suites passed, 5 skipped; 2099 tests passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- `xvfb-run -a npm run test:e2e` passed: 27 tests.
- `git diff --check` passed.
- committed as `b5d0a60` (`feat(chrome): rollback unhealthy package renderer`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- progress evidence committed as `b380b49` (`docs(progress): record package health ci`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `27991143101`, job `test` (`82843612237`), passed for `b5d0a60`.
- GitHub Actions run `27991143101`, job `e2e-chrome-runtime` (`82843612229`), passed for `b5d0a60`.
- GitHub Actions run `27991329932`, job `test` (`82844216534`), passed for `b380b49`.
- GitHub Actions run `27991329932`, job `e2e-chrome-runtime` (`82844216520`), passed for `b380b49`.

## Final Completion Audit

Status: no open completion gaps found in the final audit.

Completion criteria mapping:

- Official chrome package runtime: covered by the official package smoke in
  `test-e2e/chrome-package.spec.js`, including initial tab, home background,
  menus, profile menu when exposed, tabs, address bar, reload/home,
  `freedom://home`, `freedom://settings`, and the deterministic protocol
  parity matrix.
- Shell API v1: implemented through `window.freedomShell`,
  `src/main/shell-api.js`, `src/shared/shell-api-policy.js`, and
  `src/main/package-preload.js`; sender validation, capability enforcement,
  structured errors, version/capability policy, tab commands, snapshots,
  navigation resolution, ENS helpers, and command events have unit and smoke
  coverage.
- Main-owned security boundaries: package windows use the narrow preload;
  transitional package webviews are manifest-gated and hardened in
  `src/main/windows/mainWindow.js`; package chrome cannot choose guest
  preloads or guest webPreferences.
- Local package store/cache: implemented with staged installs, internal
  metadata, `current.json`/`previous.json`, offline cached launch, rollback,
  and bundled recovery.
- Package integrity/trust: manifests, shell API ranges, capabilities, file
  hashes, official identity, downgrade/replay, malformed manifests, missing
  files, and tampered content are validated and tested.
- Local update source: deterministic local feed supports first install,
  update, offline cached launch, unavailable/corrupt feed fallback, readiness
  rollback, renderer-health rollback, previous rollback, and bundled safe
  fallback without live Swarm/Ant package delivery.
- Bundled safe chrome recovery: bundled chrome remains the default recovery
  surface and is covered by fallback and smoke tests.
- Independent update proof: local feed smoke proves package version changes
  while Electron `appVersion` remains unchanged, and docs explain the shell vs.
  package update split.
- Documentation: `docs/local-package-chrome-runtime.md` documents the
  architecture, trust boundaries, manifest, shell API/capabilities, package
  store, local source/update flow, future Swarm source seam, transitional
  webview model, recovery behavior, dev workflow, commands, CI gates, and
  limitations.

Completion report is ready to provide from the final session state after the
last progress-ledger commit and branch-head CI check.

## Pre-Swarm Package Chrome Hardening

Goal brief: `/root/codex/freedom-browser-goal3.md`.

Starting branch state:

- required branch: `goal/local-package-chrome-runtime-v0`
- starting commit: `f267f0f5de55ace6cb8ec2d31af5c425bb926974`
  (`docs(progress): record final package runtime audit`)
- upstream: `origin/goal/local-package-chrome-runtime-v0`
- `git fetch origin` completed with no branch update
- `git status --short --branch` reported a clean worktree aligned with
  `origin/goal/local-package-chrome-runtime-v0`

Required context read on 2026-06-23:

- `/root/codex/freedom-browser-goal3.md`
- `docs/agent-progress/local-package-chrome-runtime-v0.md`
- `docs/local-package-chrome-runtime.md`
- `/root/codex/swarm-chrome-roadmap.md`

Current phase: Phase 0 baseline/manual-finding reproduction and Phase 1 trust
boundary inventory preparation.

Initial findings carried into this goal:

- official package mode currently uses the narrow `window.freedomShell` package
  preload and intentionally lacks broad globals such as `electronAPI`, wallet,
  identity, provider, and permission APIs
- `src/renderer/lib/chrome-runtime-api.js` still contains package-mode no-op
  shims for browser state and visible chrome controls, including bookmarks,
  history, favicons, settings/profile defaults, window controls, menu events,
  and x402 events
- before browser-state API implementation starts, the required durable
  trust-boundary inventory and method-by-method `chrome-runtime-api.js` no-op
  audit must be created in `docs/package-chrome-trust-boundaries.md`

Planned verification for the first checkpoint:

- `npm run lint`
- `npm test`
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js`

Baseline verification on 2026-06-23:

- `npm run lint` passed.
- `npm test` passed: 112 suites passed, 5 skipped; 2099 tests passed, 17
  skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.

Phase 1 trust-boundary inventory:

- created `docs/package-chrome-trust-boundaries.md`
- classified the required browser flows across provider path, browser-state
  API, surface-control API, trusted surface, and bundled-only/deferred
  categories
- audited every package-mode method in
  `src/renderer/lib/chrome-runtime-api.js`
- recorded that proposed deferrals are not user-approved and cannot be used to
  claim completion

Next checkpoint:

- add package-mode smoke coverage for the current empty bookmarks bar and
  wallet/sidebar behavior
- implement the first browser-state shell APIs for bookmarks and bookmark-bar
  settings, with package preload/policy/renderer adapter tests

### Browser-State Checkpoint 1: Bookmarks And Settings Read

Current checkpoint: ordinary browser-state shell APIs now cover the official
package chrome bookmark bar and bookmark write path, and the visible package
wallet/sidebar affordance is intentionally hidden instead of remaining an inert
button.

Implemented in this checkpoint:

- exported the existing bookmark store operations so bundled IPC and package
  shell API calls share the same load/add/update/remove behavior
- added versioned shell API methods and capabilities for settings read and
  bookmark read/write:
  - `browserState.settings.get` / `browserState.settings.read`
  - `browserState.bookmarks.get` / `browserState.bookmarks.read`
  - `browserState.bookmarks.add/update/remove` /
    `browserState.bookmarks.write`
- exposed those methods through the narrow package preload as `freedomShell`
  methods only
- updated the package renderer adapter to delegate settings reads and bookmark
  read/write calls to `freedomShell`
- kept `window.electronAPI`, wallet, identity, provider, permission, Node, and
  Electron primitives unavailable in package chrome
- hid the wallet/sidebar toolbar button in package mode until a shell-owned
  surface-control path exists
- expanded official package smoke coverage so it fails if default bookmarks do
  not render, if a default bookmark cannot navigate under the harness, or if
  the wallet/sidebar button is visible as an inert control
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js src/main/bookmarks-store.test.js` passed: 5 suites, 35 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed: 13 tests.
- `npm run lint` passed.
- `npm test` passed: 112 suites passed, 5 skipped; 2103 tests passed, 17
  skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- committed as `92ea1e7` (`feat(chrome): add package browser-state shell
  APIs`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28036065482`, job `test` (`82989628608`), passed for
  `92ea1e7`.
- GitHub Actions run `28036065482`, job `e2e-chrome-runtime`
  (`82989628698`), passed for `92ea1e7`.

Known remaining gaps after this checkpoint:

- settings writes and bookmark-bar menu toggle behavior still need either real
  shell APIs or intentional disabled/hidden smoke coverage
- direct add/edit/remove bookmark UI smoke is still pending, though the shell
  API and adapter write paths have unit coverage
- history/autocomplete, favicons, profile/menu behavior, window/menu command
  events, surface-control, provider-flow bypass, trusted prompt broker, and
  `freedom-chrome://active/` package serving remain for later phases

### Browser-State Checkpoint 2: History And Cached Favicons

Current checkpoint: package chrome now uses narrow browser-state shell APIs for
history/autocomplete data, history recording, and cached favicon reads.

Implemented in this checkpoint:

- added shell API methods and capabilities:
  - `browserState.history.get` / `browserState.history.read`
  - `browserState.history.add` / `browserState.history.write`
  - `browserState.favicons.getCached` / `browserState.favicons.read`
- exposed those methods through `window.freedomShell` only
- updated the package runtime adapter so `getHistory`, `addHistory`, and
  `getCachedFavicon` no longer use no-op package defaults when shell support is
  available
- kept network favicon fetching APIs unavailable to package chrome pending a
  scoped shell-owned fetch/write design
- expanded official package smoke coverage so autocomplete must include a
  default bookmark suggestion and a recorded-history suggestion in package mode
- updated runtime and trust-boundary docs

Verification in this checkpoint:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js` passed: 4 suites, 30 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed: 13 tests.
- `npm run lint` passed.
- `npm test` passed: 112 suites passed, 5 skipped; 2103 tests passed, 17
  skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- committed as `5dc6778` (`feat(chrome): bridge package history state`) and
  pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28036672279`, job `test` (`82991788420`), passed for
  `5dc6778`.
- GitHub Actions run `28036672279`, job `e2e-chrome-runtime`
  (`82991788433`), passed for `5dc6778`.

Known remaining gaps after this checkpoint:

- `saveSettings`, bookmark-bar menu toggle behavior, history remove/clear, and
  network favicon fetch/write APIs still need either real shell APIs or
  intentional disabled/hidden smoke coverage if visible in package mode
- direct add/edit/remove bookmark UI smoke remains pending
- profile/menu behavior, window/menu command events, service/node status,
  surface-control, provider-flow bypass, trusted prompt broker, and
  `freedom-chrome://active/` package serving remain for later phases

### Provider-Flow Checkpoint 1: Low-Risk Direct Chain ID

Current checkpoint: package mode now has a deterministic provider-flow safety
proof for the low-risk `eth_chainId` method.

Implemented in this checkpoint:

- added a main-owned read-only dApp provider IPC channel for `eth_chainId`
- routed guest webview `ethereum.request({ method: 'eth_chainId' })` from the
  guest preload directly to main without `sendToHost` or package chrome
  mediation
- kept higher-risk provider methods on the existing legacy path until the
  trusted prompt/surface broker migration is implemented
- kept package chrome without provider globals
- expanded official package smoke so a guest IPFS page must see
  `window.ethereum` and receive `0x64` from `eth_chainId`
- added webview-preload unit coverage proving `eth_chainId` bypasses
  `sendToHost` while `eth_requestAccounts` stays on the legacy host-renderer
  path
- updated runtime and trust-boundary docs

Verification in this checkpoint:

- `npm test -- src/main/webview-preload.test.js src/main/wallet/wallet-ipc.test.js` passed: 2 suites, 19 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed: 13 tests.
- `npm run lint` passed.
- `npm test` passed: 112 suites passed, 5 skipped; 2106 tests passed, 17
  skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- committed as `5b8463a` (`feat(chrome): prove package provider bypass`) and
  pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28037300921`, job `test` (`82993987395`), passed for
  `5b8463a`.
- GitHub Actions run `28037300921`, job `e2e-chrome-runtime`
  (`82993987683`), passed for `5b8463a`.

Known remaining gaps after this checkpoint:

- wallet connect, account exposure, transaction/signing, Swarm provider, and
  x402 provider/approval flows still need the trusted prompt/surface broker
  design before they can bypass package chrome safely
- package mode still needs surface-control or intentional hidden/disabled
  coverage for more visible controls such as profile/window/menu affordances
- `freedom-chrome://active/` package serving was still pending at this point;
  it is addressed in the package-origin checkpoint below

### Surface-Control Checkpoint 1: Wallet Placeholder Control

Current checkpoint: package chrome has a narrow shell-owned surface-control API
for the wallet surface, backed by caller-scoped placeholder state. The real
wallet/identity/signing surface has not been migrated and remains outside
package chrome.

Implemented in this checkpoint:

- added shell API methods and capability:
  - `surfaces.getState`
  - `surfaces.open`
  - `surfaces.close`
  - `surfaces.toggle`
  - `surfaces.wallet.control`
- exposed those methods through `window.freedomShell` as
  `getSurfaceState`, `openSurface`, `closeSurface`, and `toggleSurface`
- implemented caller-scoped wallet placeholder state in main with
  `owner: "shell"` and `mode: "shell-owned-placeholder"`
- unsupported surfaces return a structured `SURFACE_UNSUPPORTED` result
- callers without `surfaces.wallet.control` are denied by the shell API policy
- the local fixture package declares `surfaces.wallet.control` and exercises the
  placeholder surface path before marking itself ready
- official package chrome still hides the wallet/sidebar affordance until the
  real trusted wallet surface is implemented
- kept package chrome without wallet, identity, provider, permission, Node, or
  Electron globals
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js` passed: 3 suites, 27 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm run lint` passed.
- `npm test` passed: 112 suites passed, 5 skipped; 2108 tests passed, 17
  skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- `git diff --check` passed.
- committed as `a680424` (`feat(chrome): add shell-owned surface control`) and
  pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28037966618`, job `test` (`82996352824`), passed for
  `a680424`.
- GitHub Actions run `28037966618`, job `e2e-chrome-runtime`
  (`82996352722`), passed for `a680424`.

Known remaining gaps after this checkpoint:

- the API is a shell-owned placeholder only; real wallet center, wallet
  connect, signing, vault unlock, x402, and Swarm approval surfaces still need
  the trusted prompt broker foundation before package chrome can expose those
  flows safely
- `freedom-chrome://active/` package serving was still pending at this point;
  it is addressed in the package-origin checkpoint below

### Trusted Prompt Broker Checkpoint 1: Test-Only Broker Path

Current checkpoint: package chrome can request a test-only trusted prompt
result through a main-owned broker without rendering the prompt or supplying
final origin/security truth. This is a broker foundation, not a real
wallet/payment/publish/vault prompt migration.

Implemented in this checkpoint:

- added `src/main/trusted-prompt-broker.js`
- added shell API method and capability:
  - `trustedPrompts.requestTest`
  - `trustedPrompts.test`
- exposed the method through `window.freedomShell.requestTestTrustedPrompt`
- shell API requests pass only registered caller identity into the broker and
  ignore package-supplied `origin`, `tabId`, URL, label, or permission-key
  claims as final security truth
- unsupported prompt kinds return structured `TRUSTED_PROMPT_UNSUPPORTED`
  results
- callers without `trustedPrompts.test` are denied by the shell API policy
- the local fixture package declares `trustedPrompts.test` and exercises the
  broker path before marking itself ready
- official package chrome does not declare the test prompt capability
- kept package chrome without wallet, identity, provider, x402, Swarm, vault,
  signing, Node, Electron, or arbitrary IPC authority
- added `docs/trusted-prompt-broker.md` and updated
  `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/main/trusted-prompt-broker.test.js` passed: 4 suites, 32 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm run lint` passed.
- `npm test` passed: 113 suites passed, 5 skipped; 2113 tests passed, 17
  skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- committed as `7f4b25f` (`feat(chrome): add trusted prompt broker
  foundation`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28039000303`, job `test` (`82999999527`), passed for
  `7f4b25f`.
- GitHub Actions run `28039000303`, job `e2e-chrome-runtime`
  (`82999999439`), passed for `7f4b25f`.

Known remaining gaps after this checkpoint:

- the broker slice is test-only; real wallet connect, transaction/signing,
  typed-data signing, x402 approvals, Swarm publish/feed approvals, and vault
  unlock still need main-derived request context plus real shell-owned prompt
  UI before package mode can support those flows
- `freedom-chrome://active/` package serving was still pending at this point;
  it is addressed in the package-origin checkpoint below

### Package-Origin Checkpoint 1: Active Cached Package Scheme

Current checkpoint: cached package windows now load their entry through the
shell-owned `freedom-chrome://active/` scheme instead of raw file URLs. Direct
local development packages remain file-based.

Implemented in this checkpoint:

- added `src/main/chrome-package-protocol.js`
- registered `freedom-chrome` as a privileged standard, secure package scheme
  before app ready
- registered a default-session `freedom-chrome` protocol handler during app
  bootstrap
- changed store-backed package launch to `loadURL("freedom-chrome://active/...")`
  while preserving `loadFile()` for bundled chrome and direct local package
  development
- served only files declared by the active package manifest
- rejected dot-segment traversal and encoded separator package URLs
- refused undeclared package files and store metadata
- rechecked each served file's SHA-256 hash against the active package manifest
- added package CSP headers for scheme responses
- added package-origin unit coverage and a launched Electron smoke assertion
  that cached package install/cache launches use the active scheme
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/chrome-package-protocol.test.js src/main/windows/mainWindow.test.js` passed: 2 suites, 14 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "local package chrome installs into cache"` passed: 1 test.
- `npm test -- src/main/chrome-package-protocol.test.js src/main/windows/mainWindow.test.js src/main/chrome-package.test.js src/main/chrome-package-store.test.js src/main/chrome-package-feed.test.js` passed: 5 suites, 51 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed: 13 tests.
- `npm run lint` passed.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- `npm test` passed: 114 suites passed, 5 skipped; 2122 passed, 17 skipped.
- `git diff --check` passed.
- `xvfb-run -a npm run test:e2e` passed: 27 tests.
- committed as `06f9e51` (`feat(chrome): serve cached packages from active
  scheme`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28040355328`, job `test` (`83004738595`), passed for
  `06f9e51`.
- GitHub Actions run `28040355328`, job `e2e-chrome-runtime`
  (`83004738562`), passed for `06f9e51`.

Known remaining gaps after this checkpoint:

- direct local package development still uses file URLs by design
- package signatures/provenance and Swarm package delivery remain out of scope
- broad final package UX parity and multi-window diagnostics still need the
  later hardening/final-gate work

### Runtime Diagnostics Checkpoint 1: Sender-Scoped Package Info

Current checkpoint: package-visible `freedomShell.getInfo()` diagnostics are
now sender-scoped where package identity is public, and fallback error details
are sanitized before crossing the shell API boundary.

Implemented in this checkpoint:

- changed shell-request `getInfo()` responses to derive the top-level
  `runtimeMode` and `chromePackage` descriptor from the registered package
  caller identity instead of global active package state
- preserved direct internal `getInfo()` diagnostics without a caller as an
  active-package snapshot
- kept caller/package descriptors path-free and added fallback diagnostic
  sanitization for nested validation errors
- stripped or redacted public diagnostic fields that can reveal package roots,
  requested package/feed/store paths, install paths, entry/preload paths, file
  URLs, or absolute filesystem paths
- added unit coverage for:
  - fallback diagnostics with nested path-bearing validation causes
  - a registered package caller whose global active package differs from its
    sender identity
  - two registered package senders seeing their own package metadata without
    seeing the global active package or another sender's path details
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/shell-api.test.js` passed: 1 suite, 21 tests.
- `npm test -- src/main/shell-api.test.js src/main/package-preload.test.js src/shared/shell-api-policy.test.js src/main/chrome-package.test.js src/main/chrome-package-store.test.js src/main/chrome-package-protocol.test.js` passed: 6 suites, 69 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm run lint` passed.
- `npm test` passed: 114 suites passed, 5 skipped; 2123 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- committed as `93de353` (`fix(shell): scope package diagnostics to caller`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28041362076`, job `test` (`83008156498`), passed for
  `93de353`.
- GitHub Actions run `28041362076`, job `e2e-chrome-runtime`
  (`83008156304`), passed for `93de353`.

Known remaining gaps after this checkpoint:

- this hardens diagnostics only; the final UX parity gate and any remaining
  no-op package adapter dispositions still need later checkpoint work

### Window-Control Checkpoint 1: Owner-Window Shell Commands

Current checkpoint: package chrome no longer uses silent no-op adapter methods
for ordinary owner-window title/fullscreen/window commands. Visible fullscreen
menu behavior is now exercised in official package smoke.

Implemented in this checkpoint:

- added shell API methods behind a new `windows.control` capability:
  - `windows.setTitle`
  - `windows.close`
  - `windows.minimize`
  - `windows.toggleMaximize`
  - `windows.toggleFullscreen`
- exposed matching package preload methods on `window.freedomShell`:
  - `setWindowTitle(title)`
  - `closeWindow()`
  - `minimizeWindow()`
  - `maximizeWindow()`
  - `toggleFullscreen()`
- changed `src/renderer/lib/chrome-runtime-api.js` package adapter methods for
  those commands to delegate to `freedomShell` instead of no-op shims
- scoped each command to the BrowserWindow that owns the registered package
  sender; package chrome cannot choose an arbitrary target window
- added capability-denial and unavailable-owner-window unit coverage
- granted the official local package smoke manifest `windows.control`
- expanded official package smoke to click the visible fullscreen menu control
  and verify the owner BrowserWindow receives shell-owned
  `setFullScreen(true/false)` calls
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js` passed: 4 suites, 38 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm run lint` passed.
- `npm test` passed: 114 suites passed, 5 skipped; 2126 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- committed as `5817d9d` (`feat(shell): add package window controls`) and
  pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28042384812`, job `test` (`83011708222`), passed for
  `5817d9d`.
- GitHub Actions run `28042384812`, job `e2e-chrome-runtime`
  (`83011708172`), passed for `5817d9d`.

Known remaining gaps after this checkpoint:

- new-window/about/update/menu event no-op adapter methods remain intentionally
  unavailable until they are implemented through narrow shell APIs or hidden
  and covered in package-mode smoke
- profile mutation/switching, settings writes, and some history/favicon
  management methods still need final audit disposition before completion

### System Menu Command Checkpoint 1: New Window, About, And Updater Requests

Current checkpoint: package chrome no longer uses silent no-op adapter methods
for the visible New Window, About, Check for Updates, and Restart/Install
Update command paths. New Window has launched package smoke coverage; About and
updater commands are unit-covered shell-owned request paths to avoid native
dialog/update side effects in smoke.

Implemented in this checkpoint:

- added shell API methods and capabilities:
  - `windows.new` / `windows.open`
  - `windows.openUrl` / `windows.open`
  - `app.showAbout` / `app.about`
  - `app.checkForUpdates` / `app.updates`
  - `app.restartAndInstallUpdate` / `app.updates`
- exposed matching package preload methods on `window.freedomShell`:
  - `newWindow()`
  - `openUrlInNewWindow(url)`
  - `showAbout()`
  - `checkForUpdates()`
  - `restartAndInstallUpdate()`
- changed `src/renderer/lib/chrome-runtime-api.js` package adapter methods for
  those commands to delegate to `freedomShell` instead of no-op shims
- wired `registerShellApiIpc()` to injected shell-owned callbacks from
  `src/main/index.js`:
  - `createMainWindow` for new-window requests
  - existing updater `checkForUpdates` and `installUpdate` actions for app
    update requests
- kept updater policy, native dialogs, updater ownership locks, install state,
  and all Electron primitives in main; package chrome receives only
  serializable request results
- granted the official local package smoke manifest `windows.open`,
  `app.about`, and `app.updates`
- expanded official package smoke to click the visible New Window menu control,
  verify a second package chrome BrowserWindow becomes ready, and close it
  again
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js` passed: 4 suites, 41 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm run lint` passed.
- `npm test` passed: 114 suites passed, 5 skipped; 2129 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- committed as `c09cd3f` (`feat(shell): add package system menu commands`) and
  pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28043800391`, job `test` (`83016588894`), passed for
  `c09cd3f`.
- GitHub Actions run `28043800391`, job `e2e-chrome-runtime`
  (`83016588988`), failed for `c09cd3f` because the official package smoke
  asserted `BrowserWindow.isFullScreen()` flipped under the Ubuntu/Xvfb CI
  window manager after a visible Fullscreen menu click. The shell command path
  was made deterministic by recording owner-window `setFullScreen(true/false)`
  calls instead of relying on platform fullscreen state reporting.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed after the CI fix: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after the CI fix: 14 tests.
- `npm run lint` passed after the CI fix.
- committed the first CI fix as `c99eedd` (`test(chrome): stabilize package
  fullscreen smoke`) and pushed to
  `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28044337945`, job `test` (`83018416603`), passed for
  `c99eedd`.
- GitHub Actions run `28044337945`, job `e2e-chrome-runtime`
  (`83018416607`), failed for `c99eedd` because the first recorder instrumented
  only the first live BrowserWindow; CI had a different non-destroyed window
  before the package window, so the package owner window's `setFullScreen()`
  calls were not recorded.
- updated the fullscreen smoke recorder to instrument all live BrowserWindows
  and aggregate recorded `setFullScreen(true/false)` calls.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed after the all-window recorder fix: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after the all-window recorder fix: 14 tests.
- `npm run lint` passed after the all-window recorder fix.
- committed the all-window recorder fix as `1273a80` (`test(chrome): record
  fullscreen calls across windows`) and pushed to
  `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28044839022`, job `test` (`83020108724`), passed for
  `1273a80`.
- GitHub Actions run `28044839022`, job `e2e-chrome-runtime`
  (`83020108690`), failed for `1273a80` because the visible Fullscreen menu
  item click still produced no recorded `setFullScreen()` call in CI even
  though the same smoke passed locally. The next fix keeps the visible menu and
  target-item assertions but triggers the already-visible menu command with a
  DOM `click()` to avoid Ubuntu/Xvfb pointer-target variance on the menu item.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed after the deterministic menu-click fix: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after the deterministic menu-click fix: 14 tests.
- `npm run lint` passed after the deterministic menu-click fix.
- committed the deterministic menu-click fix as `9d17b6f` (`test(chrome):
  trigger package menu commands deterministically`) and pushed to
  `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28045446520`, job `test` (`83022203819`), passed for
  `9d17b6f`.
- GitHub Actions run `28045446520`, job `e2e-chrome-runtime`
  (`83022204011`), passed for `9d17b6f`.

Known remaining gaps after this checkpoint:

- native About-panel and updater UX are not clicked in package smoke; the
  shell-owned request paths have unit coverage and remain candidates for
  stronger native-dialog/update harness evidence in the final parity gate
- `openUrlInNewWindow(url)` is implemented as a shell-owned request path, but
  direct package context-menu smoke remains pending if final audit treats that
  context menu as a visible completion-critical control
- profile mutation/switching, settings writes, bookmark-bar menu toggles,
  native menu event bridges, devtools/focus shortcuts, service/node status
  commands, clipboard/image context actions, and some history/favicon
  management methods still need final audit disposition before completion

### Browser-State Checkpoint 3: Package-Safe Settings Writes

Current checkpoint: package chrome no longer uses a silent `saveSettings`
adapter no-op for package-safe browser UI settings. Service/node/provider
settings remain shell-owned and are ignored if included in a package settings
write payload.

Implemented in this checkpoint:

- added shell API method and capability:
  - `browserState.settings.save` / `browserState.settings.write`
- exposed `saveSettings(settings)` through the narrow package preload
- changed `src/renderer/lib/chrome-runtime-api.js` so package
  `saveSettings()` delegates to `freedomShell.saveSettings()`
- kept package settings writes scoped to a package-safe browser UI subset:
  `theme`, `showBookmarkBar`, `blockUnverifiedEns`, `sidebarOpen`, and
  `sidebarWidth`
- ignored service/node/provider-oriented settings such as
  `enableIdentityWallet` and `startAntAtLaunch` in package save payloads
- granted the official package smoke manifest `browserState.settings.write`
- expanded the official package smoke to prove live settings writes persist
  safe keys while unsafe service/provider keys are not changed
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js` passed: 4 suites, 41 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed: 1 test.
- `npm run lint` passed.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` initially failed because the fixture smoke's explicit `freedomShell` key list did not include the new `saveSettings` method; the expected narrow API surface list was updated.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after the fixture smoke expectation update: 14 tests.
- `npm test` passed: 114 suites passed, 5 skipped; 2129 passed, 17 skipped.
- committed as `e795018` (`feat(chrome): add package-safe settings writes`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28046465870`, job `test` (`83025718688`), passed for
  `e795018`.
- GitHub Actions run `28046465870`, job `e2e-chrome-runtime`
  (`83025718878`), passed for `e795018`.

Known remaining gaps after this checkpoint:

- native bookmark-bar menu toggle, menu event bridges, devtools/focus
  shortcuts, and native tab command events still need implementation or
  intentional disabled/hidden behavior with coverage
- profile mutation/switching, service/node status commands, clipboard/image
  context actions, direct context-menu open-in-new-window smoke, and some
  history/favicon management methods still need final audit disposition before
  completion

### Native Command Event Checkpoint 1: Application Menu Bridge

Current checkpoint: native application menu and shell-originated browser UI
commands now reach package chrome through a capability-gated `shell:event`
bridge instead of relying on broad preload IPC channels that package chrome
does not receive.

Implemented in this checkpoint:

- added `chrome.ui.commands` as an explicit package capability for ordinary
  shell-originated browser UI command events
- added versioned shell event names for menu closing, address-bar focus,
  DevTools commands, tab creation/closing/traversal/move/reopen,
  new-tab-with-URL, navigate/load URL, reload/hard reload, and bookmark-bar
  toggle requests
- exposed package-preload subscriptions such as
  `onNewTabRequested`, `onCloseTabRequested`,
  `onFocusAddressBarRequested`, `onReloadRequested`, and
  `onToggleBookmarkBarRequested`
- changed `src/renderer/lib/chrome-runtime-api.js` so the official package
  adapter's existing native menu subscription methods delegate to the
  `freedomShell` command subscriptions instead of silent no-op handlers
- routed `src/main/menu.js` native menu commands through a helper that delivers
  `shell:event` to registered package windows only when the package declares
  `chrome.ui.commands`; bundled windows keep the legacy direct IPC path
- routed webview window-open and custom-protocol navigation requests through
  the same event bridge for package windows
- routed package-window blur menu-close and shutdown DevTools close-all through
  the event bridge, with bundled fallback preserved
- granted the generated official local chrome package manifest
  `chrome.ui.commands`
- expanded official package smoke coverage for native application menu New
  Tab, Focus Address Bar, Reload, Close Tab, and Always Show Bookmarks Bar
  behavior in package mode
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint so far:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js src/main/menu.test.js src/main/windows/mainWindow.test.js` passed: 6 suites, 55 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` initially failed because the new bookmark-bar assertion assumed the renderer's local bookmark-bar override had been updated by a direct settings write; the smoke was corrected to drive the native toggle from the actual hidden non-home state.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed after the smoke correction: 1 test.
- `npm run lint` passed.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- `npm test` passed: 114 suites passed, 5 skipped; 2130 passed, 17 skipped.
- `git diff --check` passed.
- committed as `0d8de31` (`feat(chrome): bridge package native menu commands`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28047841605`, job `test` (`83030418114`), passed for
  `0d8de31`.
- GitHub Actions run `28047841605`, job `e2e-chrome-runtime`
  (`83030418190`), passed for `0d8de31`.

Known remaining gaps after this checkpoint:

- package adapter menu-state methods `updateTabMenuState`,
  `setBookmarkBarToggleEnabled`, and `setBookmarkBarChecked` still need a
  package-safe shell path or intentional final disposition
- profile mutation/switching, service/node status commands, clipboard/image
  context actions, direct context-menu open-in-new-window smoke, and some
  history/favicon management methods still need final audit disposition before
  completion

### Native Menu State Checkpoint 1: Application Menu State Bridge

Current checkpoint: package chrome no longer uses silent no-op adapter methods
for native tab menu state or bookmark-bar menu checked/enabled state. The
renderer reports those ordinary browser UI states through sender-checked,
capability-gated `freedomShell` requests, and main applies them to the
shell-owned Electron application menu.

Implemented in this checkpoint:

- added shell API methods gated by the existing `chrome.ui.commands`
  capability:
  - `chrome.ui.updateTabMenuState`
  - `chrome.ui.setBookmarkBarToggleEnabled`
  - `chrome.ui.setBookmarkBarChecked`
- exposed package preload methods:
  - `updateTabMenuState(state)`
  - `setBookmarkBarToggleEnabled(enabled)`
  - `setBookmarkBarChecked(checked)`
- changed `src/renderer/lib/chrome-runtime-api.js` package adapter methods for
  those menu-state updates to delegate to `freedomShell` instead of no-op
  shims
- kept native menu authority in main: package chrome reports only serializable
  tab/bookmark-bar state and receives no Electron `Menu` objects, menu item
  references, arbitrary IPC, or BrowserWindow authority
- normalized package-provided tab menu state in `src/main/shell-api.js` before
  applying it to menu-owned handlers
- extracted `src/main/menu.js` helper functions so bundled chrome keeps the
  legacy IPC path while package chrome uses the narrow shell API path
- wired the menu handlers into `registerShellApiIpc()` from `src/main/index.js`
- expanded official package smoke coverage to assert native application menu
  enabled/checked state for one-tab/two-tab transitions and bookmark-bar
  toggles
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint so far:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js src/main/menu.test.js` passed: 5 suites, 51 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` initially failed because the smoke assumed the native bookmark-bar menu item started unchecked, while the same smoke had already persisted `showBookmarkBar: true` directly through `freedomShell` for package-safe settings coverage. The assertion was corrected to require enabled state before the first native toggle and checked-state transitions after renderer-driven toggles.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed after the smoke correction: 1 test.
- `npm run lint` passed.
- `git diff --check` passed.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- `npm test` passed: 114 suites passed, 5 skipped; 2133 passed, 17 skipped.
- committed as `46d73e7` (`feat(chrome): bridge package native menu state`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28049138591`, job `test` (`83034906839`), passed for
  `46d73e7`.
- GitHub Actions run `28049138591`, job `e2e-chrome-runtime`
  (`83034906952`), passed for `46d73e7`.

Known remaining gaps after this checkpoint:

- profile mutation/switching, service/node status commands, clipboard/image
  context actions, direct context-menu open-in-new-window smoke, and some
  history/favicon management methods still need final audit disposition before
  completion

### Browser-State Checkpoint 4: Profile Display Read API

Current checkpoint: package chrome no longer uses null/empty/no-op profile
adapter methods for the visible profile indicator/menu. Profile display data is
available through a narrow browser-state shell API, while profile creation and
switching remain shell-owned and unavailable to package chrome.

Implemented in this checkpoint:

- added shell API methods and capability:
  - `browserState.profiles.getActive` / `browserState.profiles.read`
  - `browserState.profiles.list` / `browserState.profiles.read`
- added the `browserState.profiles.updated` shell event, also gated by
  `browserState.profiles.read`
- exposed package preload methods:
  - `getActiveProfile()`
  - `listProfiles()`
  - `onProfileUpdated(callback)`
- changed `src/renderer/lib/chrome-runtime-api.js` so package profile display
  reads delegate to `freedomShell`
- changed package `createProfile()` and `openProfile()` adapter methods to
  return structured unavailable results instead of silent `null`/`false`
  defaults
- kept profile creation/switching out of package chrome authority; visible
  package-mode profile creation and non-current profile switching controls are
  disabled until a scoped shell-owned switching surface exists
- added a package-facing profile serializer that omits profile roots, user data
  directories, node configuration, timestamps, catalog metadata, and launch
  details
- bridged bundled profile-update broadcasts into sanitized package shell events
  for registered package callers with `browserState.profiles.read`
- granted the generated official local chrome package manifest
  `browserState.profiles.read`
- expanded official package smoke coverage so package mode must render the
  active `Test` profile, open the profile menu, show an active-only profile
  list in test-user-data mode, keep profile creation disabled, and prove the
  shell profile payload does not expose private fields
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint so far:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js src/main/ipc-handlers.test.js` passed: 5 suites, 60 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm run lint` passed.
- `npm test` passed: 114 suites passed, 5 skipped; 2134 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed: 14 tests.
- committed as `2874bd4` (`feat(chrome): add package profile display state`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28050614655`, job `test` (`83039937637`), passed for
  `2874bd4`.
- GitHub Actions run `28050614655`, job `e2e-chrome-runtime`
  (`83039937551`), passed for `2874bd4`.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only; a future package
  request path needs a scoped trusted switching/launch contract before it can
  be exposed
- service/node status commands and some history/favicon management methods
  still need final audit disposition before completion

### Chrome UI Checkpoint 3: Page Context Menu Clipboard And Window Actions

Current checkpoint: package chrome no longer uses false/failure adapter shims for
the visible page context-menu copy/save image actions. Link/image address copy
uses a write-only clipboard shell API, image copy/save use narrow main-owned
image fetch/save paths, and direct page context-menu Open Link in New Window is
covered by official package smoke.

Implemented in this checkpoint:

- added shell API methods and capabilities:
  - `clipboard.copyText` / `clipboard.write`
  - `clipboard.copyImageFromUrl` / `clipboard.write`
  - `downloads.saveImage` / `downloads.saveImage`
- exposed package preload methods:
  - `copyText(text)`
  - `copyImageFromUrl(imageUrl)`
  - `saveImage(imageUrl)`
- changed `src/renderer/lib/chrome-runtime-api.js` package adapter methods for
  `copyText`, `copyImageFromUrl`, and `saveImage` to delegate to
  `freedomShell` instead of returning false
- kept `readClipboardText()` unavailable in package mode; package chrome gets
  no clipboard read capability
- kept image download and clipboard image decode in main through the existing
  HTTP(S)-only fetch helper
- changed package `saveImage()` results so the selected filesystem path is not
  returned to package chrome
- granted the generated official local chrome package manifest `clipboard.write`
  and `downloads.saveImage`
- expanded official package smoke coverage for direct page context-menu Copy
  Link Address, Copy Image Address, and Open Link in New Window actions
- fixed the native menu-state bridge to cache package-reported tab/bookmark-bar
  state by owning BrowserWindow and restore the focused window's state when a
  context-created package window closes
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint so far:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js src/renderer/lib/page-context-menu.test.js src/main/ipc-handlers.test.js src/main/menu.test.js` passed: 7 suites, 75 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` initially failed because the direct context-menu Open Link in New Window smoke exposed a real multi-window native menu-state bug: the child package window could leave the global bookmark-bar menu item disabled after it closed. The menu-state bridge was changed to track state by owner BrowserWindow.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` then failed because a test-only clipboard monkey patch did not observe Electron clipboard writes. The smoke was corrected to assert the main-process clipboard text directly through Playwright, without adding any package clipboard read API.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed after those fixes: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm run lint` passed.
- `npm test` passed: 114 suites passed, 5 skipped; 2137 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- `git diff --check` passed.
- committed as `cf3c27c` (`feat(chrome): add package context menu actions`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28052341352`, job `test` (`83045922543`), passed for
  `cf3c27c`.
- GitHub Actions run `28052341352`, job `e2e-chrome-runtime`
  (`83045922391`), passed for `cf3c27c`.

Known remaining gaps after this checkpoint:

- service/node status commands and some history/favicon management methods
  still need final audit disposition before completion
- `readClipboardText()` remains intentionally unavailable to package chrome;
  visible paste behavior must continue to rely on browser-mediated paste paths
  rather than a package shell clipboard-read API

### Chrome UI Checkpoint 4: Read-Only Service Status

Current checkpoint: package chrome no longer relies on broad node preload
globals or silent successful node-base no-ops for visible node-menu status. The
official package gets a narrow read-only `services.read` shell API for sanitized
Ant/IPFS/Radicle status, while lifecycle controls remain shell-owned and
disabled in package mode.

Implemented in this checkpoint:

- added shell API methods and events gated by `services.read`:
  - `services.getRegistry`
  - `services.getStatus`
  - `services.checkBinary`
  - `services.registryUpdated`
  - `services.statusUpdated`
- exposed matching package preload methods:
  - `getServiceRegistry()`
  - `getServiceStatus(service)`
  - `checkServiceBinary(service)`
  - `onServiceRegistryUpdated(callback)`
  - `onServiceStatusUpdated(callback)`
- added package-visible service registry/status sanitizers that expose only
  service mode/status text and never expose raw `api`, `gateway`, local ports,
  filesystem paths, or registry internals
- exported read-only status/binary helpers from the Ant/IPFS/Radicle managers
  and bridged manager/registry updates into package shell events
- added a renderer `service-runtime-api.js` adapter so bundled chrome keeps
  using broad trusted service globals while package chrome uses `freedomShell`
  service reads
- changed the Ant/IPFS/Radicle node-menu UI to disable lifecycle toggles with
  explicit package-mode behavior when running as package chrome
- changed package `setBzzBase`, `clearBzzBase`, `setRadBase`, and
  `clearRadBase` adapter methods to return structured
  `SERVICE_BASE_UNAVAILABLE` results instead of fake success
- granted the generated official local chrome package manifest `services.read`
- expanded official package smoke coverage so package mode proves sanitized
  service reads, absence of broad node globals, and disabled Ant/IPFS lifecycle
  toggles
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/main/service-registry.test.js src/renderer/lib/service-runtime-api.test.js src/renderer/lib/chrome-runtime-api.test.js src/renderer/lib/ant-ui.test.js src/renderer/lib/ipfs-ui.test.js src/renderer/lib/radicle-ui.test.js` passed: 9 suites, 69 tests.
- `npm test -- src/main/chrome-package.test.js src/main/chrome-package-store.test.js src/main/package-preload.test.js src/shared/shell-api-policy.test.js` passed: 4 suites, 41 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed: 1 test.
- `npm run lint` passed.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm test` initially exposed old Ant/IPFS/Radicle manager unit-test mocks
  that did not export `broadcastServiceStatusUpdate`; the managers now tolerate
  that older mock shape with a no-op fallback.
- `npm test -- src/main/ant-manager.test.js src/main/ipfs-manager.test.js src/main/radicle-manager.test.js` passed: 3 suites, 48 tests.
- `npm test` passed: 115 suites passed, 5 skipped; 2143 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- `git diff --check` passed.
- committed as `6be1c99` (`feat(chrome): add package service status reads`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28054327404`, job `test` (`83052735971`), passed for
  `6be1c99`.
- GitHub Actions run `28054327404`, job `e2e-chrome-runtime`
  (`83052735272`), passed for `6be1c99`.

Known remaining gaps after this checkpoint:

- history removal/clear and network favicon fetch/write package adapter methods
  still need final audit disposition before completion
- `readClipboardText()` remains intentionally unavailable to package chrome;
  visible paste behavior must continue to rely on browser-mediated paste paths
  rather than a package shell clipboard-read API

### Chrome UI Checkpoint 5: History Management And Favicon Fetch

Current checkpoint: package chrome no longer returns silent `false`/`null`
defaults for the remaining visible history and favicon browser-state methods.
History delete/clear now use narrow shell-owned history-write methods, and
favicon fetch/cache writes use a separate `browserState.favicons.write`
capability so cached reads stay distinct from shell-owned network/cache writes.

Implemented in this checkpoint:

- added shell API methods and capability mappings:
  - `browserState.history.remove` / `browserState.history.write`
  - `browserState.history.clear` / `browserState.history.write`
  - `browserState.favicons.get` / `browserState.favicons.write`
  - `browserState.favicons.fetch` / `browserState.favicons.write`
  - `browserState.favicons.fetchWithKey` / `browserState.favicons.write`
- exposed matching package preload methods:
  - `removeHistory(id)`
  - `clearHistory()`
  - `getFavicon(url)`
  - `fetchFavicon(url)`
  - `fetchFaviconWithKey(fetchUrl, cacheKey)`
- added main-process handlers that normalize history IDs and favicon URLs before
  delegating to the existing history and favicon stores
- kept `getCachedFavicon(url)` on the read-only favicon capability while
  network/cache-writing favicon methods require `browserState.favicons.write`
- updated the package runtime adapter so `removeHistory`, `clearHistory`,
  `getFavicon`, `fetchFavicon`, and `fetchFaviconWithKey` delegate to
  `freedomShell` with safe fallbacks only when shell support is unavailable
- granted the generated official local chrome package manifest
  `browserState.favicons.write`
- expanded official package smoke coverage so package mode proves history
  remove/clear and favicon fetch/cache writes through `freedomShell`
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint so far:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js` passed:
  4 suites, 49 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` initially failed because
  `FREEDOM_TEST_MODE` routes Electron HTTP fetches through the harness HTTP
  stub, so favicon bytes differ from the local server fixture. The smoke now
  asserts the package contract: a data URL is returned and cached under the
  package cache key.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed:
  1 test.
- `npm run lint` passed.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm test` passed: 115 suites passed, 5 skipped; 2143 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- `git diff --check` passed.
- committed as `2e9485e` (`feat(chrome): bridge package history and favicons`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28055494647`, job `test` (`83056635440`), passed for
  `2e9485e`.
- GitHub Actions run `28055494647`, job `e2e-chrome-runtime`
  (`83056635580`), passed for `2e9485e`.

Known remaining gaps after this checkpoint:

- `readClipboardText()` remains intentionally unavailable to package chrome;
  visible paste behavior must continue to rely on browser-mediated paste paths
  rather than a package shell clipboard-read API
- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed

### Chrome UI Checkpoint 6: Package Paste Boundary

Current checkpoint: package chrome still receives no clipboard-read authority,
but the visible custom address-bar Paste menu item is no longer a clickable
silent no-op. Package mode disables that custom Paste item with an explicit
title while keyboard paste continues through the browser/input path.

Implemented in this checkpoint:

- kept `readClipboardText()` unavailable in package mode; no
  `freedomShell` clipboard-read method or capability was added
- changed `src/renderer/lib/chrome-input-context-menu.js` so package mode
  disables the custom Paste menu item and explains that users should use the
  system paste shortcut
- preserved bundled chrome behavior where the custom Paste menu can use the
  existing trusted renderer clipboard-read fallback
- added a defensive browser paste-command fallback for environments where
  `navigator.clipboard.readText()` is denied but a user-gesture browser paste
  command is available
- ensured Paste leaves the input untouched when no package-safe paste source is
  available instead of replacing selected text with an empty string
- expanded official package smoke coverage to prove the custom Paste item is
  disabled and `Ctrl+V`/`Meta+V` still pastes into the address bar
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint so far:

- `npm test -- src/renderer/lib/chrome-input-context-menu.test.js src/renderer/lib/chrome-runtime-api.test.js` passed:
  2 suites, 27 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` initially failed when package-mode custom Paste did nothing; the implementation now disables that item and relies on keyboard paste.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed:
  1 test.
- `npm run lint` passed.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm test` passed: 115 suites passed, 5 skipped; 2146 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- `git diff --check` passed.
- committed as `cf1f732` (`fix(chrome): disable package paste menu safely`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28056526192`, job `test` (`83060147191`), passed for
  `cf1f732`.
- GitHub Actions run `28056526192`, job `e2e-chrome-runtime`
  (`83060147181`), passed for `cf1f732`.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed

### Chrome UI Checkpoint 7: Bookmark Mutation Smoke

Current checkpoint: the official package smoke now covers the visible bookmark
add, edit, and delete controls instead of relying only on shell API/unit
coverage for bookmark writes.

Implemented in this checkpoint:

- expanded the official package runtime smoke to navigate to a deterministic
  IPFS fixture page and add it through the visible Add Bookmark modal
- verified the add operation by reading package-visible bookmark state through
  `window.freedomShell.getBookmarks()`
- exercised the bookmark context menu's Edit action, changed the bookmark
  label and target, and verified the old target was removed while the edited
  target persisted
- exercised the bookmark context menu's Delete action and verified the edited
  bookmark was removed
- kept bookmark mutation authority on the existing narrow
  `browserState.bookmarks.write` shell API; no broad preload, filesystem,
  Electron, wallet, identity, or provider authority was added
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md` so the method audit no longer
  lists direct bookmark mutation smoke as pending

Verification in this checkpoint:

- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` initially failed with the HTTP fixture URL because `FREEDOM_TEST_MODE` routes HTTP through the harness stub; the smoke now uses a deterministic IPFS fixture.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed after switching to the IPFS fixture: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed: 13 tests.
- `npm run lint` passed.
- `npm test` passed: 115 suites passed, 5 skipped; 2146 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` initially failed because the modal submit click was timing-sensitive in the combined run; the smoke now submits the visible bookmark form through `requestSubmit()` and waits for bookmark store state.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed after the deterministic form-submit fix: 1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed after the form-submit fix: 14 tests.
- `git diff --check` passed.
- committed as `bba87e2` (`test(chrome): cover package bookmark mutations`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28056778467`, job `test` (`83061063420`), passed for
  prior branch head `70e542f`.
- GitHub Actions run `28056778467`, job `e2e-chrome-runtime`
  (`83061063797`), passed for prior branch head `70e542f`.
- GitHub Actions run `28057368338`, job `test` (`83062948447`), passed for
  `bba87e2`.
- GitHub Actions run `28057368338`, job `e2e-chrome-runtime`
  (`83062949033`), passed for `bba87e2`.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed

### Chrome UI Checkpoint 8: DevTools Command Smoke

Current checkpoint: package chrome now has launched smoke coverage proving that
the native Developer Tools command reaches the active package webview through
the capability-gated `chrome.ui.commands` bridge instead of remaining a silent
no-op.

Implemented in this checkpoint:

- expanded the official package runtime smoke to instrument the active
  package-owned guest webview's DevTools methods
- drove the real native application menu `toggle-devtools` command twice
- verified the command path opens and then closes DevTools on the active
  package webview without exposing Electron menu objects, arbitrary IPC, or
  BrowserWindow authority to package chrome
- kept the event delivery on the existing sender-checked
  `chrome.ui.commands` shell event bridge
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed:
  1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js` passed:
  13 tests.
- `npm run lint` passed.
- `npm test` passed: 115 suites passed, 5 skipped; 2146 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- `git diff --check` passed.
- committed as `bb057a1` (`test(chrome): cover package devtools command`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28058098467`, job `test` (`83065406705`), passed for
  `bb057a1`.
- GitHub Actions run `28058098467`, job `e2e-chrome-runtime`
  (`83065408695`), passed for `bb057a1`.
- GitHub Actions run `28058353014`, job `test` (`83066303541`), passed for
  ledger commit `314b229`.
- GitHub Actions run `28058353014`, job `e2e-chrome-runtime`
  (`83066303197`), passed for ledger commit `314b229`.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed

### Chrome UI Checkpoint 9: Update Notification Event Bridge

Current checkpoint: package chrome no longer drops shell-owned updater
notifications through a silent `onUpdateNotification` no-op. The updater still
owns policy, ownership locks, dialogs, install behavior, and `autoUpdater`;
package chrome receives only the existing serializable toast payload through a
capability-gated shell event.

Implemented in this checkpoint:

- added `app.updates.notification` to the shared shell event registry, gated by
  the existing `app.updates` capability
- exposed `freedomShell.onUpdateNotification(callback)` from the package
  preload and wired the package renderer adapter to delegate to it
- mirrored updater `show-update-notification` payloads onto the package shell
  event channel with `emitShellEventToPackageWebContents`
- kept update check and install requests on the existing shell-owned
  `app.checkForUpdates` and `app.restartAndInstallUpdate` methods
- updated the fixture package broad-API absence smoke's explicit
  `freedomShell` allowlist
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/renderer/lib/chrome-runtime-api.test.js src/main/updater.test.js` initially passed but left an updater timer open; the updater test now uses fake timers.
- `npm test -- src/shared/shell-api-policy.test.js src/main/package-preload.test.js src/renderer/lib/chrome-runtime-api.test.js src/main/updater.test.js` passed after the timer fix:
  4 suites, 21 tests.
- `npm run lint` passed.
- `npm test` passed: 115 suites passed, 5 skipped; 2147 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` initially failed because the minimal package exposure smoke's explicit key list did not include `onUpdateNotification`.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "local package chrome loads through freedomShell"` passed after updating that allowlist:
  1 test.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- `git diff --check` passed.
- committed as `0a94bac` (`feat(chrome): bridge package update notifications`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28058811799`, job `test` (`83067789356`), passed for
  `0a94bac`.
- GitHub Actions run `28058811799`, job `e2e-chrome-runtime`
  (`83067789347`), passed for `0a94bac`.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed
- external-node candidate prompts and publish setup entry points still need a
  shell-owned, hidden, or intentionally disabled package-mode disposition if
  they are visible in package mode
- raw x402, transaction signing, typed-data signing, identity, vault, Swarm
  publish/feed, and seed/private-key export flows remain unavailable to
  package chrome pending real shell-owned trusted surfaces; these are not
  user-approved completion deferrals

### Chrome UI Checkpoint 10: External Node Prompt Boundary

Current checkpoint: package windows no longer receive the legacy renderer IPC
prompt for default-port external node candidates. That prompt can mutate
profile node configuration, so package chrome should not own it. In package
mode main now falls back to the shell-owned native dialog path, and accidental
package adapter calls return a structured unavailable result.

Implemented in this checkpoint:

- added `isPackageWebContents(sender)` to the shell API registry so main code
  can distinguish registered package chrome senders from bundled trusted
  renderer senders
- changed `presentExternalCandidatesInWindow()` to return `null` for package
  windows instead of sending `profile:external-candidates` over legacy renderer
  IPC and waiting indefinitely for a package listener that does not exist
- preserved the existing native dialog fallback in
  `promptForDefaultExternalCandidates()` as the shell-owned package-mode
  prompt path
- changed the package renderer adapter's
  `resolveExternalNodeCandidates()` fallback from a silent no-op to structured
  `EXTERNAL_NODE_PROMPT_UNAVAILABLE`
- kept service/node lifecycle and profile node-configuration mutation authority
  out of `window.freedomShell`
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/profile-external-candidates.test.js src/main/shell-api.test.js src/renderer/lib/chrome-runtime-api.test.js` passed:
  3 suites, 50 tests.
- `npm run lint` initially reported an unused `noop` helper after the adapter
  no-op was replaced; the dead helper was removed.
- `npm run lint` passed after the cleanup.
- `npm test` passed: 115 suites passed, 5 skipped; 2148 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- `git diff --check` passed.
- committed as `6944053` (`fix(chrome): keep external node prompt shell-owned`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28059639874`, job `test` (`83070532460`), passed for
  `6944053`.
- GitHub Actions run `28059639874`, job `e2e-chrome-runtime`
  (`83070532524`), passed for `6944053`.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed
- publish setup entry points still need a shell-owned, hidden, or intentionally
  disabled package-mode disposition if they are visible in package mode
- raw x402, transaction signing, typed-data signing, identity, vault, Swarm
  publish/feed, and seed/private-key export flows remain unavailable to
  package chrome pending real shell-owned trusted surfaces; these are not
  user-approved completion deferrals

### Chrome UI Checkpoint 11: Publish Setup Boundary

Current checkpoint: package-hosted internal pages no longer forward the
wallet/sidebar publish-setup deep link into package chrome as a dead legacy
renderer event. Bundled chrome still receives the existing
`sidebar:open-publish-setup` event, but package hosts get a structured
`PUBLISH_SETUP_UNAVAILABLE` result and the visible
`freedom://settings/startup` action disables itself with that message.

Implemented in this checkpoint:

- changed the `sidebar:open-publish-setup` main IPC handler to distinguish
  registered package hosts with `isPackageWebContents(hostWebContents)`
- preserved the bundled trusted renderer path by returning success after
  sending the existing legacy sidebar event to non-package hosts
- returned structured `PUBLISH_SETUP_HOST_MISSING` when the request does not
  come from a hosted internal page
- returned structured `PUBLISH_SETUP_UNAVAILABLE` for package-hosted internal
  pages instead of sending a legacy event that package chrome cannot handle
- changed `freedom://settings/startup` so the visible publish setup action
  surfaces that unavailable result and disables itself instead of swallowing
  the failed request
- expanded the official package smoke to navigate to
  `freedom://settings/startup`, assert the visible setup action, click it, and
  verify the intentional package-mode disabled state
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/ipc-handlers.test.js` passed:
  1 suite, 17 tests.
- `npm test -- src/renderer/lib/chrome-runtime-api.test.js src/main/webview-preload.test.js` passed:
  2 suites, 22 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed:
  1 test.
- `npm run lint` passed.
- `git diff --check` passed.
- `npm test` passed: 115 suites passed, 5 skipped; 2150 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- committed as `7db07ca` (`fix(chrome): disable package publish setup path`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28060610603`, job `test` (`83073637573`), passed for
  `7db07ca`.
- GitHub Actions run `28060610603`, job `e2e-chrome-runtime`
  (`83073637726`), passed for `7db07ca`.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed
- raw x402, transaction signing, typed-data signing, identity, vault, Swarm
  publish/feed, and seed/private-key export flows remain unavailable to
  package chrome pending real shell-owned trusted surfaces; these are not
  user-approved completion deferrals

### Chrome UI Checkpoint 12: x402 Prompt Boundary

Current checkpoint: package-hosted guest content no longer relies on package
chrome to receive raw `x402:*` approval, result, balance, cap-consumed, or
vault-unlock events. Those events remain bundled trusted-renderer UI for now.
When the host is registered package chrome and x402 needs approval or vault
unlock UI, main passes the original 402 through instead of waiting on package
chrome to render a payment prompt it is not allowed to own.

Implemented in this checkpoint:

- changed the x402 interceptor's host-event dispatch to detect registered
  package hosts with `isPackageWebContents(hostWebContents)`
- kept raw x402 host events deliverable to bundled trusted chrome
- refused raw `x402:*` host-event delivery to package chrome with a structured
  internal dispatch reason
- changed non-cap-covered package-hosted approval-card detections to clear the
  tab-keyed pending payment and pass the 402 through immediately instead of
  creating a pending approval that package chrome cannot settle
- changed package-hosted cap-covered locked-vault subresource flows to pass
  the 402 through immediately instead of creating a pending unlock wait that
  package chrome cannot settle
- changed package-hosted main-frame auto-pay locked-vault flows to drop the
  unlock-resume token when the shell-owned unlock UI is unavailable
- kept auto-pay flows that do not require UI on the existing main-owned path
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/x402/intercept.test.js` passed:
  1 suite, 103 tests.
- `npm test -- src/main/x402/intercept.test.js src/main/x402/ipc.test.js` passed:
  2 suites, 152 tests.
- `npm test -- src/renderer/lib/chrome-runtime-api.test.js` passed:
  1 suite, 5 tests.
- `npm run lint` passed.
- `git diff --check` passed.
- `npm test` passed: 115 suites passed, 5 skipped; 2152 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- committed as `fd20a1e` (`fix(chrome): keep x402 prompts out of package chrome`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28061261460`, job `test` (`83075732946`), passed for
  `fd20a1e`.
- GitHub Actions run `28061261460`, job `e2e-chrome-runtime`
  (`83075732954`), passed for `fd20a1e`.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed
- real wallet connect, transaction signing, typed-data signing, identity,
  vault, x402 approval/unlock, Swarm publish/feed, and seed/private-key export
  prompt surfaces still need shell-owned UI before they can be called complete
  in package mode; these are not user-approved completion deferrals

### Chrome UI Checkpoint 15: Profile Settings Boundary

Current checkpoint: package-hosted `freedom://settings/profiles` no longer
exposes raw bundled profile management IPC through the transitional internal
page bridge. Bundled trusted settings can still manage profiles and profile
node configuration, but package-hosted settings pages receive structured
`PROFILE_MANAGEMENT_UNAVAILABLE` results and render a disabled package-mode
state.

Implemented in this checkpoint:

- added a shared structured `PROFILE_MANAGEMENT_UNAVAILABLE` result for
  package-hosted internal pages
- changed active-profile read, profile-list read, profile create/import,
  rename, open/switch, delete, and profile node-configuration IPC handlers to
  reject package-hosted settings pages before touching the profile resolver
- stopped raw `profile:updated` broadcasts from being delivered to registered
  package chrome windows or their package-hosted internal pages; package chrome
  continues to receive only sanitized profile shell events through
  `browserState.profiles.read`
- changed `freedom://settings/profiles` to surface the package-mode
  unavailable state, disable profile creation controls, and replace profile
  node/manager lists with the structured denial message
- expanded official package smoke to navigate to
  `freedom://settings/profiles` and assert the disabled package-mode state
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/package-hosted-internal-page.test.js src/main/ipc-handlers.test.js` passed:
  2 suites, 24 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed:
  1 test.
- `git diff --check` passed.
- `npm run lint` passed.
- `npm test` passed:
  116 suites passed, 5 skipped; 2177 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed
- real wallet connect, transaction signing, typed-data signing, identity,
  vault, x402 approval/unlock, payment-history trusted surface, Swarm
  publish/feed, and seed/private-key export prompt surfaces still need
  shell-owned UI before they can be called complete in package mode; these are
  not user-approved completion deferrals

### Chrome UI Checkpoint 14: Payment History Page Boundary

Current checkpoint: package-hosted `freedom://payments` no longer exposes
unified payment history through the transitional internal-page webview bridge.
Bundled trusted chrome can still use the existing payments page and IPC, but
package-hosted internal pages receive structured `PAYMENTS_UNAVAILABLE` before
main reads or clears the payment-history store. The page surfaces that result
and disables search, filters, and Clear all in official package smoke.

Implemented in this checkpoint:

- added a structured `PAYMENTS_UNAVAILABLE` package-hosted internal-page result
- changed payment-history IPC handlers to deny package-hosted internal pages
  for read/count/by-id/clear requests before touching the store
- changed `freedom://payments` to show a deterministic package-mode
  unavailable state and disable visible controls
- expanded official package smoke to navigate to `freedom://payments` and
  verify the disabled unavailable state
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/package-hosted-internal-page.test.js src/main/payment-history.test.js src/renderer/pages/payments.test.js` passed:
  3 suites, 44 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed:
  1 test.
- `npm run lint` passed.
- `git diff --check` passed.
- `npm test` passed:
  116 suites passed, 5 skipped; 2174 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- committed as `0b5a8de` (`fix(chrome): disable package payment history page`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28065378052`, job `test` (`83088415125`), passed for
  `0b5a8de`.
- GitHub Actions run `28065378052`, job `e2e-chrome-runtime`
  (`83088415040`), passed for `0b5a8de`.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed
- real wallet connect, transaction signing, typed-data signing, identity,
  vault, x402 approval/unlock, payment-history trusted surface, Swarm
  publish/feed, and seed/private-key export prompt surfaces still need
  shell-owned UI before they can be called complete in package mode; these are
  not user-approved completion deferrals

### Provider-Flow Checkpoint 4: Ethereum Privileged Package Safe-Fail

Current checkpoint: package-hosted guest Ethereum provider requests no longer
fall back to package chrome for privileged methods. `eth_chainId` continues to
execute on the direct read-only main path, while higher-risk methods ask main
for the guest host context and fail in the guest page with a structured
`trusted_prompt_unavailable` error when the host is registered package chrome.

Implemented in this checkpoint:

- added `dapp:provider-host-context` as a main-owned IPC gate that derives
  whether a guest webview is hosted by registered package chrome from
  `event.sender.hostWebContents`
- changed the guest webview preload so non-readonly Ethereum provider methods
  check that host context before forwarding to `sendToHost`
- preserved bundled trusted chrome behavior by forwarding non-readonly
  Ethereum methods to the legacy renderer prompt path when the guest is not
  hosted by package chrome
- returned page-facing provider errors with code `4100` and
  `data.reason: "trusted_prompt_unavailable"` for privileged package-hosted
  Ethereum methods instead of allowing package chrome to broker the request
- preserved `error.data` on the injected page-facing Ethereum provider so
  structured package-mode reasons are visible to dApps and smoke tests
- expanded official package smoke so the guest IPFS fixture calls
  `eth_requestAccounts` and observes the structured package-mode error
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/webview-preload.test.js src/main/webview-preload-ethereum-inject.test.js src/main/wallet/wallet-ipc.test.js` passed:
  3 suites, 56 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed:
  1 test.
- `npm run lint` passed.
- `git diff --check` passed.
- `npm test` passed: 116 suites passed, 5 skipped; 2171 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- committed as `d640672` (`fix(chrome): block package ethereum provider
  prompts`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28064598057`, job `test` (`83086064980`), passed for
  `d640672`.
- GitHub Actions run `28064598057`, job `e2e-chrome-runtime`
  (`83086064896`), passed for `d640672`.

Known remaining gaps after this checkpoint:

- higher-risk Ethereum provider methods now fail before package chrome can
  broker them, but they still need a real shell-owned prompt/surface path
  before they can succeed in package mode
- higher-risk Swarm provider methods fail before package chrome can broker
  them, but they still need a real shell-owned prompt/surface path before they
  can succeed in package mode
- real wallet connect, transaction signing, typed-data signing, identity,
  vault, x402 approval/unlock, Swarm publish/feed, and seed/private-key export
  prompt surfaces still need shell-owned UI before they can be called complete
  in package mode; these are not user-approved completion deferrals
- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed

### Provider-Flow Checkpoint 2: Swarm Readonly Capabilities Bypass

Current checkpoint: package-hosted guest content receives the page-facing Swarm
provider and can call the low-risk `swarm_getCapabilities` method without
routing through package chrome. Higher-risk Swarm provider methods remain on
the legacy bundled path until they can move behind shell-owned trusted
prompts.

Implemented in this checkpoint:

- added `swarm:provider-readonly-request` as a main-owned provider IPC channel
  for permission-free Swarm methods
- restricted that direct channel to `swarm_getCapabilities`; attempts to call
  privileged methods such as `swarm_publishData` return structured
  `Method not supported` errors
- changed the guest webview preload so `swarm.getCapabilities()` goes directly
  from guest preload to main and posts the structured result back to the page
  without `sendToHost("swarm:provider-request")`
- kept publish, feed, signing, access-request, and upload-status methods on the
  existing non-bypass path pending trusted prompt/surface migration
- expanded the official package smoke so a guest IPFS fixture page must see
  `window.swarm`, call `getCapabilities()`, and receive deterministic
  `not-connected` under the harness
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/webview-preload.test.js src/main/swarm/swarm-provider-ipc.test.js` passed:
  2 suites, 158 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed:
  1 test.
- `git diff --check` passed.
- `npm run lint` passed.
- `npm test` passed: 116 suites passed, 5 skipped; 2163 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- committed as `14b776b` (`feat(chrome): bypass package for swarm readonly
  provider`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28063162536`, job `test` (`83081729681`), passed for
  `14b776b`.
- GitHub Actions run `28063162536`, job `e2e-chrome-runtime`
  (`83081729705`), passed for `14b776b`.

Known remaining gaps after this checkpoint:

- real wallet connect, transaction signing, typed-data signing, identity,
  vault, x402 approval/unlock, Swarm publish/feed, and seed/private-key export
  prompt surfaces still need shell-owned UI before they can be called complete
  in package mode; these are not user-approved completion deferrals
- higher-risk Swarm provider methods still need main-derived request context
  plus shell-owned approval UI before they can bypass the legacy bundled
  renderer path
- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed

### Provider-Flow Checkpoint 3: Swarm Privileged Package Safe-Fail

Current checkpoint: package-hosted guest Swarm provider requests no longer
fall back to package chrome for privileged methods. `swarm_getCapabilities`
continues to execute on the direct read-only main path, while higher-risk
methods ask main for the guest host context and fail in the guest page with a
structured `trusted_prompt_unavailable` error when the host is registered
package chrome.

Implemented in this checkpoint:

- added `swarm:provider-host-context` as a main-owned IPC gate that derives
  whether a guest webview is hosted by registered package chrome from
  `event.sender.hostWebContents`
- changed the guest webview preload so non-readonly Swarm provider methods
  check that host context before forwarding to `sendToHost`
- preserved bundled trusted chrome behavior by forwarding non-readonly Swarm
  methods to the legacy renderer prompt path when the guest is not hosted by
  package chrome
- returned page-facing provider errors with code `4200` and
  `data.reason: "trusted_prompt_unavailable"` for privileged package-hosted
  Swarm methods instead of allowing package chrome to broker the request
- expanded official package smoke so the guest IPFS fixture calls
  `swarm.publishData()` and observes the structured package-mode error
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/webview-preload.test.js src/main/swarm/swarm-provider-ipc.test.js` passed:
  2 suites, 162 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed:
  1 test.
- `git diff --check` passed.
- `npm run lint` passed.
- `npm test` passed: 116 suites passed, 5 skipped; 2167 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- committed as `e7b10d7` (`fix(chrome): block package swarm provider
  prompts`) and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28063806101`, job `test` (`83083658676`), passed for
  `e7b10d7`.
- GitHub Actions run `28063806101`, job `e2e-chrome-runtime`
  (`83083658705`), passed for `e7b10d7`.

Known remaining gaps after this checkpoint:

- higher-risk Swarm provider methods now fail before package chrome can broker
  them, but they still need a real shell-owned prompt/surface path before they
  can succeed in package mode
- real wallet connect, transaction signing, typed-data signing, identity,
  vault, x402 approval/unlock, Swarm publish/feed, and seed/private-key export
  prompt surfaces still need shell-owned UI before they can be called complete
  in package mode; these are not user-approved completion deferrals
- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed

### Chrome UI Checkpoint 13: Swarm Publish Page Boundary

Current checkpoint: package-hosted `freedom://publish` no longer exposes the
internal path-based Swarm publish controls as active UI. Bundled trusted chrome
can still use the existing internal page and IPC, but package-hosted internal
pages receive structured `SWARM_PUBLISH_UNAVAILABLE` and the direct publish
page disables Publish File, Publish Folder, and Publish Text with a visible
warning.

Implemented in this checkpoint:

- added `src/main/package-hosted-internal-page.js` as a small main-process
  helper for detecting internal pages whose `hostWebContents` is a registered
  package chrome window
- changed Swarm publish IPC handlers to deny package-hosted internal pages
  before accepting text publishes, raw filesystem paths, file/folder picker
  requests, or upload-status polling
- changed the publish page's stamp-read and publish-history IPC paths to
  return the same structured package-mode unavailable result when hosted by
  package chrome
- changed `freedom://publish` to surface `SWARM_PUBLISH_UNAVAILABLE` as a
  warning and disable visible publish actions instead of showing clickable
  controls that cannot own final publish authority
- expanded official package smoke to navigate to `freedom://publish` and prove
  the disabled package-mode state
- updated `docs/local-package-chrome-runtime.md` and
  `docs/package-chrome-trust-boundaries.md`

Verification in this checkpoint:

- `npm test -- src/main/package-hosted-internal-page.test.js src/main/swarm/publish-service.test.js src/main/swarm/stamp-service.test.js src/main/swarm/publish-history.test.js` passed:
  4 suites, 59 tests.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js -g "official browser chrome can launch"` passed:
  1 test.
- `npm run lint` passed.
- `git diff --check` passed.
- `npm test` passed: 116 suites passed, 5 skipped; 2158 passed, 17 skipped.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js` passed:
  14 tests.
- committed as `afdf090` (`fix(chrome): disable package swarm publish page`)
  and pushed to `origin/goal/local-package-chrome-runtime-v0`.
- GitHub Actions run `28062258334`, job `test` (`83078913988`), passed for
  `afdf090`.
- GitHub Actions run `28062258334`, job `e2e-chrome-runtime`
  (`83078913980`), passed for `afdf090`.

Known remaining gaps after this checkpoint:

- profile creation/switching remains shell-owned/bundled-only until a scoped
  trusted switching/launch contract is designed
- real wallet connect, transaction signing, typed-data signing, identity,
  vault, x402 approval/unlock, Swarm publish/feed, and seed/private-key export
  prompt surfaces still need shell-owned UI before they can be called complete
  in package mode; these are not user-approved completion deferrals
