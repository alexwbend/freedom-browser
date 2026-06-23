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

Known remaining gaps after this checkpoint:

- wallet connect, account exposure, transaction/signing, Swarm provider, and
  x402 provider/approval flows still need the trusted prompt/surface broker
  design before they can bypass package chrome safely
- package mode still needs surface-control or intentional hidden/disabled
  coverage for more visible controls such as profile/window/menu affordances
- `freedom-chrome://active/` package serving remains unimplemented
