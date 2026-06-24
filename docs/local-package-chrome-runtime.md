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

Store-backed package windows load their entry through the shell-owned
`freedom-chrome://active/` scheme, for example:

```text
freedom-chrome://active/index.html
```

The direct local development path remains file-based for package authors. The
cached path is the production-like origin model for pre-Swarm package work.

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
    "browserState.settings.write",
    "browserState.bookmarks.read",
    "browserState.bookmarks.write",
    "browserState.history.read",
    "browserState.history.write",
    "browserState.favicons.read",
    "browserState.favicons.write",
    "browserState.profiles.read",
    "services.read",
    "chrome.ui.commands",
    "clipboard.write",
    "downloads.saveImage",
    "surfaces.wallet.control",
    "windows.control",
    "windows.open",
    "app.about",
    "app.updates"
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

When a cached package is active, `freedom-chrome://active/` serves only files
declared by the active package manifest. The handler rejects dot-segment and
encoded-separator paths, refuses undeclared files, rechecks each served file's
SHA-256 hash against the manifest, and does not expose arbitrary store paths or
install metadata. Package HTML responses include a conservative package CSP
header compatible with the current official renderer and its internal pages.

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
the ordinary browser-state reads/writes used by the bookmarks bar and
autocomplete, and the shell-owned wallet surface placeholder.

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
- visible bookmark add, edit, and delete controls use the
  browser-state shell API in package mode
- package-safe settings writes persist through the browser-state shell API
  without allowing package chrome to mutate service/provider settings
- package-hosted `freedom://settings` uses the same package-safe settings
  write subset, disables node startup, identity/wallet, Radicle startup, and
  updater toggles, and renders Chains, RPC Providers, and ENS network
  configuration as shell-owned unavailable states
- `freedom://settings/startup` and `freedom://publish` expose intentional
  package-mode unavailable states for shell-owned Swarm publish flows instead
  of leaving visible publish controls clickable
- `freedom://payments` exposes an intentional package-mode unavailable state
  instead of letting package-hosted internal pages read or clear payment,
  wallet-send, dApp-send, or x402 history
- `freedom://settings/profiles` exposes an intentional package-mode
  unavailable state for raw profile management and node configuration while
  keeping display-only profile reads available through `freedomShell`
- the profile indicator/menu renders the active profile through a read-only
  profile shell API, while profile creation and switching controls are disabled
  in package mode
- clicking a default bookmark navigates under the deterministic harness
- autocomplete includes bookmark and recorded-history suggestions in package
  mode
- the visible History menu item opens `freedom://history`, renders seeded
  history entries through the hosted internal page, and removes an entry
  through the page controls
- guest content receives the page-facing Ethereum provider in package mode and
  a low-risk `eth_chainId` request bypasses package chrome through main
- package-hosted `eth_requestAccounts` reaches a shell-owned native wallet
  connect prompt with main-derived guest context; approval writes a main-side
  dApp permission and returns the active wallet address, while rejection
  returns page-facing `4001`
- package-hosted `eth_accounts` reads existing main-owned dApp permissions and
  returns the granted account without opening package chrome authority
- package-hosted `personal_sign` and modern `eth_signTypedData*` requests
  reach shell-owned native wallet signature prompts with main-derived guest
  context; accepted prompts sign through main/vault access for already
  connected origins, while rejected prompts return page-facing `4001`
- package-hosted `eth_sendTransaction` reaches a shell-owned native wallet
  transaction prompt with main-derived guest context; accepted prompts for
  already connected origins validate account/chain, fill gas and fee data in
  main, sign/broadcast through main/vault access, and return the transaction
  hash, while rejected prompts return page-facing `4001`
- guest content receives the page-facing Swarm provider in package mode and a
  low-risk `swarm_getCapabilities` request bypasses package chrome through main
  with a deterministic `not-connected` result under the harness
- package-hosted `swarm.publishData()` reaches a shell-owned native Swarm
  publish prompt with main-derived guest context; accepted prompts execute a
  data-only publish through the existing main-owned provider path, while
  rejected prompts return page-facing `4001`
- the wallet/sidebar control opens a shell-owned placeholder surface in
  package mode through `surfaces.wallet.control` without exposing wallet or
  identity APIs to package chrome
- the main menu opens, and the node menu opens with sanitized service status
  available through `services.read`
- package chrome does not receive broad node globals such as `ant`, `ipfs`,
  `radicle`, `serviceRegistry`, or `nodeConfig`
- Ant and IPFS lifecycle toggles are disabled with explicit package-mode
  behavior because node start/stop remains shell-owned
- the main menu fullscreen control reaches the shell-owned BrowserWindow
  `setFullScreen(true/false)` command path
- the main menu New Window control opens another package chrome BrowserWindow
  through a shell-owned command path
- native application menu commands for New Tab, Close Tab, Focus Address Bar,
  Reload, Developer Tools, and Always Show Bookmarks Bar reach package chrome
  through the capability-gated `chrome.ui.commands` event bridge
- package chrome reports tab-menu enabled state and bookmark-bar checked/enabled
  state to the native application menu through capability-gated shell requests
- package context-menu Copy Link Address and Copy Image Address write through a
  narrow shell-owned clipboard API without exposing clipboard reads to package
  chrome
- package chrome disables the custom address-bar context-menu Paste item
  because package chrome has no clipboard-read authority; keyboard paste uses
  the browser/input path and is covered by official package smoke
- package context-menu Open Link in New Window opens another package chrome
  BrowserWindow through a shell-owned command path, and native menu state is
  restored for the original package window after the child window closes
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
- `saveSettings(settings)`
- `getBookmarks()`
- `addBookmark(bookmark)`
- `updateBookmark(originalTarget, bookmark)`
- `removeBookmark(target)`
- `getHistory(options)`
- `addHistory(entry)`
- `removeHistory(id)`
- `clearHistory()`
- `getFavicon(url)`
- `getCachedFavicon(url)`
- `fetchFavicon(url)`
- `fetchFaviconWithKey(fetchUrl, cacheKey)`
- `getActiveProfile()`
- `listProfiles()`
- `getServiceRegistry()`
- `getServiceStatus(service)`
- `checkServiceBinary(service)`
- `getSurfaceState(surface)`
- `openSurface(surface)`
- `closeSurface(surface)`
- `toggleSurface(surface)`
- `onSurfaceStateChanged(callback)`
- `requestTestTrustedPrompt(payload)`
- `getTabSnapshot()`
- `createTab(options)`
- `closeTab(tabId)`
- `activateTab(tabId)`
- `navigateTab(tabId, url)`
- `reloadTab(tabId)`
- `goHome(tabId)`
- `setWindowTitle(title)`
- `closeWindow()`
- `minimizeWindow()`
- `maximizeWindow()`
- `toggleFullscreen()`
- `newWindow()`
- `openUrlInNewWindow(url)`
- `showAbout()`
- `checkForUpdates()`
- `restartAndInstallUpdate()`
- `onUpdateNotification(callback)`
- `updateTabMenuState(state)`
- `setBookmarkBarToggleEnabled(enabled)`
- `setBookmarkBarChecked(checked)`
- `copyText(text)`
- `copyImageFromUrl(imageUrl)`
- `saveImage(imageUrl)`
- `onTabCommandResult(callback)`
- `onTabSnapshotChanged(callback)`
- `onCloseMenusRequested(callback)`
- `onFocusAddressBarRequested(callback)`
- `onToggleDevToolsRequested(callback)`
- `onCloseDevToolsRequested(callback)`
- `onCloseAllDevToolsRequested(callback)`
- `onNewTabRequested(callback)`
- `onCloseTabRequested(callback)`
- `onNewTabWithUrlRequested(callback)`
- `onNavigateToUrlRequested(callback)`
- `onLoadUrlRequested(callback)`
- `onReloadRequested(callback)`
- `onHardReloadRequested(callback)`
- `onNextTabRequested(callback)`
- `onPrevTabRequested(callback)`
- `onMoveTabLeftRequested(callback)`
- `onMoveTabRightRequested(callback)`
- `onReopenClosedTabRequested(callback)`
- `onToggleBookmarkBarRequested(callback)`
- `onProfileUpdated(callback)`
- `onServiceRegistryUpdated(callback)`
- `onServiceStatusUpdated(callback)`

`getInfo()` returns shell/package diagnostics: shell API version, runtime mode,
app version, platform, package id/name/version/source, declared capabilities,
fallback state, and caller package identity for shell requests. For package
callers, the top-level `runtimeMode` and `chromePackage` fields are derived
from the registered sender identity instead of global active-package state, so
multiple package or recovery windows cannot observe another caller's package
descriptor. Caller identity and public fallback diagnostics are path-free and
include package id, package type, name, version, source, runtime mode, and
declared capabilities.

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
Wallet/identity ENS address and reverse lookups are not package chrome APIs in
this phase; `resolveEnsAddress()` and `resolveEnsReverse()` return
`ENS_WALLET_RESOLUTION_UNAVAILABLE` in package mode until those trusted
surfaces migrate.

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
sender-checked shell bridge. `getSettings()` provides settings needed by
package chrome initialization. `saveSettings(settings)` persists only
package-safe browser UI settings such as theme, bookmark-bar visibility, ENS
interstitial gating, and sidebar dimensions; service/node/provider-oriented
settings in the same payload are ignored by main. Package-hosted internal
settings pages use that same package-safe filter for raw `settings:save`
requests. Startup/node, identity/wallet, Radicle startup, updater, network/RPC
provider, and ENS network-configuration controls remain shell-owned in package
mode; the visible controls are disabled or rendered unavailable instead of
mutating those stores through package-hosted internal pages. The bookmark methods provide
read/write access to the existing bookmark store so the official package
bookmarks bar, add, edit, and remove controls do not rely on no-op shims.
`getHistory()`, `addHistory()`, `removeHistory()`, and `clearHistory()` expose
the existing history store to package autocomplete, navigation recording, and
visible history-management controls. `getCachedFavicon()` exposes cached icon
data, while `getFavicon()`, `fetchFavicon()`, and `fetchFaviconWithKey()` use a
separate favicon-write capability because those calls may perform a
shell-owned network favicon lookup and update the favicon cache.
`getActiveProfile()` and `listProfiles()` expose display-only profile data for
the profile indicator/menu. They do not expose profile roots, user data
directories, node configuration, timestamps, catalog metadata, or profile
mutation authority. In non-catalog launches, `listProfiles()` returns an
active-only list so package chrome can render the current profile without
claiming profile switching support. Profile creation and profile switching
remain shell-owned/bundled-only until a scoped trusted switching surface exists.
These APIs return serializable data only and do not expose file paths or store
internals.

Package-hosted `freedom://settings/profiles` does not receive the bundled raw
profile management IPC path. Main returns structured
`PROFILE_MANAGEMENT_UNAVAILABLE` for raw active-profile reads, profile lists,
create/import/switch/delete/rename mutations, and profile node-configuration
updates when the internal settings page is hosted by package chrome. The page
surfaces that package-mode state and disables profile creation controls.
Bundled trusted settings keeps the existing full profile management UI.

The service read methods expose sanitized Ant, IPFS, and Radicle node status
needed by the visible nodes menu. `getServiceRegistry()` returns only package
visible `mode`, `statusMessage`, and `tempMessage` fields; it does not expose
local API/gateway URLs, ports, filesystem paths, or registry internals.
`getServiceStatus(service)` and `checkServiceBinary(service)` return read-only
status/binary availability with `controllable: false`. Package chrome receives
service registry/status events through `onServiceRegistryUpdated()` and
`onServiceStatusUpdated()` when it declares `services.read`, but it does not
receive node lifecycle methods. Ant/IPFS/Radicle start/stop and endpoint base
updates remain shell-owned. The startup prompt for default-port external node
candidates is also shell-owned in package mode: package windows do not receive
the legacy renderer prompt IPC, and main falls back to the native dialog path
instead of exposing profile node-configuration decisions to package chrome.

The `freedom://settings/startup` publish setup entry point remains shell-owned
in package mode. Bundled chrome still receives the legacy
`sidebar:open-publish-setup` renderer event so it can open the wallet sidebar
checklist. Package-hosted internal pages do not receive that event through
package chrome; main returns structured `PUBLISH_SETUP_UNAVAILABLE`, and the
settings page disables the visible setup action with that message instead of
leaving a clickable no-op.

The direct `freedom://publish` page is also disabled when hosted by package
chrome. Its internal page preload can normally call path-based
`freedomAPI.swarm.*` methods for trusted bundled UI, so main rejects
package-hosted publish, file/folder picker, upload-status, stamp-read, and
publish-history IPC with structured `SWARM_PUBLISH_UNAVAILABLE`. The page
surfaces that result as a warning and disables the visible Publish File,
Publish Folder, and Publish Text controls. The provider-path
`swarm_publishData` one-time prompt does not make this internal publish center
available and does not cover files, folders, feed updates, stamp management, or
the full publish/feed approval UX.

The surface-control methods expose a narrow shell-owned request path for
trusted surfaces. The current implemented surface is `wallet`, backed by
caller-scoped placeholder state with `owner: "shell"` and
`mode: "shell-owned-placeholder"`. Package chrome can read, open, close, or
toggle that placeholder state only when it declares `surfaces.wallet.control`.
The same capability gates the caller-scoped `surfaces.stateChanged` event
exposed as `onSurfaceStateChanged(callback)`, so package chrome can mirror
shell-owned state changes without polling or broad IPC. This does not expose
wallet, identity, provider, signing, or vault APIs, and it does not mean the
real wallet center has been migrated. The official package smoke exercises the
visible wallet/sidebar affordance against this shell-owned placeholder state
and verifies direct shell state changes update the package UI through the event.
The fixture package smoke also exercises the placeholder control path.

`requestTestTrustedPrompt(payload)` is a test-only trusted prompt broker slice
documented in `docs/trusted-prompt-broker.md`. It proves package chrome can
request a shell-owned trusted prompt result without rendering the prompt or
supplying final origin/security truth. The method requires
`trustedPrompts.test`, ignores package-supplied origin/tab claims, and does not
expose wallet, identity, x402, Swarm, vault, or signing APIs. The test slice
supports a synthetic broker result and a `presentation: "native-dialog"` path
that presents a shell-owned Electron dialog attached to the package
BrowserWindow. Both paths are test-only. They are not production prompt
capabilities and are not declared by the official package smoke.

Raw x402 approval and vault-unlock events remain bundled-trusted-renderer UI,
not package chrome APIs. The x402 interceptor refuses to deliver `x402:*`
host-renderer events to registered package windows. If a package-hosted guest
hits a non-cap-covered x402 paywall, main presents a shell-owned native Pay /
Reject prompt instead of waiting for package chrome to render an approval card.
When the user chooses Pay and the vault is unlocked, main signs through the
existing vault-backed x402 client, queues the payment header for the retry, and
returns the same shell-owned retry behavior as bundled approval. Rejected
prompts pass the original 402 through. If an auto-pay flow needs vault unlock,
main still presents a shell-owned native vault-unlock rejection prompt and then
passes the original 402 through. This keeps package mode from silently hanging
while preserving the boundary that final payment approval and vault unlock must
stay shell-owned. The native x402 path does not grant caps, unlock vault state,
write payment permissions, expose payment history, or migrate the full payment
review UI. Raw package runtime x402 adapter methods also return structured
`X402_PACKAGE_API_UNAVAILABLE` results instead of quiet `null`, `false`, or
empty-array defaults.

The direct `freedom://payments` internal page is also unavailable when hosted
by package chrome. Its internal page preload can normally read unified payment
history covering x402 micropayments, wallet sends, and dApp-routed sends, and
the page includes a clear-history mutation. Main rejects package-hosted
payment-history IPC with structured `PAYMENTS_UNAVAILABLE`; the page surfaces
that result and disables search, filters, and Clear all. Bundled trusted chrome
keeps the existing payment-history page.

The window-control methods expose a narrow shell-owned command path for the
calling package window only. They let visible chrome affordances set the window
title, close/minimize the owner window, toggle maximize, and toggle fullscreen
without giving package chrome Electron primitives or access to other windows.
The current official package smoke exercises the visible fullscreen menu
control by recording the owner BrowserWindow `setFullScreen(true/false)` calls
through this path.

The window-open and app-command methods expose narrow shell-owned menu command
requests. `newWindow()` and `openUrlInNewWindow(url)` ask main to create a new
browser window through the same shell-owned window factory used by bundled
chrome; package chrome never receives `BrowserWindow` objects or Electron
primitives. `showAbout()` asks Electron to open the native About panel.
`checkForUpdates()` and `restartAndInstallUpdate()` ask the shell updater to
run its existing policy-owned actions; package chrome receives only a
serializable request result and does not receive auto-updater authority.
`onUpdateNotification(callback)` receives the shell-owned updater's
serializable toast payload over `shell:event` when the package declares
`app.updates`; package chrome still cannot access `autoUpdater`, dialogs,
profile locks, install state, or update ownership internals.

`updateTabMenuState(state)`, `setBookmarkBarToggleEnabled(enabled)`, and
`setBookmarkBarChecked(checked)` let package chrome report ordinary browser UI
state to the shell-owned native application menu. The shell normalizes the tab
state payload, applies it through menu-owned handlers registered by main, and
returns only serializable success/error results. Package menu state is cached by
owning BrowserWindow and applied only for the focused browser window, so a
secondary package window cannot leave the native menu reflecting stale state
after it closes. Package chrome does not receive Electron `Menu` objects,
native menu item references, or arbitrary IPC.

`copyText(text)` and `copyImageFromUrl(imageUrl)` provide write-only
shell-owned clipboard operations for visible page context-menu actions.
`saveImage(imageUrl)` opens the shell-owned save dialog and downloads the image
through main. These APIs are intentionally narrow: package chrome cannot read
clipboard contents, cannot receive the chosen filesystem path from
`saveImage()`, and image fetch/save uses the existing main-process HTTP(S)-only
fetch helper. The custom address-bar context-menu Paste item is disabled in
package mode rather than receiving a clipboard-read API; users can still paste
through the system keyboard shortcut, which stays browser/input-mediated.

`onTabCommandResult(callback)` subscribes to package-visible
`tabs.commandResult` events emitted after shell-owned tab commands complete. It
returns a cleanup function. Like the tab command methods, the event requires the
package to declare `tabs.write`.

`onTabSnapshotChanged(callback)` subscribes to `tabs.snapshotChanged` events
emitted when a successful tab command changes the shell-owned serializable tab
snapshot. It returns a cleanup function and requires `tabs.read`.

The `on*Requested(callback)` chrome command subscriptions deliver shell-originated
browser UI commands such as native menu/shortcut New Tab, Close Tab, Reload,
Focus Address Bar, bookmark-bar toggle, tab traversal, DevTools commands,
guest-window-open requests, and custom-protocol navigation requests. They use
the same `shell:event` channel, require `chrome.ui.commands`, and are delivered
only to registered package windows. Bundled chrome keeps its legacy direct IPC
path.

`onProfileUpdated(callback)` delivers sanitized profile display changes over
`shell:event` to package windows that declare `browserState.profiles.read`.
Bundled chrome keeps the existing profile IPC path for trusted profile UI.

Every shell API request must come from a registered local package window and
must be allowed by the package manifest's declared capabilities:

- `shell.info` allows `getInfo()`
- `shell.ready` allows `markReady()`
- `navigation.resolve` allows `resolveNavigationInput(input)`, `resolveEns(name)`, and `invalidateEnsContent(name)`
- `tabs.read` allows `getTabSnapshot()`
- `tabs.write` allows tab command methods
- `browserState.settings.read` allows `getSettings()`
- `browserState.settings.write` allows `saveSettings(settings)` for the
  package-safe browser UI setting subset
- `browserState.bookmarks.read` allows `getBookmarks()`
- `browserState.bookmarks.write` allows bookmark add/update/remove methods
- `browserState.history.read` allows `getHistory(options)`
- `browserState.history.write` allows `addHistory(entry)`,
  `removeHistory(id)`, and `clearHistory()`
- `browserState.favicons.read` allows `getCachedFavicon(url)`
- `browserState.favicons.write` allows `getFavicon(url)`,
  `fetchFavicon(url)`, and `fetchFaviconWithKey(fetchUrl, cacheKey)`
- `browserState.profiles.read` allows `getActiveProfile()`,
  `listProfiles()`, and `onProfileUpdated(callback)`
- `services.read` allows `getServiceRegistry()`, `getServiceStatus(service)`,
  `checkServiceBinary(service)`, `onServiceRegistryUpdated(callback)`, and
  `onServiceStatusUpdated(callback)` for sanitized node-menu status only
- `surfaces.wallet.control` allows `getSurfaceState("wallet")`,
  `openSurface("wallet")`, `closeSurface("wallet")`, and
  `toggleSurface("wallet")`
- `trustedPrompts.test` allows `requestTestTrustedPrompt(payload)` for the
  test-only broker slice
- `windows.control` allows `setWindowTitle(title)`, `closeWindow()`,
  `minimizeWindow()`, `maximizeWindow()`, and `toggleFullscreen()` for the
  calling package window
- `windows.open` allows `newWindow()` and `openUrlInNewWindow(url)` requests
  through the shell-owned window factory
- `app.about` allows `showAbout()` to request the shell-owned About panel
- `app.updates` allows `checkForUpdates()` and
  `restartAndInstallUpdate()` to request shell-owned updater actions and
  `onUpdateNotification(callback)` to subscribe to updater notification events
- `chrome.ui.commands` allows package chrome to receive shell-originated
  browser UI command events over `shell:event` and report native tab/bookmark
  bar menu state through the sender-checked shell request bridge
- `clipboard.write` allows `copyText(text)` and `copyImageFromUrl(imageUrl)`
  write-only clipboard requests
- `downloads.saveImage` allows `saveImage(imageUrl)` to request a shell-owned
  image save dialog and download without returning the selected file path

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
package-mode proofs route guest
`ethereum.request({ method: 'eth_chainId' })` and
`swarm.getCapabilities()` from the webview preload directly to main over
read-only provider channels. The Swarm path only accepts
`swarm_getCapabilities`; publish, feed, signing, and access-request methods do
not use this bypass. The Ethereum path accepts low-risk `eth_chainId` directly
and handles wallet account reads/grants from main-owned dApp permissions:
`eth_requestAccounts` asks main for its host context, main derives the guest
origin and package host identity, the broker presents a shell-owned native
dialog, and an accepted prompt writes the dApp permission and returns the
active wallet address. `eth_accounts` reads that existing main-owned
permission without prompting. Modern signing-class methods now use a
shell-owned prompt plus main/vault execution path for already connected
origins: `personal_sign`, `eth_signTypedData`, `eth_signTypedData_v3`, and
`eth_signTypedData_v4` can return signatures when the user chooses Sign and
the vault is unlocked. `eth_sendTransaction` can return a transaction hash for
already connected origins when the user chooses Send and the vault is unlocked:
main validates the requested account and chain against the existing dApp
permission, fills missing gas and fee fields through wallet services, signs and
broadcasts through the existing transaction recorder, and updates the
permission last-used timestamp. Deprecated `eth_sign` and unsupported
typed-data variants remain structured safe-failure paths. The Swarm path also
has a shell-owned prompt slice for
`swarm_publishData`: package-hosted guests ask main for host context, main
derives the guest origin and package host identity, the broker presents a
shell-owned native dialog, and accepted data-only prompts execute through the
existing main-owned provider publish path. Rejected prompts still return a
structured `4001` user rejection. These slices do not grant Swarm access,
write feed permissions, expose stamp management, expose account selection, or
unlock vault state. Other higher-risk Ethereum and Swarm methods still fail
with structured
`trusted_prompt_unavailable` provider errors before package chrome can broker
them. Bundled chrome keeps the legacy renderer prompt path for those methods
until the trusted prompt/surface broker migration gives them shell-owned
approval UI. x402 cap grants/unlock, Swarm feed/file/folder/full publish UX,
richer wallet account
selection/review, and vault unlock flows still need main-derived request
context and shell-owned prompt UI before they can move fully through the
broker.

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
without exposing package filesystem paths. Public fallback diagnostics keep
stable error codes and safe relative package paths where useful, but strip or
redact internal package roots, store paths, install paths, and preload/entry
file paths.

Cached package rendering uses the `freedom-chrome://active/` scheme instead of
raw file URLs. The active scheme maps requests back to the validated package
root internally, serves only manifest-declared files, and revalidates content
hashes before responding. The direct `FREEDOM_CHROME_PACKAGE_DIR` development
path still loads from disk directly and is intentionally not the production-like
cached origin model.

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

Package-origin focused unit tests:

```bash
npm test -- src/main/chrome-package-protocol.test.js src/main/windows/mainWindow.test.js
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
