# Local Package Chrome Runtime v3 Progress

Branch: `goal/local-package-chrome-runtime-v3`

Starting baseline: latest `origin/goal/local-package-chrome-runtime-v2`, known
at goal start as `6b2d519` (`docs(chrome): record v2 final verification`).

Prior baseline ledgers:

- `docs/agent-progress/local-package-chrome-runtime-v0.md`
- `docs/agent-progress/local-package-chrome-runtime-v1.md`
- `docs/agent-progress/local-package-chrome-runtime-v2.md`

Goal source spec:
`/root/codex/freedom-browser-goal6.md`.

## Checkpoint 1: Baseline And Adapter Inventory

Status: inventory recorded before adapter cleanup edits, as required by the v3
hard gate.

### Branch Setup

- Fetched `origin`.
- `origin/goal/local-package-chrome-runtime-v3` did not exist.
- Created local `goal/local-package-chrome-runtime-v3` from
  `origin/goal/local-package-chrome-runtime-v2` at
  `6b2d51932776d1d5a2a02f8db3b892836d47aef8`.

### Required Context Read

- `AGENTS.md`
- `docs/local-package-chrome-runtime.md`
- `docs/package-chrome-trust-boundaries.md`
- `docs/trusted-prompt-broker.md`
- `docs/agent-progress/local-package-chrome-runtime-v2.md`
- `eslint.config.js`
- `packages/official-browser-chrome/src/lib/chrome-runtime-api.js`
- `src/renderer/lib/chrome-runtime-api.js`
- `src/renderer/lib/chrome-runtime-api.test.js`
- `packages/official-browser-chrome/src/index.js`
- `packages/official-browser-chrome/src/lib/sidebar.js`
- `scripts/build-official-chrome-package.js`
- `scripts/check-official-chrome-boundary.js`
- `scripts/build-official-chrome-package.test.js`
- `test-e2e/chrome-package.spec.js`
- `test-e2e/chrome-smoke.spec.js`

### Current Adapter Inventory

Package and bundled chrome currently have separate copies of
`lib/chrome-runtime-api.js`, but both copies still include the same runtime
selection shape:

- `isPackageChromeRuntime()` checks
  `!runtimeWindow.electronAPI && !!runtimeWindow.freedomShell`.
- `getChromeRuntimeApi()` returns `runtimeWindow.electronAPI` when present.
- The package copy otherwise builds a `freedomShell`-backed adapter with
  structured unavailable results for shell-owned authority.

This remains runtime-safe because package windows do not receive `electronAPI`,
and package smoke already proves broad globals are absent. It is still source
impure because package source reasons about broad preload authority.

The current boundary guard catches direct `window.electronAPI` use but not
indirect package-source broad-preload fallback references such as:

- `runtimeWindow.electronAPI`
- `globalThis.electronAPI`
- destructuring like `{ electronAPI }`
- generic `electronAPI` token use in package source

There is also package-source naming residue: package modules use a local
variable named `electronAPI` for the narrow `getChromeRuntimeApi()` result.
Those call sites are package-safe at runtime, but once the boundary ratchet
rejects `electronAPI` token use in package source, they must be renamed to a
neutral package runtime name such as `runtimeApi`.

### First Cleanup Slice

Target 1 will make the package source free of `electronAPI` tokens without
changing visible behavior:

- Extend `scripts/check-official-chrome-boundary.js` so package source and
  generated output fail on `electronAPI` token use, including indirect broad
  preload fallback patterns.
- Keep existing raw IPC, main-process import, and v2 trusted-sidebar residue
  checks.
- Add Jest coverage proving the boundary guard catches indirect
  `electronAPI` patterns, not just `window.electronAPI`.
- Remove `electronAPI` fallback logic from
  `packages/official-browser-chrome/src/lib/chrome-runtime-api.js`.
- Rename package-source local adapter variables from `electronAPI` to
  `runtimeApi` or another neutral package runtime name.
- Add package-source adapter unit coverage or split existing coverage so the
  package-only adapter is tested directly.
- Keep `src/renderer/lib/chrome-runtime-api.js` and its existing bundled
  `electronAPI` behavior intact.

### Positive Coverage Plan

- Keep existing bundled adapter unit coverage in
  `src/renderer/lib/chrome-runtime-api.test.js` for `window.electronAPI`.
- Add focused unit coverage for
  `packages/official-browser-chrome/src/lib/chrome-runtime-api.js`, including:
  - `getChromeRuntimeApi()` returns the `freedomShell`-backed package adapter
  - `isPackageChromeRuntime()` reports package mode from `freedomShell`
  - `markPackageChromeReady()` calls `freedomShell.markReady()`
  - safe unavailable results remain intact
- Run focused adapter and boundary tests before commit.

### Remaining

- Read `docs/agent-playbooks/commit-messages.md` before the first commit.
- Implement boundary and unit ratchets.
- Implement package-only adapter cleanup and neutral package runtime naming.
- Run final local verification and GitHub target jobs.

## Checkpoint 2: Package Adapter Purity Ratchet

Status: implemented locally; ready to commit and push after this ledger update.

### Changes

- Extended `scripts/check-official-chrome-boundary.js` with a broad preload
  adapter token rule for `electronAPI`.
- Added boundary coverage proving the guard catches both direct
  `window.electronAPI` and indirect package-source fallback shapes such as
  `runtimeWindow.electronAPI`, `globalThis.electronAPI`, destructuring, and
  bare adapter token usage.
- Added package-source unit coverage in
  `packages/official-browser-chrome/src/lib/chrome-runtime-api.test.js`.
- Made `packages/official-browser-chrome/src/lib/chrome-runtime-api.js`
  package-only:
  - `isPackageChromeRuntime()` now derives package mode from `freedomShell`
  - `getChromeRuntimeApi()` can only return the `freedomShell`-backed package
    adapter
  - existing structured unavailable results remain intact
  - `markPackageChromeReady()` still calls `freedomShell.markReady()` and sets
    `document.body.dataset.packageReady`
- Renamed package-source local adapter variables from the old broad-preload
  name to `runtimeApi`.
- Left `src/renderer/lib/chrome-runtime-api.js` unchanged so bundled chrome
  still keeps its broad-preload adapter path.

### Verification

- `npm test -- scripts/build-official-chrome-package.test.js packages/official-browser-chrome/src/lib/chrome-runtime-api.test.js src/renderer/lib/chrome-runtime-api.test.js`
  passed:
  - 3 suites passed
  - 15 tests passed
- `npm run chrome:package:check-boundary` passed.
- `rg -n "\belectronAPI\b" packages/official-browser-chrome/src dist/chrome-packages/official-browser-chrome`
  returned no matches after the boundary build.
- `npm run lint` passed.
- `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js -g "bundled chrome starts|official browser chrome can launch as a local package"`
  passed:
  - bundled chrome smoke passed
  - official package chrome smoke passed
- `git diff --check` passed.

### Remaining

- Run full local verification:
  - `npm run chrome:package:check-boundary`
  - `npm run lint`
  - `npm test`
  - `xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js`
- Push final head and verify GitHub `test` and `e2e-chrome-runtime`.
