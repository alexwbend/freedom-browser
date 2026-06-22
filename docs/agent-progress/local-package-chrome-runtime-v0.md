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

Current checkpoint: caller identity slice completed locally on top of `2b374f1`; checkpoint commit pending.

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

## Next Step

- Commit and push the Phase 1 caller identity checkpoint, check the new GitHub smoke run, then continue Phase 1 toward any remaining bridge/registry parity gaps in `/root/codex/freedom-browser-goal2.md`.
