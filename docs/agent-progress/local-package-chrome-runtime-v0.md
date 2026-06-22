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

Current checkpoint: package-visible tab command result events passed locally and in GitHub target CI jobs in `47fb38e`.

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
- shell API tab commands now emit serializable command-result events after successful command completion
- updated the fixture package smoke to observe command-result events before `markReady()`

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

## Next Step

- Continue Phase 2 toward command completion events and executor bridging while keeping bundled chrome unchanged.
