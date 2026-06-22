# Local Package Chrome Runtime v0 Progress

## Current State

- Branch: `goal/local-package-chrome-runtime-v0`
- Starting commit: `7b39944`
- Current phase: WP0, bundled-chrome runtime smoke gate
- Goal brief: `/root/codex/freedom-browser-goal.md`
- Roadmap context: `/root/codex/swarm-chrome-roadmap.md`

## Last Verification

- `npm run test:e2e -- test-e2e/chrome-smoke.spec.js` failed on this server because Electron had no X display: `Missing X server or $DISPLAY`.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js` passed, 1 test.
- `npm run lint` passed after adding the smoke spec.
- `npm test` passed: 102 suites passed, 5 skipped; 2017 tests passed, 17 skipped.
- `xvfb-run -a npm run test:e2e` passed: 14 Playwright harness tests.
- Attempted `git push -u origin goal/local-package-chrome-runtime-v0` with a CI workflow update included; GitHub rejected the push because the OAuth token lacks `workflow` scope.

## Smoke Status

- Bundled chrome smoke: implemented in `test-e2e/chrome-smoke.spec.js`; passes under Xvfb locally.
- Package-mode smoke: not started.
- Fallback smoke: not started.
- GitHub/Xvfb smoke: not wired yet. Adding/updating `.github/workflows/ci.yml` is blocked by current push credentials lacking `workflow` scope.

## Decisions

- Start from clean `origin/main`; do not depend on the unavailable earlier local branch.
- Build the launched Electron bundled-chrome smoke gate before package runtime work.
- Keep WP0 deterministic with `FREEDOM_TEST_MODE=1`; live-network tests are not the guardrail for chrome initialization.
- Direct Electron E2E on this server requires Xvfb.

## Changed Files By Checkpoint

### WP0 Setup

- `docs/agent-progress/local-package-chrome-runtime-v0.md`

### WP0 Bundled Chrome Smoke

- `test-e2e/chrome-smoke.spec.js`

## Known Risks

- The smoke currently filters one test-induced WebView dom-ready race while probing guest page state.
- GitHub Actions smoke cannot be added with the current OAuth token because workflow-file updates require `workflow` scope.

## Next Step

- Amend the WP0 smoke gate commit without workflow changes, push the fixed task branch for continuity, then either get a workflow-scoped credential or ask the user to add the CI job before treating remote smoke verification as complete.
