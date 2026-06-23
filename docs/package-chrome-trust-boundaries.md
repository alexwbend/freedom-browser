# Package Chrome Trust Boundaries

This document records the authority split for official package chrome before
Swarm delivery. It is the guardrail for moving the current bundled renderer
toward a package runtime without turning package chrome back into a trusted
renderer.

Current audited branch: `goal/local-package-chrome-runtime-v0`, through the
Pre-Swarm hardening checkpoints recorded in
`docs/agent-progress/local-package-chrome-runtime-v0.md`.

## Authority Categories

- `provider-path`: website/dApp content talks to shell-owned provider or
  permission brokers, optionally ending in a shell-owned trusted prompt.
- `browser-state-api`: package chrome talks to `window.freedomShell` for
  ordinary browser UI state such as bookmarks, settings, history, favicons, and
  profile display data.
- `surface-control-api`: package chrome may request that shell-owned surfaces
  open, close, or toggle. It does not receive the privileged APIs behind those
  surfaces.
- `trusted-surface`: bundled trusted code, a dedicated trusted preload, native
  UI, or another shell-owned surface renders final security-sensitive UI.
- `bundled-only/deferred`: intentionally unavailable in package mode for now.
  Any completion-critical deferral requires user approval before this goal can
  be called complete.

## Flow Inventory

| Flow | Initiator | Current bundled implementation | Start package behavior | Authority path | Trusted UI owner | Target package behavior | Capabilities | Required tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bookmarks bar read | package chrome UI | `src/renderer/lib/bookmarks-ui.js` calls `electronAPI.getBookmarks`; main uses `src/main/bookmarks-store.js` | `chrome-runtime-api.js` returned `[]`, so default bookmarks did not render | `browser-state-api` | none | package delegates bookmark reads to a narrow shell API | `browserState.bookmarks.read` | unit coverage, package preload parity, official package smoke with non-empty default bookmarks | implemented in first browser-state checkpoint |
| Bookmark add/update/remove | package chrome UI | `bookmarks-ui.js` calls `electronAPI.addBookmark/updateBookmark/removeBookmark` | adapter returned `false`, making visible controls fail silently | `browser-state-api` | none | package delegates writes if controls remain visible; otherwise controls must be disabled/hidden with smoke coverage | `browserState.bookmarks.write` | unit coverage plus package smoke for add/remove or disabled behavior | API implemented; direct add/remove smoke still pending |
| Bookmark bar visibility setting | package chrome UI and menu | `bookmarks-ui.js` reads `settings.showBookmarkBar`; menu IPC toggles state | package default returned `showBookmarkBar: false`; menu event is no-op | `browser-state-api`, possibly later menu/window API | none | package reads current setting; writes/toggle only if exposed in visible UI | `browserState.settings.read`, maybe `browserState.settings.write` | package smoke for tested default state and menu/toggle behavior if visible | read API implemented; write/toggle pending |
| History/autocomplete read | address bar UI | autocomplete/navigation use `electronAPI.getHistory` and main `src/main/history.js` | adapter returned `[]` | `browser-state-api` | none | expose history read if package autocomplete depends on it | `browserState.history.read` | harness-populated autocomplete smoke when implemented | implemented for autocomplete |
| History add | navigation lifecycle | renderer records visits with `electronAPI.addHistory` | adapter returned `false` | `browser-state-api` | none | expose add only if package mode records history from shell-owned navigation state | `browserState.history.write` | unit and smoke coverage for recording or explicit disabled behavior | implemented for navigation recording |
| Favicons | tabs, bookmarks, autocomplete | renderer calls favicon IPC in `src/main/favicons.js` | adapter returned `null` | `browser-state-api` | none | cached favicon read if visible package UI depends on icons | `browserState.favicons.read` | unit coverage and smoke if icons are asserted | cached read implemented; network fetch remains unavailable |
| Settings | settings page, UI init, feature flags | `settings-store.js` via broad preload | adapter returns startup defaults and `saveSettings: false` | `browser-state-api` | settings page is ordinary browser UI except privileged settings | package reads narrow settings required for visible chrome; writes only for ordinary browser settings | `browserState.settings.read`, maybe `browserState.settings.write` | unit coverage plus settings/package smoke for any visible setting | partial required |
| Profiles/profile menu | profile indicator/menu | broad preload profile IPC and profile resolver | adapter returns null/empty/no-op | `browser-state-api` for display, trusted/shell for switching | switching can relaunch shell/profile | display current profile safely; profile creation/switching remains bundled-only or shell-owned until scoped | `browserState.profiles.read`, later `profiles.switch` | smoke for visible profile menu behavior | proposed deferral unless visible controls require it |
| Window controls | title bar buttons, menus | broad preload window IPC and Electron menu | adapter no-ops | `surface-control-api` or `window.*` shell API | shell/main owns BrowserWindow | package visible window controls call narrow owner-window methods or are hidden in test environment | `windows.control` | unit coverage for method/capability plus package smoke for visible fullscreen control | implemented for owner-window title/close/minimize/maximize/fullscreen |
| Ant/IPFS/Radicle node status | node menu/sidebar | renderer node UI reads service status through broad preload and settings | package smoke currently opens node menu; live node status is not fully asserted | `browser-state-api` or `services.*` read API | shell owns node lifecycle | expose read-only service status needed by visible node menu; start/stop remains shell-owned and scoped | `services.read`, later narrower write caps | package smoke for node menu behavior and no silent controls | required for visible tested controls, live-node details may be deferred |
| Wallet sidebar button | toolbar button | `initSidebar` and `initWalletUi` run in bundled mode and use wallet/identity globals | package mode skips sidebar/wallet init; button initially remained visible with no handler | `surface-control-api` | wallet surface is shell-owned | button must call shell-owned surface control, be hidden, or be explicitly disabled with smoke coverage | `surfaces.wallet.control` | official package smoke proving hidden behavior until the real trusted surface migrates; fixture smoke proving placeholder surface control | shell-owned placeholder API implemented; real wallet surface still pending trusted prompt migration |
| Wallet connect | website provider request | page/provider code coordinates with renderer wallet UI and main permission stores | package chrome has no wallet globals; low-risk `eth_chainId` now bypasses package chrome | `provider-path`, then `trusted-surface` | shell-owned trusted prompt | guest content talks to main provider broker; package chrome does not broker or render final approval | provider capabilities are not package chrome caps | deterministic package provider-flow smoke | low-risk bypass implemented; full wallet UX still pending trusted prompt migration |
| Transaction send/sign | website/dApp or wallet UI | wallet UI and wallet IPC under broad preload | unavailable to package chrome | `provider-path`, `trusted-surface` | shell-owned transaction/signing prompt | final approval rendered by shell-owned trusted surface; package chrome can only request surface/open state | none for package provider; surface caps only | trusted broker doc/tests before migration | proposed deferral for full migration |
| Typed-data sign | website/dApp | wallet/dApp signing UI under bundled renderer | unavailable to package chrome | `provider-path`, `trusted-surface` | shell-owned signing prompt | same as transaction sign | none for package provider; surface caps only | trusted broker doc/tests before migration | proposed deferral for full migration |
| Identity onboarding | user in chrome/sidebar | onboarding and identity UI under bundled renderer with `window.identity` | package mode skips onboarding and lacks identity global | `trusted-surface` | shell-owned identity surface | ordinary package chrome may request open; vault creation/unlock/export remains shell-owned | `surfaces.identity.open` later | smoke for hidden/disabled/request behavior | proposed deferral unless visible |
| Vault unlock | user or privileged flow | bundled wallet/identity UI and identity IPC | unavailable to package chrome | `trusted-surface` | shell-owned vault prompt | shell-owned prompt broker derives context and returns structured outcome | trusted prompt request cap, not identity raw API | broker unit/integration test | broker foundation required; full UX proposed deferral |
| Seed/private-key export | user in wallet settings | bundled wallet settings uses identity/wallet IPC | unavailable to package chrome | `trusted-surface` | shell-owned export prompt | must remain shell-owned; never package-rendered | none for package chrome | negative API exposure tests | proposed deferral for full UX |
| dApp permissions | website provider flow and permissions UI | renderer/provider and permission stores | package lacks dApp permission globals | `provider-path`, `trusted-surface` for grants | shell-owned permission prompt | main derives committed origin and permission key; package can display read-only summaries later | no package provider caps | provider bypass smoke and permission broker tests | provider safety required |
| Swarm provider connect/request | website content | renderer Swarm provider and main Swarm provider IPC | package lacks swarm provider globals | `provider-path`, `trusted-surface` | shell-owned Swarm prompt | guest content talks to main broker; package chrome does not broker | none for package chrome | provider bypass smoke where harness supports it | safety required, full prompt migration later |
| Swarm publish | website/app or chrome UI | bundled wallet/sidebar publish flow | unavailable to package chrome | `trusted-surface` | shell-owned publish prompt | package may request trusted publish/setup surface only | surface or trusted prompt cap | broker doc/tests | proposed deferral for full publish UX |
| Swarm feed update/publish | website/app | bundled Swarm feed approval UI | unavailable to package chrome | `trusted-surface` | shell-owned approval prompt | shell-owned approval through broker | trusted prompt cap | broker doc/tests | proposed deferral for full UX |
| x402 approvals | network intercept/provider | x402 intercept and bundled sidebar approval UI | adapter x402 methods/events are no-ops | `trusted-surface`, sometimes `provider-path` | shell-owned payment prompt | final approval in shell-owned prompt; package chrome may surface status only | trusted prompt or surface cap, not raw x402 IPC | no silent no-op smoke if visible | proposed deferral for full UX; broker foundation required |
| Package install/update/recovery UI and package origin | shell package runtime | main package store, feed, rollback, bundled safe chrome recovery | existing local package recovery works; UI remains bundled recovery path; cached packages now load from `freedom-chrome://active/` | `trusted-surface` for final warnings; shell-owned package scheme for cached package assets | shell/bundled safe chrome | package cannot render final recovery/install trust warnings; cached package assets are served only from verified active package files | package-management caps only later | fallback/rollback smoke plus package-origin path traversal and verified-file tests | package origin implemented for cached packages; future UI remains shell-owned |
| Provider injection into guest content | guest webview content | guest preload/provider bridges plus main handlers | transitional package webviews are manifest-gated and hardened | `provider-path` | shell/main owns preload and identity | package cannot choose guest preload/prefs; guest content still receives provider globals where supported | not package chrome capabilities | package smoke: no package provider globals, guest provider present, low-risk request works | low-risk `eth_chainId` bypass implemented |

## Package Runtime API No-Op Audit

The package adapter lives in `src/renderer/lib/chrome-runtime-api.js`. By
completion, each method below must either delegate to a real `freedomShell`
API, be hidden or disabled in package mode with smoke coverage, or be recorded
as a user-approved deferral. Proposed deferrals in this table are not approved
by this document.

| Method(s) | Start behavior in package mode | Visible feature risk | Required disposition |
| --- | --- | --- | --- |
| `setBzzBase`, `clearBzzBase`, `setRadBase`, `clearRadBase` | return `{ success: true }` without shell work | service status/settings can misrepresent node base changes | replace with service/settings shell APIs if visible controls depend on them, or hide/disable related controls with smoke coverage |
| `setWindowTitle` | no-op | window title may be stale | implemented through `freedomShell.setWindowTitle()` and `windows.control` |
| `closeWindow`, `minimizeWindow`, `maximizeWindow`, `toggleFullscreen` | no-op | title bar/menu controls can become clickable silent no-ops | implemented through owner-window `freedomShell` methods and `windows.control`; visible fullscreen menu action has package smoke coverage |
| `newWindow`, `openUrlInNewWindow` | no-op | menu/context controls can silently fail | implemented through `freedomShell.newWindow()` / `openUrlInNewWindow(url)` and `windows.open`; visible New Window menu action has package smoke coverage, while direct context-menu open-URL smoke remains pending if needed for final parity |
| `showAbout` | no-op | menu item can silently fail | implemented through shell-owned `freedomShell.showAbout()` and `app.about`; native About-panel observation is unit-covered, not clicked in launched smoke to avoid modal test interference |
| `checkForUpdates`, `restartAndInstallUpdate` | no-op | update UI can mislead | implemented as shell-owned updater action requests through `app.updates`; updater policy, dialogs, ownership locks, and install behavior remain in main |
| `getPlatform` | delegates through `freedomShell.getInfo()` | low risk | keep delegated and covered by package adapter/preload tests |
| `getActiveProfile`, `listProfiles`, `createProfile`, `openProfile` | null/empty/false | profile menu may render incomplete or inert | expose safe profile display read; profile mutation/switching is proposed deferred unless visible controls require it |
| `resolveExternalNodeCandidates`, `onExternalNodeCandidates` | no-op | external-node prompt can disappear | shell-owned service prompt or bundled-only/hidden behavior |
| `onProfileUpdated` | no-op | profile UI cannot react | implement event if profile display becomes package-visible |
| `onCloseMenus` | no-op | global menu close commands may not reach chrome | implement if shell menu commands target package chrome, otherwise document not used |
| `onOpenPublishSetup` | no-op | publish setup requests can silently fail | shell-owned surface request or hidden/disabled publish entry |
| `onUpdateNotification` | no-op | update notifications absent | shell-owned update notification path or bundled-only deferral |
| `onNewTab`, `onCloseTab`, `onNewTabWithUrl`, `onNavigateToUrl`, `onLoadUrl`, `onReload`, `onHardReload`, `onNextTab`, `onPrevTab`, `onMoveTabLeft`, `onMoveTabRight`, `onReopenClosedTab` | no-op event subscriptions | native menu/shortcut commands may not control package tabs | existing tab shell APIs cover direct UI actions; add command/event bridge or hide native menu commands in package mode |
| `onToggleDevTools`, `onCloseDevTools`, `onCloseAllDevTools` | no-op | developer controls may fail silently | package-safe devtools command policy or hidden/disabled behavior |
| `onFocusAddressBar` | no-op | shortcut/menu focus may fail | shell command/event bridge if shortcut is visible/supported |
| `onToggleBookmarksBar`, `setBookmarkBarToggleEnabled`, `setBookmarkBarChecked` | no-op | bookmark bar menu state can be wrong | browser-state settings API plus shell command/event bridge if menu remains exposed |
| `updateTabMenuState` | no-op | native tab menu state may be wrong | package tab state event or package-mode menu disabled state |
| `getSettings` | now delegates to `freedomShell.getSettings()` with hard-coded defaults only if the shell method is unavailable | wallet/sidebar/bookmark bar/settings page state can be wrong if writes remain unsupported | read path implemented through `browserState.settings.read`; ordinary settings writes still pending if visible controls require them |
| `saveSettings` | returns `false` | visible settings controls can silently fail | delegate ordinary settings writes or disable/hide unsupported settings with tests |
| `getBookmarks` | now delegates to `freedomShell.getBookmarks()` with `[]` only if the shell method is unavailable | bookmarks bar is empty despite default bookmarks | implemented through `browserState.bookmarks.read` |
| `addBookmark`, `updateBookmark`, `removeBookmark` | now delegate to `freedomShell` bookmark write methods with `false` only if unavailable | add/edit/delete bookmark controls can silently fail | API path implemented through `browserState.bookmarks.write`; direct UI smoke still pending |
| `resolveEns`, `invalidateEnsContent` | delegate to `freedomShell` navigation methods | covered by existing package navigation smoke | keep delegated |
| `resolveEnsAddress`, `resolveEnsReverse` | return `null` | wallet/identity name display can be incomplete | proposed deferred unless visible package UI needs them |
| `getHistory` | now delegates to `freedomShell.getHistory()` with `[]` only if unavailable | autocomplete lacks history | implemented through `browserState.history.read` |
| `addHistory` | now delegates to `freedomShell.addHistory()` with `false` only if unavailable | history recording can silently fail | implemented through `browserState.history.write` |
| `removeHistory`, `clearHistory` | return `false` | history management can silently fail | package chrome currently uses webview internal page APIs for history management; revisit if host chrome exposes these controls |
| `x402GetDetails`, `x402Approve`, `x402Reject`, `x402ResumeUnlock`, `x402RefreshBalances`, `x402Cancel`, `x402GetReceipts`, `x402GetAllPermissions`, `x402RevokePermission`, `x402RevokeAllForOrigin`, `x402UpdatePermission` | null/false/empty | payment approval or permission UI would be unsafe if re-enabled through package chrome | keep raw x402 APIs unavailable; migrate through shell-owned trusted prompt/surface broker or hide/disable |
| `onX402ApprovalNeeded`, `onX402ApprovalResult`, `onX402UnlockNeeded`, `onX402CapConsumed`, `onX402BalancesUpdated` | no-op subscriptions | x402 UI can silently miss events | do not expose raw event authority to package chrome; broker/surface only |
| `getWebviewPreloadPath` | returns `null` | package must not choose guest preload | keep unavailable; main enforces guest preload in `will-attach-webview` |
| `saveImage`, `copyText`, `readClipboardText`, `copyImageFromUrl` | false/failure defaults | context menu and clipboard/image controls can fail silently | expose narrow clipboard/download APIs only if controls remain visible, otherwise disable/hide with tests |
| `getCachedFavicon` | now delegates to `freedomShell.getCachedFavicon()` with `null` only if unavailable | tabs/bookmarks/autocomplete can lack cached icons | implemented through `browserState.favicons.read` |
| `getFavicon`, `fetchFavicon`, `fetchFaviconWithKey` | return `null` | newly visited pages may not fetch/cache fresh icons in package mode | keep network fetch shell-owned until a scoped favicon-write/fetch capability is designed |

## Checkpoint Gates

Browser-state implementation may start after this document exists and the
progress ledger records the audit. Surface-control and provider-flow work must
wait until the browser-state checkpoint has green unit tests and package smoke.
Trusted prompt broker work must wait until a provider-flow bypass test proves
guest content talks to main without package chrome in the path.

## Surface-Control Status

The first `surface-control-api` slice implements `surfaces.wallet.control` for
`getSurfaceState`, `openSurface`, `closeSurface`, and `toggleSurface` through
the sender-checked `window.freedomShell` bridge. The result is a caller-scoped
shell-owned placeholder state for `wallet` only. Unsupported surfaces return a
structured `SURFACE_UNSUPPORTED` result, and callers without the capability are
denied by the shell API policy.

This checkpoint intentionally does not migrate wallet, identity, provider,
signing, vault, x402, or Swarm approval UI into package mode. The official
package chrome still hides the wallet/sidebar affordance until a real
shell-owned trusted wallet surface exists, while the fixture package smoke
exercises the placeholder surface-control path.

## Window-Control Status

The first window-control slice implements `windows.control` for
`setWindowTitle`, `closeWindow`, `minimizeWindow`, `maximizeWindow`, and
`toggleFullscreen` through the sender-checked `window.freedomShell` bridge.
Each command resolves the BrowserWindow from the calling package sender and
cannot target arbitrary windows.

This checkpoint exists to remove visible chrome/menu silent no-ops. It does not
expose Electron, BrowserWindow objects, native menus, or app updater APIs to
package chrome. The official package smoke exercises the visible fullscreen
menu action by recording the owner BrowserWindow `setFullScreen(true/false)`
calls through this shell-owned path.

## System Menu Command Status

The first app/system command slice implements `windows.open`, `app.about`, and
`app.updates` for package chrome menu actions. `newWindow()` and
`openUrlInNewWindow(url)` request the existing shell-owned window factory;
`showAbout()` requests the Electron About panel; `checkForUpdates()` and
`restartAndInstallUpdate()` request the existing shell updater actions.

These commands return only serializable request results. They do not expose
`BrowserWindow`, native menus, `autoUpdater`, dialogs, profile locks, install
state, or Electron primitives to package chrome. The official package smoke
exercises the visible New Window menu item by opening a second package chrome
window and closing it again.

## Trusted Prompt Broker Status

The first broker foundation lives in `src/main/trusted-prompt-broker.js` and is
documented in `docs/trusted-prompt-broker.md`. It implements a test-only
`trustedPrompts.requestTest` method behind `trustedPrompts.test`.

The test broker proves the required boundary shape:

- package chrome can request a brokered prompt result only through
  `window.freedomShell`
- the request is sender-checked and capability-gated
- the result says the surface owner is `shell` and the renderer is
  `trusted-prompt-broker`
- package-supplied `origin`, `tabId`, URL, label, and permission-key claims are
  not trusted as final security truth
- package chrome still receives no wallet, identity, provider, x402, Swarm,
  vault, signing, Node, Electron, or arbitrary IPC authority

This checkpoint does not migrate wallet connect, transaction/signing,
typed-data signing, x402 approvals, Swarm publish/feed approvals, or vault
unlock. Those flows must use main-derived guest/request context and a real
shell-owned prompt surface before they can be called complete in package mode.

## Package Origin Status

Cached packages installed through the local store now load through the
shell-owned `freedom-chrome://active/` origin instead of raw `file://` URLs.
Direct `FREEDOM_CHROME_PACKAGE_DIR` development packages remain file-based for
local authoring, but store-backed installs and cached launches use the scheme.

The active package protocol handler:

- serves only files declared in the active package manifest
- rejects dot-segment traversal and encoded path separators
- rechecks each served file's SHA-256 hash against the active manifest record
- refuses undeclared package files and store metadata
- avoids exposing arbitrary package filesystem paths in package-visible URLs
- applies a package CSP header compatible with the current official renderer

This is still a local/offline package-origin model. It does not add Swarm
download, package signatures, marketplace install UI, or community package
provenance.

## Runtime Diagnostics Status

Package-visible diagnostics are treated as shell API output, not raw internal
main-process state. `freedomShell.getInfo()` derives its public package
descriptor from the registered sender identity for package callers instead of
the global active package. This keeps multiple package or recovery windows from
observing another caller's package id, source, version, capabilities, or
runtime mode through the top-level `chromePackage` field.

Fallback diagnostics exposed through `getInfo()` keep stable error codes and
safe relative package paths, but strip or redact filesystem roots, requested
package/feed/store paths, install paths, entry/preload paths, and nested
validation causes that would otherwise leak local package-store details.
