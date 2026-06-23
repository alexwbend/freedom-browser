# Local Package Chrome Runtime v0

Freedom Browser can run the bundled browser chrome, an explicit local
development chrome package, or an explicitly installed cached chrome package.

This is a development/runtime canary for the future Swarm-delivered chrome
roadmap. The local package store described below is a deterministic
local/offline cache for the full-runtime work, not a public package
marketplace, signing system, theme runtime, or third-party chrome ABI.

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

### Cached Package Chrome

The shell can install a verified unpacked package into a local store under app
`userData` and launch the cached copy:

```bash
FREEDOM_CHROME_PACKAGE_INSTALL_DIR="$PWD/test/fixtures/chrome-packages/minimal" npm start
```

The CLI flag is also supported:

```bash
npm start -- --chrome-package-install="$PWD/test/fixtures/chrome-packages/minimal"
```

An installed package can be launched later without the source directory:

```bash
FREEDOM_CHROME_PACKAGE_CACHE=1 npm start
```

The equivalent CLI switch is:

```bash
npm start -- --chrome-package-cache
```

Normal launch with no package flags still uses bundled safe chrome. Direct
`FREEDOM_CHROME_PACKAGE_DIR` development packages are not persisted; only
`FREEDOM_CHROME_PACKAGE_INSTALL_DIR` / `--chrome-package-install` promotes a
package into the cache.

### Local Package Feed Chrome

A deterministic local feed file can advertise unpacked package versions and use
the same store activation path:

```bash
FREEDOM_CHROME_PACKAGE_FEED_FILE="$PWD/tmp/chrome-feed.json" npm start
```

The CLI flag is also supported:

```bash
npm start -- --chrome-package-feed="$PWD/tmp/chrome-feed.json"
```

Feed files are local JSON pointers. The current format is:

```json
{
  "feedVersion": 1,
  "packageId": "baby.freedom.chrome.fixture",
  "channel": "stable",
  "packages": [
    {
      "version": "0.1.0",
      "source": {
        "type": "directory",
        "path": "./chrome-v1"
      }
    },
    {
      "version": "0.2.0",
      "source": {
        "type": "directory",
        "path": "./chrome-v2"
      }
    }
  ]
}
```

Only `source.type: "directory"` is implemented for this phase. Relative source
paths resolve from the feed file directory. Archives remain optional future
work; the runtime does not add extraction dependencies.

On launch, the shell validates feed entries, selects the newest valid package
newer than the current cached package, installs it through the staged store
path, and launches the cached copy. If the feed file is missing, unavailable,
malformed, or advertises only corrupt/unusable packages, the shell launches the
current cached package when one is valid. If neither feed nor cache is usable,
bundled safe chrome is used.

This feed path is the local stand-in for future Swarm delivery. It does not use
live Swarm, Ant/Bee, IPFS, ENS, or Radicle network access.

### Independent Package Updates

The local feed path updates chrome packages independently of the Electron shell
updater. The shell version does not change during this flow: the feed advertises
a newer package version, the shell validates and stages the package into the
local store, atomically activates it, and launches it from the cached store.

`freedomShell.getInfo()` reports both versions so smoke tests and diagnostics
can prove the split:

- `appVersion` is the Electron shell/app version
- `chromePackage.version` is the active chrome package version
- `chromePackage.source: "store"` means the package was installed and launched
  from the local cache

The local feed smoke covers first install, update from one package version to a
newer package version while `appVersion` remains unchanged, offline launch from
the cached updated package, corrupt advertised update fallback, readiness-timeout
rollback, and renderer-health rollback to the previous cached package.

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
  "capabilities": [
    "shell.info",
    "shell.ready",
    "navigation.resolve",
    "tabs.read",
    "tabs.write",
    "browserState.settings.read",
    "browserState.bookmarks.read",
    "browserState.bookmarks.write",
    "browserState.history.read",
    "browserState.history.write",
    "browserState.favicons.read"
  ],
  "files": [
    {
      "path": "index.html",
      "sha256": "..."
    },
    {
      "path": "main.js",
      "sha256": "..."
    }
  ]
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
- `files` must be a non-empty array of package-relative paths and SHA-256 hashes
- every listed file must exist, stay inside the package root after realpath resolution, and match its manifest hash
- the package entry must be listed in `files`

Cached installs copy only the manifest and files declared by `files` into the
store. Unlisted package files are not part of the installed package.

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
capabilities needed for startup readiness, deterministic navigation coverage,
and the ordinary browser-state reads/writes used by the bookmarks bar and
autocomplete.

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
- default bookmarks render through the browser-state shell API
- clicking a default bookmark navigates under the deterministic harness
- autocomplete includes bookmark and recorded-history suggestions in package
  mode
- guest content receives the page-facing Ethereum provider in package mode and
  a low-risk `eth_chainId` request bypasses package chrome through main
- the wallet/sidebar control is intentionally hidden in package mode until it
  is backed by a shell-owned surface path
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
- `getSettings()`
- `getBookmarks()`
- `addBookmark(bookmark)`
- `updateBookmark(originalTarget, bookmark)`
- `removeBookmark(target)`
- `getHistory(options)`
- `addHistory(entry)`
- `getCachedFavicon(url)`
- `getSurfaceState(surface)`
- `openSurface(surface)`
- `closeSurface(surface)`
- `toggleSurface(surface)`
- `requestTestTrustedPrompt(payload)`
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

The browser-state methods expose ordinary browser UI state through the same
sender-checked shell bridge. `getSettings()` currently provides read-only
settings needed by package chrome initialization. The bookmark methods provide
read/write access to the existing bookmark store so the official package
bookmarks bar, add, edit, and remove controls do not rely on no-op shims.
`getHistory()` and `addHistory()` expose the existing history store to package
autocomplete and navigation recording. `getCachedFavicon()` exposes cached icon
data only; package chrome does not receive the network favicon fetch APIs.
These APIs return serializable data only and do not expose file paths or store
internals.

The surface-control methods expose a narrow shell-owned request path for
trusted surfaces. The current implemented surface is `wallet`, backed by
caller-scoped placeholder state with `owner: "shell"` and
`mode: "shell-owned-placeholder"`. Package chrome can read, open, close, or
toggle that placeholder state only when it declares `surfaces.wallet.control`.
This does not expose wallet, identity, provider, signing, or vault APIs, and it
does not mean the real wallet center has been migrated. The official package
smoke still keeps the wallet/sidebar affordance hidden until a real
shell-owned trusted surface is available, while the fixture package smoke
exercises the placeholder control path.

`requestTestTrustedPrompt(payload)` is a test-only trusted prompt broker slice
documented in `docs/trusted-prompt-broker.md`. It proves package chrome can
request a shell-owned trusted prompt result without rendering the prompt or
supplying final origin/security truth. The method requires
`trustedPrompts.test`, ignores package-supplied origin/tab claims, and does not
expose wallet, identity, x402, Swarm, vault, or signing APIs. It is not a
production prompt capability and is not declared by the official package smoke.

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
- `browserState.settings.read` allows `getSettings()`
- `browserState.bookmarks.read` allows `getBookmarks()`
- `browserState.bookmarks.write` allows bookmark add/update/remove methods
- `browserState.history.read` allows `getHistory(options)`
- `browserState.history.write` allows `addHistory(entry)`
- `browserState.favicons.read` allows `getCachedFavicon(url)`
- `surfaces.wallet.control` allows `getSurfaceState("wallet")`,
  `openSurface("wallet")`, `closeSurface("wallet")`, and
  `toggleSurface("wallet")`
- `trustedPrompts.test` allows `requestTestTrustedPrompt(payload)` for the
  test-only broker slice

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

Package chrome is also not the dApp provider broker. The current low-risk
package-mode proof routes guest `ethereum.request({ method: 'eth_chainId' })`
from the webview preload directly to main over a read-only provider channel.
Higher-risk provider methods remain on the legacy bundled path until the
trusted prompt/surface broker migration gives them shell-owned approval UI.
The broker foundation currently exists as the test-only
`requestTestTrustedPrompt()` path; real wallet connect, signing, x402, Swarm
publish, and vault unlock flows still need main-derived request context and
shell-owned prompt UI before they can move through the broker.

## Package Store

The local store lives under:

```text
<userData>/chrome-package-store/
```

Its current layout is:

```text
chrome-package-store/
  current.json
  previous.json
  staging/
  packages/<package-id>/<version>/<content-digest>/
    manifest.json
    .freedom-package-install.json
    ...
```

Installs are staged first, revalidated from the staging directory, renamed into
`packages/`, and only then activated by atomically writing `current.json`.
`previous.json` records the prior active package when an update activates a new
package.

The store records install metadata with the manifest hash, declared file
hashes, content digest, package id, package type, and version. On cached launch,
main validates the pointer, metadata, manifest hash, file hashes, shell API
compatibility, capabilities, and entry path before activation.

For the same package id:

- lower versions are rejected unless an explicit recovery path allows downgrade
- same-version changed content is rejected as replay unless explicitly allowed
- missing, corrupt, or partially staged packages cannot become active

Cached package metadata is internal. `freedomShell.getInfo()` reports package
id, name, version, source, runtime mode, capabilities, and fallback diagnostics
without exposing package filesystem paths.

## Recovery

Freedom falls back to bundled safe chrome when:

- the package directory is missing
- the manifest is missing or malformed
- the manifest declares an incompatible shell API range
- the entry path escapes the package root
- the entry file is missing
- required file-integrity metadata is missing or invalid
- a listed package file is missing, outside the package root, or hash-mismatched
- the requested cached package is missing or corrupt
- the requested feed is missing, malformed, unavailable, or has no installable package
- an advertised feed package is corrupt or unavailable
- the package entry fails to load
- the package does not signal readiness
- the package renderer exits or crashes after activation

If a cached package fails to load or does not signal readiness, main first tries
to roll back to `previous.json`. The same rollback path handles shell-observed
package health failures such as a package renderer `render-process-gone` event.
If no previous package is usable, or the rolled-back package also fails in that
recovery attempt, Freedom falls back to bundled safe chrome.

Recovery does not depend on Swarm, IPFS, ENS, or live network access.

## Verification

Focused unit tests:

```bash
npm test -- src/main/chrome-package.test.js src/main/chrome-package-feed.test.js src/main/chrome-package-store.test.js src/main/package-preload.test.js src/main/shell-api.test.js src/shared/navigation-input.test.js src/main/windows/mainWindow.test.js
```

Bundled chrome smoke:

```bash
xvfb-run -a npm run test:e2e -- test-e2e/chrome-smoke.spec.js
```

Package-mode, feed/update, rollback, and fallback smoke:

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
