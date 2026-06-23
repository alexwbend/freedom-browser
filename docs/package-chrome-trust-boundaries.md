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
| Bookmark add/update/remove | package chrome UI | `bookmarks-ui.js` calls `electronAPI.addBookmark/updateBookmark/removeBookmark` | adapter returned `false`, making visible controls fail silently | `browser-state-api` | none | package delegates writes if controls remain visible; otherwise controls must be disabled/hidden with smoke coverage | `browserState.bookmarks.write` | unit coverage plus package smoke for add/edit/remove behavior | implemented; official package smoke covers add modal, context-menu edit, and context-menu delete |
| Bookmark bar visibility setting | package chrome UI and menu | `bookmarks-ui.js` reads `settings.showBookmarkBar`; menu IPC toggles state | package default returned `showBookmarkBar: false`; menu event was no-op | `browser-state-api`, package command event | none | package reads current setting, persists package-safe browser UI settings, and receives native bookmark-bar toggle commands through a shell event bridge | `browserState.settings.read`, `browserState.settings.write`, `chrome.ui.commands` | package smoke for settings writes and native bookmark-bar menu toggle | implemented |
| History/autocomplete read | address bar UI | autocomplete/navigation use `electronAPI.getHistory` and main `src/main/history.js` | adapter returned `[]` | `browser-state-api` | none | expose history read if package autocomplete depends on it | `browserState.history.read` | harness-populated autocomplete smoke when implemented | implemented for autocomplete |
| History add/remove/clear | navigation lifecycle and history controls | renderer records visits with `electronAPI.addHistory`; internal history UI uses remove/clear IPC | adapter returned `false` for mutation gaps | `browser-state-api` | none | package delegates history writes through narrow shell methods for visible browser-state behavior | `browserState.history.write` | unit and smoke coverage for recording/delete/clear or explicit disabled behavior | API implemented for add/remove/clear |
| Favicons | tabs, bookmarks, autocomplete | renderer calls favicon IPC in `src/main/favicons.js` | adapter returned `null` | `browser-state-api` | none | package delegates cached reads and scoped favicon fetch/cache writes through shell methods | `browserState.favicons.read`, `browserState.favicons.write` | unit coverage and smoke if icons are asserted | cached read and scoped fetch/cache implemented |
| Settings | settings page, UI init, feature flags | `settings-store.js` via broad preload | adapter returned startup defaults and `saveSettings: false` | `browser-state-api` | settings page is ordinary browser UI except privileged settings | package reads narrow settings required for visible chrome; writes only a package-safe browser UI subset while service/node/provider settings remain shell-owned | `browserState.settings.read`, `browserState.settings.write` | unit coverage plus package smoke proving unsafe keys are ignored | package-safe read/write subset implemented; broader settings/service controls pending audit |
| Profiles/profile menu | profile indicator/menu | broad preload profile IPC and profile resolver | adapter returned null/empty/no-op, hiding or weakening profile menu behavior | `browser-state-api` for display, trusted/shell for switching | switching can relaunch shell/profile | package delegates safe current-profile/profile-list display reads to `freedomShell`; profile creation/switching controls are disabled in package mode and remain bundled-only/shell-owned until a scoped trusted switching surface exists | `browserState.profiles.read`, later `profiles.switch` only if approved | unit coverage plus official package smoke for visible profile menu display and disabled create/switch behavior | read-only display implemented; switching/mutation not exposed |
| Window controls | title bar buttons, menus | broad preload window IPC and Electron menu | adapter no-ops | `surface-control-api` or `window.*` shell API | shell/main owns BrowserWindow | package visible window controls call narrow owner-window methods or are hidden in test environment | `windows.control` | unit coverage for method/capability plus package smoke for visible fullscreen control | implemented for owner-window title/close/minimize/maximize/fullscreen |
| Ant/IPFS/Radicle node status | node menu/sidebar | renderer node UI reads service status through broad preload and settings | package smoke opened the node menu but did not prove status/control behavior | `services.*` read API | shell owns node lifecycle and external-node prompts | package delegates read-only service registry/status/binary reads to `freedomShell`; start/stop and raw local endpoints remain shell-owned and unavailable to package chrome; default-port external-node candidate prompts fall back to shell-owned native dialogs for package windows | `services.read`, later narrower write caps only if approved | package smoke for sanitized status reads, broad node API absence, disabled lifecycle controls, and unit coverage for package-window native prompt fallback | read-only status implemented; package windows do not receive legacy external-node prompt IPC |
| Wallet sidebar button | toolbar button | `initSidebar` and `initWalletUi` run in bundled mode and use wallet/identity globals | package mode skips sidebar/wallet init; button initially remained visible with no handler | `surface-control-api` | wallet surface is shell-owned | button must call shell-owned surface control, be hidden, or be explicitly disabled with smoke coverage | `surfaces.wallet.control` | official package smoke proving hidden behavior until the real trusted surface migrates; fixture smoke proving placeholder surface control | shell-owned placeholder API implemented; real wallet surface still pending trusted prompt migration |
| Wallet connect | website provider request | page/provider code coordinates with renderer wallet UI and main permission stores | package chrome has no wallet globals; low-risk `eth_chainId` now bypasses package chrome | `provider-path`, then `trusted-surface` | shell-owned trusted prompt | guest content talks to main provider broker; package chrome does not broker or render final approval | provider capabilities are not package chrome caps | deterministic package provider-flow smoke | low-risk bypass implemented; full wallet UX still pending trusted prompt migration |
| Transaction send/sign | website/dApp or wallet UI | wallet UI and wallet IPC under broad preload | unavailable to package chrome | `provider-path`, `trusted-surface` | shell-owned transaction/signing prompt | final approval rendered by shell-owned trusted surface; package chrome can only request surface/open state | none for package provider; surface caps only | trusted broker doc/tests before migration | proposed deferral for full migration |
| Typed-data sign | website/dApp | wallet/dApp signing UI under bundled renderer | unavailable to package chrome | `provider-path`, `trusted-surface` | shell-owned signing prompt | same as transaction sign | none for package provider; surface caps only | trusted broker doc/tests before migration | proposed deferral for full migration |
| Identity onboarding | user in chrome/sidebar | onboarding and identity UI under bundled renderer with `window.identity` | package mode skips onboarding and lacks identity global | `trusted-surface` | shell-owned identity surface | ordinary package chrome may request open; vault creation/unlock/export remains shell-owned | `surfaces.identity.open` later | smoke for hidden/disabled/request behavior | proposed deferral unless visible |
| Vault unlock | user or privileged flow | bundled wallet/identity UI and identity IPC | unavailable to package chrome | `trusted-surface` | shell-owned vault prompt | shell-owned prompt broker derives context and returns structured outcome | trusted prompt request cap, not identity raw API | broker unit/integration test | broker foundation required; full UX proposed deferral |
| Seed/private-key export | user in wallet settings | bundled wallet settings uses identity/wallet IPC | unavailable to package chrome | `trusted-surface` | shell-owned export prompt | must remain shell-owned; never package-rendered | none for package chrome | negative API exposure tests | proposed deferral for full UX |
| dApp permissions | website provider flow and permissions UI | renderer/provider and permission stores | package lacks dApp permission globals | `provider-path`, `trusted-surface` for grants | shell-owned permission prompt | main derives committed origin and permission key; package can display read-only summaries later | no package provider caps | provider bypass smoke and permission broker tests | provider safety required |
| Swarm provider connect/request | website content | renderer Swarm provider and main Swarm provider IPC | package lacks swarm provider globals | `provider-path`, `trusted-surface` | shell-owned Swarm prompt | guest content talks to main broker; package chrome does not broker | none for package chrome | provider bypass smoke where harness supports it | safety required, full prompt migration later |
| Swarm publish | website/app or chrome UI | bundled wallet/sidebar publish flow and `freedom://publish` internal page | unavailable to package chrome | `trusted-surface` | shell-owned publish prompt | package-hosted publish/setup entry points are visibly unavailable until a shell-owned publish prompt exists | surface or trusted prompt cap | broker doc/tests plus official package smoke for disabled `freedom://publish` controls | package-hosted direct publish page disabled with `SWARM_PUBLISH_UNAVAILABLE`; full publish UX remains proposed deferral pending a real shell-owned prompt |
| Swarm feed update/publish | website/app | bundled Swarm feed approval UI | unavailable to package chrome | `trusted-surface` | shell-owned approval prompt | shell-owned approval through broker | trusted prompt cap | broker doc/tests | proposed deferral for full UX |
| x402 approvals | network intercept/provider | x402 intercept and bundled sidebar approval UI | adapter x402 methods/events are no-ops | `trusted-surface`, sometimes `provider-path` | shell-owned payment prompt | final approval in shell-owned prompt; package chrome may surface status only | trusted prompt or surface cap, not raw x402 IPC | no silent no-op smoke if visible | raw x402 host events are not delivered to package chrome; package-hosted approval/unlock UI unavailability passes the 402 through safely, while full UX remains proposed deferral pending a real shell-owned prompt |
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
| `setBzzBase`, `clearBzzBase`, `setRadBase`, `clearRadBase` | returned `{ success: true }` without shell work | service status/settings can misrepresent node base changes | now return structured `SERVICE_BASE_UNAVAILABLE` results in package mode; package chrome receives sanitized read-only service status through `services.read`, while local endpoint bases and node lifecycle remain shell-owned |
| `setWindowTitle` | no-op | window title may be stale | implemented through `freedomShell.setWindowTitle()` and `windows.control` |
| `closeWindow`, `minimizeWindow`, `maximizeWindow`, `toggleFullscreen` | no-op | title bar/menu controls can become clickable silent no-ops | implemented through owner-window `freedomShell` methods and `windows.control`; visible fullscreen menu action has package smoke coverage |
| `newWindow`, `openUrlInNewWindow` | no-op | menu/context controls can silently fail | implemented through `freedomShell.newWindow()` / `openUrlInNewWindow(url)` and `windows.open`; visible New Window menu action and direct page context-menu Open Link in New Window have package smoke coverage |
| `showAbout` | no-op | menu item can silently fail | implemented through shell-owned `freedomShell.showAbout()` and `app.about`; native About-panel observation is unit-covered, not clicked in launched smoke to avoid modal test interference |
| `checkForUpdates`, `restartAndInstallUpdate` | no-op | update UI can mislead | implemented as shell-owned updater action requests through `app.updates`; updater policy, dialogs, ownership locks, and install behavior remain in main |
| `getPlatform` | delegates through `freedomShell.getInfo()` | low risk | keep delegated and covered by package adapter/preload tests |
| `getActiveProfile`, `listProfiles`, `createProfile`, `openProfile` | null/empty/false | profile menu may render incomplete or inert | `getActiveProfile` and `listProfiles` now delegate to `freedomShell` display-only profile APIs; `createProfile` and `openProfile` return structured package-mode unavailable results, and visible package controls are disabled |
| `resolveExternalNodeCandidates`, `onExternalNodeCandidates` | no-op | external-node prompt can disappear or hang before node startup | package windows no longer receive legacy external-node prompt IPC; main falls back to a shell-owned native dialog for package windows, and `resolveExternalNodeCandidates` returns structured `EXTERNAL_NODE_PROMPT_UNAVAILABLE` in package mode |
| `onProfileUpdated` | no-op | profile UI cannot react | implemented through a sanitized `browserState.profiles.updated` shell event gated by `browserState.profiles.read` |
| `onCloseMenus` | no-op | global menu close commands may not reach chrome | implemented through `chrome.ui.commands` shell events for system-menu-open/window-blur close-menu requests |
| `onOpenPublishSetup` | no-op | publish setup requests can silently fail | package windows no longer receive the legacy publish-setup renderer event; package-hosted internal pages receive structured `PUBLISH_SETUP_UNAVAILABLE`, and `freedom://settings/startup` disables the visible setup action with that message in official package smoke |
| `onUpdateNotification` | no-op | update notifications absent | implemented through the `app.updates.notification` shell event gated by `app.updates`; package chrome receives only the existing toast payload, while updater policy and install behavior remain in main |
| `onNewTab`, `onCloseTab`, `onNewTabWithUrl`, `onNavigateToUrl`, `onLoadUrl`, `onReload`, `onHardReload`, `onNextTab`, `onPrevTab`, `onMoveTabLeft`, `onMoveTabRight`, `onReopenClosedTab` | no-op event subscriptions | native menu/shortcut commands may not control package tabs | package adapter now subscribes to `chrome.ui.commands` shell events for native menu, guest window-open, and custom-protocol navigation delivery; smoke covers native New Tab, Close Tab, and Reload |
| `onToggleDevTools`, `onCloseDevTools`, `onCloseAllDevTools` | no-op | developer controls may fail silently | package adapter now subscribes to `chrome.ui.commands` shell events; native toggle and shutdown close-all are bridged to package windows, and official package smoke covers native Developer Tools toggle delivery to the active webview |
| `onFocusAddressBar` | no-op | shortcut/menu focus may fail | implemented through `chrome.ui.commands`; official package smoke covers native Focus Address Bar |
| `onToggleBookmarksBar`, `onToggleBookmarkBar`, `setBookmarkBarToggleEnabled`, `setBookmarkBarChecked` | no-op | bookmark bar menu state can be wrong | singular native toggle command is implemented through `chrome.ui.commands` plus `browserState.settings.write` and smoke-covered; plural legacy hook remains unused/no-op; checked/enabled native menu state updates now delegate through `freedomShell` shell requests, are tracked per owning BrowserWindow, and official package smoke covers native checked/enabled state |
| `updateTabMenuState` | no-op | native tab menu state may be wrong | implemented through `freedomShell.updateTabMenuState()` and `chrome.ui.commands`; official package smoke covers tab menu enabled/disabled state for one-tab and two-tab package chrome states |
| `getSettings` | now delegates to `freedomShell.getSettings()` with hard-coded defaults only if the shell method is unavailable | wallet/sidebar/bookmark bar/settings page state can be wrong if writes remain unsupported | read path implemented through `browserState.settings.read` |
| `saveSettings` | now delegates to `freedomShell.saveSettings()` with `false` only if the shell method is unavailable | visible settings controls can silently fail | implemented for package-safe browser UI settings through `browserState.settings.write`; service/node/provider settings in the payload are ignored and remain shell-owned |
| `getBookmarks` | now delegates to `freedomShell.getBookmarks()` with `[]` only if the shell method is unavailable | bookmarks bar is empty despite default bookmarks | implemented through `browserState.bookmarks.read` |
| `addBookmark`, `updateBookmark`, `removeBookmark` | now delegate to `freedomShell` bookmark write methods with `false` only if unavailable | add/edit/delete bookmark controls can silently fail | implemented through `browserState.bookmarks.write`; official package smoke covers the add-bookmark modal, bookmark context-menu edit, and bookmark context-menu delete paths |
| `resolveEns`, `invalidateEnsContent` | delegate to `freedomShell` navigation methods | covered by existing package navigation smoke | keep delegated |
| `resolveEnsAddress`, `resolveEnsReverse` | return `null` | wallet/identity name display can be incomplete | proposed deferred unless visible package UI needs them |
| `getHistory` | now delegates to `freedomShell.getHistory()` with `[]` only if unavailable | autocomplete lacks history | implemented through `browserState.history.read` |
| `addHistory`, `removeHistory`, `clearHistory` | now delegate to `freedomShell` history write methods with `false` only if unavailable | history recording or management can silently fail | implemented through `browserState.history.write` |
| `x402GetDetails`, `x402Approve`, `x402Reject`, `x402ResumeUnlock`, `x402RefreshBalances`, `x402Cancel`, `x402GetReceipts`, `x402GetAllPermissions`, `x402RevokePermission`, `x402RevokeAllForOrigin`, `x402UpdatePermission` | null/false/empty | payment approval or permission UI would be unsafe if re-enabled through package chrome | keep raw x402 APIs unavailable; package-hosted approval/unlock UI unavailability passes the 402 through safely; migrate full UX through shell-owned trusted prompt/surface broker or hide/disable |
| `onX402ApprovalNeeded`, `onX402ApprovalResult`, `onX402UnlockNeeded`, `onX402CapConsumed`, `onX402BalancesUpdated` | no-op subscriptions | x402 UI can silently miss events | package chrome no longer receives raw x402 host events; broker/surface only |
| `getWebviewPreloadPath` | returns `null` | package must not choose guest preload | keep unavailable; main enforces guest preload in `will-attach-webview` |
| `saveImage`, `copyText`, `readClipboardText`, `copyImageFromUrl` | false/failure defaults | context menu and clipboard/image controls can fail silently | `copyText`, `copyImageFromUrl`, and `saveImage` now delegate to narrow `freedomShell` APIs gated by `clipboard.write` / `downloads.saveImage`; `saveImage` does not return the selected file path to package chrome; `readClipboardText` remains unavailable in package mode, the custom address-bar Paste item is disabled, and keyboard paste remains browser/input-mediated with package smoke coverage |
| `getCachedFavicon` | now delegates to `freedomShell.getCachedFavicon()` with `null` only if unavailable | tabs/bookmarks/autocomplete can lack cached icons | implemented through `browserState.favicons.read` |
| `getFavicon`, `fetchFavicon`, `fetchFaviconWithKey` | now delegate to `freedomShell` favicon write/fetch methods with `null` only if unavailable | newly visited pages may not fetch/cache fresh icons in package mode | implemented through scoped `browserState.favicons.write`; main still owns network fetch and cache writes |

## Profile Browser-State Status

Package chrome can now render the active profile indicator and profile menu
through `browserState.profiles.read`. The shell API returns only display-safe
fields: profile id, display name, source, dev flag, active flag, and
unregistered flag. It deliberately omits profile roots, user data directories,
node configuration, timestamps, catalog metadata, and launch details.

Profile creation and profile switching remain shell-owned/bundled-only. The
package renderer adapter returns structured unavailable results for
`createProfile()` and `openProfile()`, and visible profile creation/switching
controls are disabled in package mode. A future switching API needs a separate
trusted surface/launch contract before package chrome can request it.

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
`app.updates` for package chrome menu actions and update notifications.
`newWindow()` and
`openUrlInNewWindow(url)` request the existing shell-owned window factory;
`showAbout()` requests the Electron About panel; `checkForUpdates()` and
`restartAndInstallUpdate()` request the existing shell updater actions.
`onUpdateNotification()` subscribes to a capability-gated shell event carrying
the same serializable toast payload bundled chrome receives.

These commands return only serializable request results. They do not expose
`BrowserWindow`, native menus, `autoUpdater`, dialogs, profile locks, install
state, or Electron primitives to package chrome. The official package smoke
exercises the visible New Window menu item by opening a second package chrome
window and closing it again.

## Native Chrome Command Event Status

Package chrome now receives ordinary shell-originated browser UI commands over
the same `shell:event` channel used by earlier package events. The event names
live in `src/shared/shell-api-policy.js`, require the `chrome.ui.commands`
capability, and are delivered only to registered package windows. Bundled
chrome keeps the legacy direct IPC path.

The bridge covers native/system menu and shell-originated requests for menu
closing, address-bar focus, tab creation/closing/traversal/move/reopen,
reload/hard reload, bookmark-bar toggle, DevTools toggle/close, guest
window-open, and custom-protocol navigation. Official package smoke covers the
native application menu paths for New Tab, Focus Address Bar, Reload, Close
Tab, and Always Show Bookmarks Bar.

This does not expose Electron menu objects, accelerators, arbitrary IPC, or
BrowserWindow authority to package chrome. Package chrome now reports native
tab-menu enabled state and bookmark-bar checked/enabled state through
sender-checked `freedomShell` requests gated by `chrome.ui.commands`; main
normalizes the state payload and applies it through menu-owned handlers.

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

## Swarm Publish Page Status

The direct `freedom://publish` internal page is intentionally unavailable when
it is hosted inside package chrome. The page still exists as bundled trusted UI,
but its path-based publish, file/folder picker, upload-status, stamp-read, and
publish-history IPC calls return structured `SWARM_PUBLISH_UNAVAILABLE` when
main detects that the internal page's `hostWebContents` is a registered package
window. The page surfaces that result and disables Publish File, Publish
Folder, and Publish Text in official package smoke.

This does not implement the final Swarm publish/feed approval UX. That remains
a shell-owned trusted prompt/surface migration: package chrome may eventually
request the surface, but it must not receive raw publish paths, stamp
management authority, feed signing authority, or final approval rendering
authority.

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
