# Freedom App Runtime Developer Guide

Status: Draft. This document describes the local package runtime as it exists
today. Treat it as a living developer contract, not a frozen public SDK.

Freedom apps are HTML/CSS/JavaScript packages that run inside Freedom Shell with
a narrow preload. They can be browser UIs, agent UIs, dashboards, settings
apps, or other app surfaces. The current package type is still
`browser-chrome`, even for non-browser experiments; future runtime versions may
split that into more explicit app package types.

## Mental Model

Freedom has three layers:

| Layer | Owner | Examples |
| --- | --- | --- |
| Shell | Freedom main process and trusted bundled code | launcher, rail, trusted wallet/payment/publish surfaces, package install/recovery |
| App package | package HTML/JS/CSS loaded with `window.freedomShell` | official browser chrome, future settings app, future agent runtime |
| Guest content | web pages embedded by an app package | HTTPS, `bzz://`, `ipfs://`, ENS-resolved pages, dApps |

The app package owns its app UI. If it is a browser, it owns the tab strip,
address bar, menus, autocomplete, and the DOM around page content.

The shell owns secrets, node lifecycle, provider identity, permission prompts,
trusted surfaces, package validation, and native composition. App packages can
request shell actions through `window.freedomShell`; they do not receive raw
Electron, Node, wallet, identity, provider, or node-management APIs.

## Runtime Modes

Development currently supports:

- Bundled chrome: `npm start`
- Explicit local package: `FREEDOM_CHROME_PACKAGE_DIR=/absolute/path npm start`
- Official generated package: `npm run chrome:package:run`
- Cached local package store: `npm run chrome:package:install`

The local package runtime is the pre-Swarm development canary. Swarm delivery,
package signatures, marketplace flows, and third-party provenance are not part
of this guide yet.

## Package Manifest

Every package has a `manifest.json`:

```json
{
  "manifestVersion": 1,
  "packageType": "browser-chrome",
  "packageId": "baby.freedom.example.app",
  "name": "Example Freedom App",
  "version": "0.0.1",
  "entry": "index.html",
  "shellCompatibility": {
    "minShellApi": "0.1.0",
    "maxShellApi": "0.1.x"
  },
  "capabilities": [
    "shell.info",
    "shell.ready"
  ],
  "files": [
    {
      "path": "index.html",
      "sha256": "..."
    }
  ]
}
```

Required fields:

| Field | Meaning |
| --- | --- |
| `manifestVersion` | Must be `1`. |
| `packageType` | Must currently be `browser-chrome`. |
| `packageId` | Stable package id. Use reverse-DNS style names. |
| `name` | Human-readable package name. |
| `version` | Package version string. |
| `entry` | Relative HTML entry file inside the package. |
| `shellCompatibility.minShellApi` | Oldest shell API this package supports. |
| `shellCompatibility.maxShellApi` | Newest shell API this package supports. `0.1.x` is accepted. |
| `capabilities` | Shell API capabilities requested by the package. |
| `files` | Package-relative file list with SHA-256 hashes. |

Validation is intentionally strict:

- the package directory must be absolute
- the entry path must stay inside the package
- every declared file must exist and match its hash
- undeclared files are not part of cached package installs
- unknown capabilities are rejected

## Guest Webviews

Packages do not get embedded web pages by default. A package must explicitly opt
in:

```json
{
  "guestContent": {
    "webviews": true
  }
}
```

With `guestContent.webviews: true`, the app package may create Electron
`<webview>` elements in its DOM. This is the core embedded-page primitive for
browser apps, agent apps that browse for the user, and any future Freedom app
that needs to show real web content.

Without that opt-in, a `<webview>` tag remains inert. Tests assert that no guest
`webContents` is attached.

The opt-in does not let package code choose unsafe guest settings. The main
process still enforces:

- shell-owned guest preload
- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- `webSecurity: true`
- no package-supplied guest preload
- no package-supplied guest `webPreferences`

Guest pages may receive page-facing providers such as `window.ethereum` and
`window.swarm` where supported. Provider requests go to shell/main and trusted
prompt flows; the app package does not broker final wallet, Swarm, payment, or
vault decisions.

## Runtime Globals

Package apps receive exactly one app-facing global:

```js
window.freedomShell
```

Package apps must not rely on these globals, because they are intentionally not
available in package mode:

```js
window.electronAPI
window.wallet
window.identity
window.swarmProvider
window.swarmPermissions
window.dappPermissions
```

Guest webview content is different from package app code. Guest pages may get
page-facing provider globals like `window.ethereum` or `window.swarm`; package
apps do not.

## App Lifecycle

A package should call `markReady()` after it has rendered enough UI for the
shell to consider it healthy:

```html
<!doctype html>
<main id="app">Loading...</main>
<script>
  (async () => {
    const info = await window.freedomShell.getInfo();
    document.getElementById('app').textContent =
      `Hello from ${info.chromePackage.name}`;
    await window.freedomShell.markReady();
  })().catch((error) => {
    document.getElementById('app').textContent = String(error?.message || error);
  });
</script>
```

If a local package does not signal readiness before the timeout, Freedom falls
back to bundled chrome.

## Shell API Overview

All `freedomShell` methods are capability-gated. A package can only call methods
whose required capability appears in its manifest.

The current shell API version is `0.1.0`.

### Diagnostics And Lifecycle

| Capability | Methods |
| --- | --- |
| `shell.info` | `getInfo()`, `getTheme()`, `onThemeChanged(callback)` |
| `shell.ready` | `markReady()` |

`getInfo()` returns shell/app diagnostics, including the active package id,
runtime mode, granted capabilities, and `guestContent.webviews`.

### Navigation

| Capability | Methods |
| --- | --- |
| `navigation.resolve` | `resolveNavigationInput(input)`, `resolveEns(name)`, `invalidateEnsContent(name)` |

Use shell navigation resolution instead of reimplementing protocol, ENS,
`bzz://`, `ipfs://`, `ipns://`, `rad:`, or `freedom://` parsing in package code.

### Browser-Like Tab State

These methods are mainly for browser-style packages. They are a main-mediated
state/command contract; normal page content still lives in package-created,
main-hardened `<webview>` elements.

| Capability | Methods/events |
| --- | --- |
| `tabs.read` | `getTabSnapshot()`, `onTabSnapshotChanged(callback)` |
| `tabs.write` | `createTab(options)`, `closeTab(tabId)`, `activateTab(tabId)`, `navigateTab(tabId, url)`, `reloadTab(tabId)`, `goHome(tabId)`, `onTabCommandResult(callback)` |

### Browser State

| Capability | Methods/events |
| --- | --- |
| `browserState.settings.read` | `getSettings()` |
| `browserState.settings.write` | `saveSettings(settings)` |
| `browserState.bookmarks.read` | `getBookmarks()` |
| `browserState.bookmarks.write` | `addBookmark(bookmark)`, `updateBookmark(originalTarget, bookmark)`, `removeBookmark(target)` |
| `browserState.history.read` | `getHistory(options)` |
| `browserState.history.write` | `addHistory(entry)`, `removeHistory(id)`, `clearHistory()` |
| `browserState.favicons.read` | `getCachedFavicon(url)` |
| `browserState.favicons.write` | `getFavicon(url)`, `fetchFavicon(url)`, `fetchFaviconWithKey(fetchUrl, cacheKey)` |
| `browserState.profiles.read` | `getActiveProfile()`, `listProfiles()`, `onProfileUpdated(callback)` |

Settings writes are intentionally scoped to package-safe browser UI settings.
Node lifecycle, provider configuration, identity, profile mutation, vault
management, and update policy remain shell-owned.

### Services And Nodes

| Capability | Methods/events |
| --- | --- |
| `services.read` | `getServiceRegistry()`, `getServiceStatus(service)`, `checkServiceBinary(service)`, `onServiceRegistryUpdated(callback)`, `onServiceStatusUpdated(callback)` |

Service APIs are read-only today. Starting, stopping, configuring, or replacing
Ant, IPFS, Radicle, RPC providers, and related node settings are shell-owned
workflows.

### Shell Surfaces

| Capability | Surfaces |
| --- | --- |
| `surfaces.wallet.control` | `wallet` |
| `surfaces.identity.control` | `identity` |
| `surfaces.payments.control` | `payments` |
| `surfaces.swarmPublish.control` | `swarmPublish` |

Surface methods:

```js
await freedomShell.getSurfaceState('wallet');
await freedomShell.openSurface('wallet');
await freedomShell.closeSurface('wallet');
await freedomShell.toggleSurface('wallet');
const unsubscribe = freedomShell.onSurfaceStateChanged((state) => {});
```

Apps may request that a surface open or close. The shell owns the surface UI,
layout, trusted preload, data access, and final security-sensitive actions.

### App, Window, Clipboard, Downloads

| Capability | Methods/events |
| --- | --- |
| `windows.control` | `setWindowTitle(title)`, `closeWindow()`, `minimizeWindow()`, `maximizeWindow()`, `toggleFullscreen()` |
| `windows.open` | `newWindow()`, `openUrlInNewWindow(url)` |
| `app.about` | `showAbout()` |
| `app.updates` | `checkForUpdates()`, `restartAndInstallUpdate()`, `onUpdateNotification(callback)` |
| `clipboard.write` | `copyText(text)`, `copyImageFromUrl(imageUrl)` |
| `downloads.saveImage` | `saveImage(imageUrl)` |

### Browser Command Events

`chrome.ui.commands` is for browser-like packages that integrate with native
menus and shortcuts:

- `updateTabMenuState(state)`
- `setBookmarkBarToggleEnabled(enabled)`
- `setBookmarkBarChecked(checked)`
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

Non-browser apps usually should not request this capability.

## Trusted Prompts And Security-Sensitive Flows

App packages do not own final trusted approval UI for:

- wallet connect, signing, and transactions
- Swarm access, publishing, feeds, and signing identity
- x402 payment approval and caps
- vault unlock, seed export, and private-key export
- identity creation/import/unlock/delete
- node lifecycle and provider configuration
- package install/recovery trust decisions

Those flows are shell-owned. Today some prompt flows still appear as dedicated
trusted windows. The target UX is a coherent shell prompt/surface manager, but
the security boundary is already the important rule: packages request, shell
decides and renders trusted UI.

## Minimal App Package

`index.html`:

```html
<!doctype html>
<meta charset="utf-8">
<h1>Freedom App</h1>
<pre id="info"></pre>
<script>
  (async () => {
    const info = await window.freedomShell.getInfo();
    document.getElementById('info').textContent = JSON.stringify(info, null, 2);
    await window.freedomShell.markReady();
  })();
</script>
```

`manifest.json`:

```json
{
  "manifestVersion": 1,
  "packageType": "browser-chrome",
  "packageId": "baby.freedom.example.minimal",
  "name": "Minimal Freedom App",
  "version": "0.0.1",
  "entry": "index.html",
  "shellCompatibility": {
    "minShellApi": "0.1.0",
    "maxShellApi": "0.1.x"
  },
  "capabilities": [
    "shell.info",
    "shell.ready"
  ],
  "files": [
    {
      "path": "index.html",
      "sha256": "<sha256>"
    }
  ]
}
```

Run it with:

```bash
FREEDOM_CHROME_PACKAGE_DIR="/absolute/path/to/package" npm start
```

## Embedded Page App Example

An app that embeds web content adds `guestContent.webviews`:

```json
{
  "guestContent": {
    "webviews": true
  }
}
```

Then its app HTML can create a webview:

```html
<webview id="page" src="https://example.com"></webview>
```

The guest page is not the same security principal as the app package. The guest
page can receive page-facing providers; the app package cannot read shell
secrets or final prompt decisions unless shell APIs explicitly return data.

## Official Browser App

The official browser app is the largest current package. It declares
`guestContent.webviews: true` and browser-oriented capabilities for navigation,
tabs, bookmarks, history, favicons, profiles, services, command events,
windows, clipboard/image actions, updates, and shell-owned surface control.

Develop it with:

```bash
npm run chrome:package:run
```

Check the generated package boundary with:

```bash
npm run chrome:package:check-boundary
```

## Stability Notes

Stable enough to build against in local development:

- `manifestVersion: 1`
- `shellCompatibility`
- capability-gated `window.freedomShell`
- `guestContent.webviews`
- package apps not receiving broad trusted globals
- main-enforced guest webview preload/security

Still evolving:

- package types beyond `browser-chrome`
- Swarm-delivered package install/update/provenance
- shell prompt manager UX
- settings/nodes/profile as shell apps or shell surfaces
- public examples and packaging tools
- compatibility policy after shell API `0.1.x`

If a new Freedom app feature cannot be explained cleanly in this guide, treat
that as a design smell and update the runtime contract before relying on it.
