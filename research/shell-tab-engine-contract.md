# Shell-Owned Tab Engine Contract

Date: 2026-06-25

This document specifies the next hill-climb after local package chrome and the
wallet compositor drawer. The goal is to move page content out of package-owned
`<webview>` elements and into main-owned `WebContentsView`s without handing raw
Electron handles to package chrome.

## Current State

Local package chrome now runs as `ShellWindow.chromeView` inside a hardened
native host. Trusted wallet UI can render as a sibling shell-owned
`WebContentsView`.

Tab content is still transitional:

- official package chrome creates `<webview>` elements
- package chrome owns tab DOM and guest element lifecycle
- main enforces guest security preferences at attach time
- provider identity and permission authority stay in main
- shell tab APIs exist, but they are currently a registry/command contract, not
  the load-bearing content engine

This is safe enough for the local package bridge, but it is not the final
boundary. The final boundary is: chrome owns browser UX, main owns browser
engine/content.

## Target Boundary

Main owns:

- tab identity and tab ids
- content `WebContentsView` creation/destruction
- all content `webPreferences`
- preload/provider attachment
- navigation resolution and `loadURL`
- committed URL/origin identity
- permission prompts and permission checks
- history/favicons/title/loading/crash state derived from content events
- layout/composition of active content view

Package chrome owns:

- tab strip rendering
- address bar rendering and input collection
- browser-command intent
- visual themes and chrome-local preferences
- layout hints for where content should appear

Package chrome never receives:

- raw `WebContentsView`
- raw `webContents`
- `BrowserWindow`
- session objects
- preload paths for content
- direct `loadURL` authority
- direct JavaScript execution authority in content
- provider injection authority
- permission interception authority

## API Shape

Prefer evolving the existing `freedomShell` tab methods rather than adding a
second parallel API. The package preload may expose friendly nested aliases
later, but the main contract should remain method/capability-gated.

Commands:

```js
await freedomShell.createTab({ url, active: true })
await freedomShell.navigateTab({ tabId, input })
await freedomShell.activateTab({ tabId })
await freedomShell.closeTab({ tabId })
await freedomShell.reloadTab({ tabId, ignoreCache: false })
await freedomShell.goHome({ tabId })
await freedomShell.stopTab({ tabId })
await freedomShell.goBack({ tabId })
await freedomShell.goForward({ tabId })
```

Layout:

```js
await freedomShell.setContentRegion({
  region: 'active-tab-content',
  bounds: { x, y, width, height },
})
```

Events:

```js
freedomShell.onEvent((event) => {
  if (event.type === 'tabs.snapshotChanged') {
    renderTabs(event.snapshot)
  }
})
```

Command results should stay correlated and explicit:

```js
{
  ok: true,
  commandId,
  command: 'tabs.navigate',
  tabId,
  snapshotChanged: true,
  snapshot,
}
```

Failures should be typed:

```js
{
  ok: false,
  commandId,
  command: 'tabs.navigate',
  error: {
    code: 'TAB_NAVIGATION_REJECTED',
    message: 'Navigation target is not allowed',
  },
  snapshotChanged: false,
  snapshot,
}
```

## Snapshot Shape

The snapshot is main-derived:

```js
{
  version,
  activeTabId,
  tabs: [
    {
      id,
      url,                  // display URL, never authority
      committedDisplayUrl,  // main-derived committed display URL
      title,
      favicon,
      isActive,
      isLoading,
      canGoBack,
      canGoForward,
      crashed,
      hasCertError,
      isViewingSource,
    },
  ],
}
```

Do not expose `webContentsId` by default. If a future diagnostic API exposes
it, it must be debug-only or ownership-verified and explicitly non-authoritative
for package chrome.

## First Vertical Slice

The first implementation slice should be intentionally small and runnable
behind an explicit development flag or package manifest capability.

Scope:

- create one shell-owned content `WebContentsView`
- compose it as a sibling view in `ShellWindow`
- let package chrome report a content region
- let package chrome request create/navigate/activate/close by tab id
- main resolves navigation input before loading
- main derives title, loading state, committed URL, and crash state
- package chrome renders tab strip/address UI from main snapshot
- package chrome never creates a content `<webview>` for the slice

Allowed limitations in slice one:

- one active content region
- no pinned tabs
- no tab drag/drop
- no split views
- no fullscreen content handling
- no provider permission UX redesign
- no migration of all internal pages at once

Not allowed as "limitations":

- package chrome calling `loadURL`
- package chrome creating the content view
- package chrome receiving content handles
- package chrome choosing content `webPreferences`
- package chrome injecting wallet/Swarm providers directly

## Layout Contract

Package chrome can report a content rectangle because it owns browser UX
geometry. Main validates and clamps it:

- bounds must be finite integers
- width/height must be positive
- bounds must fit inside native content bounds
- shell-owned trusted surfaces may reserve or overlay space regardless of
  package hints
- shell may ignore hints during recovery, fullscreen, or trusted prompts

Main applies layout only to shell-owned content views. Package chrome receives
state describing the accepted region, not a handle.

## Navigation Contract

For typed input:

1. Package chrome sends the raw input and tab id.
2. Main resolves via the existing `resolveNavigationInput` authority.
3. Main performs ENS/contenthash decisions.
4. Main calls `loadURL` on the content view.
5. Main updates snapshot from content events.

Package chrome may display suggestions and collect input, but it does not
decide the final load target for shell-owned content.

## Provider And Permission Contract

Provider injection belongs to main/content preload.

The current page-facing provider hardening remains the invariant:

- dApp wallet/Swarm requests identify the committed content `webContents`
- main resolves origin/permission keys from committed identity
- package chrome is not in the privileged provider path
- package chrome can request trusted shell surfaces, not provider operations

## Migration Strategy

1. Keep transitional package `<webview>` tabs as the default.
2. Add shell-owned content view support behind a flag/manifest field.
3. Build a fixture package that uses only the shell tab APIs.
4. Make one official package mode opt-in to shell-owned content for a narrow
   smoke flow.
5. Expand parity: new tab, navigate, reload, history, favicon, crash recovery,
   context menu, downloads/save image.
6. Remove `guestContent.transitionalWebviews` only after official package parity
   and recovery tests are green.

## Verification Matrix

Unit:

- tab command validation
- layout bounds clamping
- content view lifecycle cleanup
- snapshot derivation
- no raw handle serialization
- permission/provider identity remains main-derived

E2E:

- package chrome starts without broad APIs
- shell-owned content view loads home
- address navigation loads in shell-owned content
- title/loading/committed URL update in tab strip
- close/reopen cleans content view
- crash updates snapshot and recovery state
- wallet drawer still overlays or reserves correctly
- package chrome cannot query content DOM or handles
- bundled chrome fallback still starts

Exit criterion for the first slice:

- one shell-owned tab can be created, navigated, activated, and closed through
  `freedomShell`
- package chrome renders state from main snapshot
- e2e proves separate host/chrome/content webContents identities
- e2e proves no raw content handle is exposed to package chrome

