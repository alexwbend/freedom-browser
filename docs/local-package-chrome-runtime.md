# Local Package Chrome Runtime v0

Freedom Browser can run either the bundled browser chrome or an explicit local
development chrome package.

This is a development/runtime canary for the future Swarm-delivered chrome
roadmap. It is not a package installer, update channel, signing system, theme
runtime, or public third-party chrome ABI.

## Runtime Modes

### Bundled Chrome

Bundled chrome is the default and recovery path. Launching normally uses
`src/renderer/index.html`, the existing broad trusted preload, and `<webview>`
support:

```bash
npm start
```

The bundled path must keep working before and after any package-runtime change.
Use the launched smoke test as the guard:

```bash
xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js
```

### Local Package Chrome

Local package chrome is opt-in for one launch only. Use an absolute package
directory path:

```bash
FREEDOM_CHROME_PACKAGE_DIR="$PWD/test/fixtures/chrome-packages/minimal" npm start
```

The CLI flag is also supported and wins over the environment variable:

```bash
npm start -- --chrome-package="$PWD/test/fixtures/chrome-packages/minimal"
```

Local package chrome uses `src/main/package-preload.js`, disables `<webview>` by
default, and receives only `window.freedomShell`. The package window is created
with hardened preferences: context isolation on, Node integration off, remote
module off, web security on, insecure content disabled, experimental features
off, and package-owned `<webview>` support disabled unless the manifest opts
into the transitional guest-webview bridge described below.

## Manifest v0

The local package directory must contain `manifest.json`:

```json
{
  "manifestVersion": 1,
  "packageType": "browser-chrome",
  "packageId": "baby.freedom.chrome.fixture",
  "name": "Freedom Fixture Chrome",
  "version": "0.0.1",
  "entry": "index.html",
  "shellCompatibility": {
    "minShellApi": "0.1.0",
    "maxShellApi": "0.1.x"
  },
  "capabilities": ["shell.info", "shell.ready", "navigation.resolve", "tabs.read", "tabs.write"]
}
```

Validation is intentionally local and conservative:

- package path must be absolute
- manifest must be valid JSON
- `manifestVersion` must be `1`
- `packageType` must be `browser-chrome`
- package id, name, version, and entry are required strings
- shell API compatibility must include `minShellApi` and `maxShellApi`
- entry must be relative and resolve inside the package directory
- entry must exist and be a file
- capabilities, when declared, must be known shell capabilities
- `guestContent`, when declared, must be an object
- `guestContent.transitionalWebviews`, when declared, must be a boolean

Package selection is not persisted in v0.

## Transitional Guest Webviews

The local full-runtime phase may need to run the current bundled renderer as a
local package before the browser fully migrates to shell-owned guest views. To
support that bridge, a manifest can opt into package-created `<webview>` tags:

```json
{
  "guestContent": {
    "transitionalWebviews": true
  }
}
```

This flag only enables the Electron `<webview>` tag in the local package chrome
window. It does not let package code choose guest `webPreferences`, preload
scripts, Node integration, web security, popups, or insecure content behavior.
Main process code handles `will-attach-webview`, strips package-supplied guest
preference attributes, and applies the shell-owned guest preload and hardened
guest preferences unconditionally.

This is a transitional bridge for the local full-runtime work. The target
architecture remains shell-owned guest contents instead of arbitrary
package-owned `<webview>` creation.

## Official Local Chrome Smoke

The launched package smoke now builds a temporary official chrome package from
`src/renderer` during the test run. The generated manifest opts into
`guestContent.transitionalWebviews: true` and declares only the shell
capabilities needed for startup readiness and deterministic navigation
coverage.

In package mode, the renderer uses a local chrome runtime adapter instead of
receiving `window.electronAPI`. Bundled chrome still uses the broad trusted
preload. Package chrome receives safe defaults and no-op handlers for startup
only, calls `freedomShell.markReady()` after the initial tab is mounted, and
does not receive broad globals such as `electronAPI`, `internalPages`, wallet,
identity, provider, or permission surfaces. Wallet, identity, x402, publish,
and permission prompts remain trusted shell-owned surfaces or deferred work.

The official package smoke currently proves:

- the real renderer chrome loads as local package chrome
- package chrome receives `window.freedomShell` but not broad preload globals
- the initial tab and home page render
- the main menu and node menu open
- new tab, tab switch, and tab close work
- reload works on the package home page
- bare-domain, `http://`, and `https://` address-bar navigation go through the deterministic test harness
- direct `bzz://`, `ipfs://`, and `ipns://` address-bar navigation can load deterministic harness fixtures
- ENS/contenthash navigation can resolve through the narrow shell API, load a deterministic `ipfs://name.eth/` harness fixture, reject asserted transport mismatches, and route conflicts to the shell-owned interstitial
- Radicle `rad://` navigation routes to the deterministic disabled-integration interstitial in package mode
- `freedom://settings` resolves through the package renderer's internal-page fallback
- `freedom://home` and home-button navigation return to the package home page

Live Radicle node availability is not part of the deterministic package smoke;
the harness covers the parser and routing decision without depending on a
running Radicle network.

## Shell API v0

`window.freedomShell` is exposed as a frozen object. Current methods:

- `getInfo()`
- `resolveNavigationInput(input)`
- `resolveEns(name)`
- `invalidateEnsContent(name)`
- `markReady()`
- `getTabSnapshot()`
- `createTab(options)`
- `closeTab(tabId)`
- `activateTab(tabId)`
- `navigateTab(tabId, url)`
- `reloadTab(tabId)`
- `goHome(tabId)`
- `onTabCommandResult(callback)`
- `onTabSnapshotChanged(callback)`

`getInfo()` returns shell/package diagnostics: shell API version, runtime mode,
app version, platform, package id/name/version/source, declared capabilities,
fallback state, and caller package identity for shell requests. Caller identity
is path-free and includes package id, package type, name, version, source,
runtime mode, and declared capabilities.

`resolveNavigationInput(input)` proves package code crosses the shell bridge for
navigation parsing. The resolver deterministically classifies `http`, `https`,
bare domains, allowlisted `freedom://` pages, direct `bzz://`, `ipfs://`,
`ipns://`, ENS names, transport-aware ENS assertions such as
`bzz://name.eth`, and Radicle `rad:`/`rad://` inputs. It does not perform live
network availability checks or live ENS contenthash lookup in package preload
code; the shared navigation helper includes a deterministic ENS contenthash
decision helper for trusted shell/main integration tests.

`resolveEns(name)` and `invalidateEnsContent(name)` expose the shell-owned ENS
contenthash resolver to package chrome for real navigation. They do not expose
wallet, identity, provider, or arbitrary IPC authority. In test mode these calls
use the main-process harness fixtures so official package smoke coverage remains
deterministic and does not depend on live Ethereum RPC availability.

`markReady()` tells the shell that the package initialized. If a local package
does not call `markReady()` within the readiness timeout, Freedom creates a new
bundled chrome window and destroys the failed package window. The default
timeout is 5000 ms; tests can override it with
`FREEDOM_CHROME_PACKAGE_READY_TIMEOUT_MS`.

The tab methods are the first Phase 2 shell-owned tab contract. They expose a
serializable tab snapshot and validated tab command results for package chrome.
This contract is intentionally main-owned and does not yet migrate bundled
renderer tabs away from their current `<webview>` implementation.

`onTabCommandResult(callback)` subscribes to package-visible
`tabs.commandResult` events emitted after shell-owned tab commands complete. It
returns a cleanup function. Like the tab command methods, the event requires the
package to declare `tabs.write`.

`onTabSnapshotChanged(callback)` subscribes to `tabs.snapshotChanged` events
emitted when a successful tab command changes the shell-owned serializable tab
snapshot. It returns a cleanup function and requires `tabs.read`.

Every shell API request must come from a registered local package window and
must be allowed by the package manifest's declared capabilities:

- `shell.info` allows `getInfo()`
- `shell.ready` allows `markReady()`
- `navigation.resolve` allows `resolveNavigationInput(input)`, `resolveEns(name)`, and `invalidateEnsContent(name)`
- `tabs.read` allows `getTabSnapshot()`
- `tabs.write` allows tab command methods

Requests from unknown or destroyed senders fail closed, and missing
capabilities deny the method.

The shell API version, method names, capability names, and method-capability
registry live in `src/shared/shell-api-policy.js`. `package-preload.js` keeps a
small local copy of the channel/method strings because Electron runtime
preloads do not reliably support relative imports; unit tests enforce parity
with the shared contract.

`freedom://` resolution is allowlisted to the shared internal-page registry in
`src/shared/internal-pages.json`. Unknown internal pages are rejected instead of
being forwarded to package chrome.

The package preload must not expose broad first-party APIs such as
`electronAPI`, `wallet`, `identity`, `swarmProvider`, `swarmPermissions`, or
`dappPermissions`.

## Recovery

Freedom falls back to bundled safe chrome when:

- the package directory is missing
- the manifest is missing or malformed
- the manifest declares an incompatible shell API range
- the entry path escapes the package root
- the entry file is missing
- the package entry fails to load
- the package does not signal readiness

Recovery does not depend on Swarm, IPFS, ENS, or live network access.

## Verification

Focused unit tests:

```bash
npm test -- src/main/chrome-package.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/shared/navigation-input.test.js src/main/windows/mainWindow.test.js
```

Bundled chrome smoke:

```bash
xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js
```

Package-mode and fallback smoke:

```bash
xvfb-run -a npm run test:e2e -- test-e2e/chrome-package.spec.js
```

Bundled, fixture-package, official-package, and fallback smoke:

```bash
xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js test-e2e/chrome-package.spec.js
```

Full local gate:

```bash
npm run lint
npm test
xvfb-run -a npm run test:e2e
```

GitHub Actions runs the bundled/package chrome smoke specs in the Linux
`e2e-chrome-runtime` job. The job runs the smoke specs under Xvfb and uploads
`test-results/` and `playwright-report/` on failure.
