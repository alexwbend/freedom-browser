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
| History add/remove/clear | navigation lifecycle and history controls | renderer records visits with `electronAPI.addHistory`; internal history UI uses remove/clear IPC | adapter returned `false` for mutation gaps | `browser-state-api` | none | package delegates history writes through narrow shell methods for visible browser-state behavior | `browserState.history.write` | unit and smoke coverage for recording/delete/clear or explicit disabled behavior | API implemented for add/remove/clear; official package smoke covers the visible History menu path, hosted `freedom://history` rendering, and entry removal through page controls |
| Favicons | tabs, bookmarks, autocomplete | renderer calls favicon IPC in `src/main/favicons.js` | adapter returned `null` | `browser-state-api` | none | package delegates cached reads and scoped favicon fetch/cache writes through shell methods | `browserState.favicons.read`, `browserState.favicons.write` | unit coverage and smoke if icons are asserted | cached read and scoped fetch/cache implemented |
| Settings | settings page, UI init, feature flags | `settings-store.js` via broad preload | adapter returned startup defaults and `saveSettings: false`; package-hosted internal settings could call raw `settings:save` through `freedomAPI` | `browser-state-api` for browser UI settings, `trusted-surface`/shell-owned for service/provider settings | shell/main for node, provider, updater, and identity-affecting settings | package reads narrow settings required for visible chrome; writes only a package-safe browser UI subset while service/node/provider/updater settings remain shell-owned or disabled in package-hosted settings | `browserState.settings.read`, `browserState.settings.write` | unit coverage plus package smoke proving unsafe keys and visible controls are restricted | package-safe read/write subset implemented; package-hosted `settings:save` is filtered to the same safe subset; startup/experimental shell-owned controls are disabled in package mode |
| Network/RPC provider settings | user in `freedom://settings/chains`, `freedom://settings/rpc`, or ENS resolution settings | internal settings page uses `freedomAPI` network IPC to mutate chain registry, RPC endpoints, provider API keys, and ENS verification strategy | package-hosted internal settings could reach raw network/provider IPC through the transitional internal-page bridge | `trusted-surface`/shell-owned provider configuration | shell/main owns provider, ENS, and wallet/dApp endpoint configuration | package-hosted settings render deterministic unavailable states for Chains, RPC Providers, and ENS network configuration; main rejects package-hosted network IPC before registry/provider/cache mutation | none for package chrome | IPC unit coverage plus official package smoke for disabled/unavailable settings pages | implemented |
| Profiles/profile menu | profile indicator/menu | broad preload profile IPC and profile resolver | adapter returned null/empty/no-op, hiding or weakening profile menu behavior | `browser-state-api` for display, trusted/shell for switching | switching can relaunch shell/profile | package delegates safe current-profile/profile-list display reads to `freedomShell`; profile creation/switching controls are disabled in package mode and remain bundled-only/shell-owned until a scoped trusted switching surface exists | `browserState.profiles.read`, later `profiles.switch` only if approved | unit coverage plus official package smoke for visible profile menu display and disabled create/switch behavior | read-only display implemented; switching/mutation not exposed |
| Profile settings page | user in `freedom://settings/profiles` | internal settings page uses raw profile IPC for reads, creation/import, switching, delete, rename, and node configuration | transitional package-hosted internal page could call bundled profile management IPC through `freedomAPI` | `trusted-surface` for management, `browser-state-api` for display only | bundled trusted settings page until a shell-owned profile management surface exists | package-hosted page shows deterministic unavailable state; main rejects raw profile reads/mutations/node config with `PROFILE_MANAGEMENT_UNAVAILABLE` and does not broadcast raw `profile:updated` events into package chrome or package-hosted internal pages | none beyond `browserState.profiles.read` display APIs | IPC unit coverage plus official package smoke for disabled `freedom://settings/profiles` state | implemented |
| Window controls | title bar buttons, menus | broad preload window IPC and Electron menu | adapter no-ops | `surface-control-api` or `window.*` shell API | shell/main owns BrowserWindow | package visible window controls call narrow owner-window methods or are hidden in test environment | `windows.control` | unit coverage for method/capability plus package smoke for visible fullscreen control | implemented for owner-window title/close/minimize/maximize/fullscreen |
| Ant/IPFS/Radicle node status | node menu/sidebar | renderer node UI reads service status through broad preload and settings | package smoke opened the node menu but did not prove status/control behavior | `services.*` read API | shell owns node lifecycle and external-node prompts | package delegates read-only service registry/status/binary reads to `freedomShell`; start/stop and raw local endpoints remain shell-owned and unavailable to package chrome; default-port external-node candidate prompts fall back to shell-owned native dialogs for package windows | `services.read`, later narrower write caps only if approved | package smoke for sanitized status reads, broad node API absence, disabled lifecycle controls, and unit coverage for package-window native prompt fallback | read-only status implemented; package windows do not receive legacy external-node prompt IPC |
| Wallet sidebar button | toolbar button | `initSidebar` and `initWalletUi` run in bundled mode and use wallet/identity globals | package mode skipped sidebar/wallet init; button initially remained visible with no handler | `surface-control-api` | wallet surface is shell-owned | button requests and mirrors shell-owned surface state and must not initialize package-hosted wallet/identity UI | `surfaces.wallet.control` | official package smoke proving visible shell-owned trusted-window behavior and caller-scoped state-event updates; fixture smoke proving surface control | shell-owned trusted wallet window implemented and exercised by official package smoke; it displays public wallet accounts and dApp wallet permissions, can revoke dApp permissions, set the active wallet, create a derived wallet when the vault is already unlocked, rename wallets, delete non-main wallets after connected dApp grants are revoked, and export the vault seed phrase or a selected wallet private key after password verification through scoped trusted-window IPC, while identity onboarding, non-provider vault unlock/management, and richer signing/account review remain shell-owned future work |
| Wallet connect | website provider request | page/provider code coordinates with renderer wallet UI and main permission stores | package chrome has no wallet globals; low-risk `eth_chainId` now bypasses package chrome | `provider-path`, then `trusted-surface` | shell-owned trusted prompt | guest content talks to main provider broker; package chrome does not broker or render final approval | provider capabilities are not package chrome caps | deterministic package provider-flow smoke | package-hosted `eth_requestAccounts` now reaches a shell-owned trusted wallet approval window with main-derived account choices; accepted prompts return the selected account only after main revalidates the selected wallet index and writes the main-side dApp permission, rejection returns `shell_trusted_prompt_rejected`; `eth_accounts` reads existing main-owned grants |
| Transaction send/sign | website/dApp or wallet UI | wallet UI and wallet IPC under broad preload | unavailable to package chrome | `provider-path`, `trusted-surface` | shell-owned transaction/signing prompt | final approval rendered by shell-owned trusted surface; package chrome can only request surface/open state | none for package provider; surface caps only | trusted broker doc/tests and official package smoke before success migration | package-hosted `personal_sign` signs through a shell-owned trusted wallet approval window plus main/vault execution for connected origins; the window shows the connected account and bounded message review details; if the vault is locked after approval, main opens the shell-owned trusted vault-unlock window and retries only after successful unlock; package-hosted `eth_sendTransaction` now sends through a shell-owned trusted wallet approval window plus main-side account/chain validation, gas/fee preparation, vault access, trusted vault-unlock retry when needed, and the existing transaction recorder for connected origins; deprecated `eth_sign` still returns structured safe failures pending fuller account-selection UX |
| Typed-data sign | website/dApp | wallet/dApp signing UI under bundled renderer | unavailable to package chrome | `provider-path`, `trusted-surface` | shell-owned signing prompt | same as transaction sign | none for package provider; surface caps only | trusted broker doc/tests before success migration | package-hosted `eth_signTypedData`, `eth_signTypedData_v3`, and `eth_signTypedData_v4` now sign through the shell-owned trusted wallet approval window plus main/vault execution for connected origins, including shell-owned vault-unlock retry when signing first finds the vault locked; the approval window shows the connected account and bounded typed-data preview details; unsupported typed-data variants still safe-fail |
| Identity onboarding | user in chrome/sidebar | onboarding and identity UI under bundled renderer with `window.identity` | package mode skips onboarding and lacks identity global | `trusted-surface` | shell-owned identity surface | ordinary package chrome may request open; vault creation/unlock/export remains shell-owned | `surfaces.identity.open` later | smoke for hidden/disabled/request behavior | proposed deferral unless visible |
| Vault unlock | user or privileged flow | bundled wallet/identity UI and identity IPC | unavailable to package chrome | `trusted-surface` | shell-owned vault prompt | package-hosted x402 signing paths and package-hosted Ethereum signature/transaction paths use a shell-owned trusted vault-unlock window with a dedicated preload; identity onboarding and non-provider wallet creation/unlock UX stay shell-owned | trusted prompt request cap, not identity raw API | broker unit/integration test plus x402 and wallet-provider package-hosted retry coverage | implemented for package-hosted x402 sign/retry and wallet-provider signature/transaction retry; identity onboarding and broader non-provider vault unlock UX remain proposed deferrals |
| Seed/private-key export | user in wallet settings | bundled wallet settings uses identity/wallet IPC | unavailable to package chrome | `trusted-surface` | shell-owned export prompt | must remain shell-owned; never package-rendered | none for package chrome | negative API exposure tests plus trusted-wallet surface IPC tests | seed phrase and selected-wallet private-key export are implemented inside the shell-owned trusted wallet window through password-gated scoped IPC; package chrome still receives no identity, vault, mnemonic, or private-key API |
| dApp permissions | website provider flow and permissions UI | renderer/provider and permission stores | package lacks dApp permission globals | `provider-path`, `trusted-surface` for grants | shell-owned permission prompt | main derives committed origin and permission key; package can display read-only summaries later | no package provider caps | provider bypass smoke and permission broker tests | provider safety required |
| Swarm provider connect/request | website content | renderer Swarm provider and main Swarm provider IPC | package lacks swarm provider globals | `provider-path`, `trusted-surface` | shell-owned Swarm prompt | guest content talks to main broker; package chrome does not broker | none for package chrome | package smoke for guest Swarm provider presence, package global absence, direct low-risk capabilities request, shell-owned access grant, and structured package-mode prompt/failure behavior for privileged methods | low-risk `swarm_getCapabilities` bypass implemented; package-hosted `swarm_requestAccess` reaches a shell-owned trusted Swarm approval window, writes the main-owned Swarm permission after approval, and returns `shell_trusted_prompt_rejected` on rejection; package-hosted `swarm_publishData`, `swarm_publishFiles`, `swarm_publishChunk`, `swarm_createFeed`, `swarm_updateFeed`, `swarm_writeFeedEntry`, `swarm_getSigningIdentity`, and `swarm_writeSingleOwnerChunk` reach the same bundled trusted-window approval path with main-derived context and can execute after approval when grants and normal node/stamp/signer readiness allow; other higher-risk methods fail through main with `trusted_prompt_unavailable` |
| Swarm publish | website/app or chrome UI | bundled wallet/sidebar publish flow and `freedom://publish` internal page | unavailable to package chrome | `trusted-surface`, `surface-control-api` | shell-owned publish prompt/window | provider `swarm_publishData`, `swarm_publishFiles`, `swarm_publishChunk`, and `swarm_writeSingleOwnerChunk` may execute after shell-owned approval; package-hosted direct publish page stays raw-IPC unavailable but can request the shell-owned trusted publish window | `surfaces.swarmPublish.control` for package chrome surface control; provider prompt caps are not package chrome caps | broker doc/tests plus official package smoke for disabled `freedom://publish` controls, trusted-window open action, and provider publish/signing prompt behavior | package-hosted direct publish page still rejects raw publish/stamp/history IPC with `SWARM_PUBLISH_UNAVAILABLE`; the page offers an Open trusted publish window action that delegates to `surfaces.open("swarmPublish")`; the trusted window loads bundled publish UI with a dedicated preload and per-window scoped IPC for file/folder picker, stamp reads, upload status, text/file/folder publishing, publish history, clipboard copy, and opening published links through the host tab API |
| Swarm feed create/update/publish | website/app | bundled Swarm feed approval UI | unavailable to package chrome | `trusted-surface` | shell-owned approval prompt | shell-owned approval through broker | trusted prompt cap | broker doc/tests plus official package smoke for create/update/write-feed prompt behavior | package-hosted feed creation, existing-feed update, and feed-entry write now reach the shell-owned trusted Swarm approval window with main-derived context; accepted creation establishes an app-scoped feed grant in main and executes `swarm_createFeed`, while accepted update/write require an existing feed grant/feed record and execute `swarm_updateFeed` / `swarm_writeFeedEntry`; richer feed-review UX remains proposed deferral pending a full shell-owned feed review surface |
| x402 approvals | network intercept/provider | x402 intercept and bundled sidebar approval UI | adapter x402 methods/events were no-ops | `trusted-surface`, sometimes `provider-path` | shell-owned payment prompt and payments surface | final approval and vault unlock in shell-owned prompts; cap management and history in a shell-owned payments surface; package chrome may request surface state/open only | trusted prompt or `surfaces.payments.control`, not raw x402 IPC | package adapter unit coverage and launched package smoke for shell-owned prompt/no-host-event behavior plus trusted payments surface open path | raw x402 methods return structured `X402_PACKAGE_API_UNAVAILABLE`, raw x402 host events are not delivered to package chrome, and package-hosted payment approvals now sign/retry through a shell-owned trusted payment review window with a dedicated preload and main-derived payment details; recognized EIP-155 token payments can also create the bounded default 10-token/30-day cap through that prompt, with main using parsed grant details instead of renderer-supplied cap values and official package smoke covering the cap option plus locked-vault fallback; if signing hits a locked vault, package-hosted x402 opens a shell-owned trusted vault-unlock window and retries after successful unlock; cap editing/revocation and payment-history review are implemented in a shell-owned trusted payments window gated by `surfaces.payments.control` |
| Payment history page | user in chrome/internal page | `freedom://payments` reads unified payment history through internal page `freedomAPI` and can clear the store | package-hosted internal page could read and clear payment history through the transitional webview bridge | `trusted-surface` for sensitive payment history UI | shell-owned trusted payments window; bundled trusted chrome keeps direct page | package-hosted page is visibly unavailable for raw history reads but can request the shell-owned payments surface | `surfaces.payments.control` on the host package | IPC unit coverage plus official package smoke for disabled `freedom://payments` state and trusted-window open button | package-hosted payment-history read/count/by-id/clear IPC remains rejected with `PAYMENTS_UNAVAILABLE`; the page offers an Open trusted payments window action that delegates to the host package's capability-gated `surfaces.open("payments")`; the trusted payments window lists recent history and x402 caps and supports cap update/revoke/revoke-origin plus history clear |
| Package install/update/recovery UI and package origin | shell package runtime | main package store, feed, rollback, bundled safe chrome recovery | existing local package recovery works; UI remains bundled recovery path; cached packages now load from `freedom-chrome://active/` | `trusted-surface` for final warnings; shell-owned package scheme for cached package assets | shell/bundled safe chrome | package cannot render final recovery/install trust warnings; cached package assets are served only from verified active package files | package-management caps only later | fallback/rollback smoke plus package-origin path traversal and verified-file tests | package origin implemented for cached packages; future UI remains shell-owned |
| Provider injection into guest content | guest webview content | guest preload/provider bridges plus main handlers | transitional package webviews are manifest-gated and hardened | `provider-path` | shell/main owns preload and identity | package cannot choose guest preload/prefs; guest content still receives provider globals where supported | not package chrome capabilities | package smoke: no package provider globals, guest provider present, low-risk request works, brokered privileged methods bypass package chrome, unsupported methods safe-fail | low-risk `eth_chainId` and `swarm_getCapabilities` bypasses implemented; package-hosted Ethereum and Swarm privileged methods use main-derived shell-owned prompt paths where implemented and fail before package chrome can broker them where unsupported |

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
| `onToggleBookmarkBar`, `setBookmarkBarToggleEnabled`, `setBookmarkBarChecked` | no-op | bookmark bar menu state can be wrong | singular native toggle command is implemented through `chrome.ui.commands` plus `browserState.settings.write` and smoke-covered; the dead plural `onToggleBookmarksBar` package adapter shim was removed after confirming bundled preload does not expose that API; checked/enabled native menu state updates now delegate through `freedomShell` shell requests, are tracked per owning BrowserWindow, and official package smoke covers native checked/enabled state |
| `updateTabMenuState` | no-op | native tab menu state may be wrong | implemented through `freedomShell.updateTabMenuState()` and `chrome.ui.commands`; official package smoke covers tab menu enabled/disabled state for one-tab and two-tab package chrome states |
| `getSettings` | now delegates to `freedomShell.getSettings()` with hard-coded defaults only if the shell method is unavailable | wallet/sidebar/bookmark bar/settings page state can be wrong if writes remain unsupported | read path implemented through `browserState.settings.read` |
| `saveSettings` | now delegates to `freedomShell.saveSettings()` with `false` only if the shell method is unavailable | visible settings controls can silently fail | implemented for package-safe browser UI settings through `browserState.settings.write`; service/node/provider settings in the payload are ignored and remain shell-owned |
| `getBookmarks` | now delegates to `freedomShell.getBookmarks()` with `[]` only if the shell method is unavailable | bookmarks bar is empty despite default bookmarks | implemented through `browserState.bookmarks.read` |
| `addBookmark`, `updateBookmark`, `removeBookmark` | now delegate to `freedomShell` bookmark write methods with `false` only if unavailable | add/edit/delete bookmark controls can silently fail | implemented through `browserState.bookmarks.write`; official package smoke covers the add-bookmark modal, bookmark context-menu edit, and bookmark context-menu delete paths |
| `resolveEns`, `invalidateEnsContent` | delegate to `freedomShell` navigation methods | covered by existing package navigation smoke | keep delegated |
| `resolveEnsAddress`, `resolveEnsReverse` | return `null` | wallet/identity name display can be incomplete | now return ENS-shaped `ENS_WALLET_RESOLUTION_UNAVAILABLE` results in package mode; wallet/identity ENS address and reverse lookups remain reserved for shell-owned trusted surfaces until those surfaces migrate |
| `getHistory` | now delegates to `freedomShell.getHistory()` with `[]` only if unavailable | autocomplete lacks history | implemented through `browserState.history.read` |
| `addHistory`, `removeHistory`, `clearHistory` | now delegate to `freedomShell` history write methods with `false` only if unavailable | history recording or management can silently fail | implemented through `browserState.history.write` |
| `x402GetDetails`, `x402Approve`, `x402Reject`, `x402ResumeUnlock`, `x402RefreshBalances`, `x402Cancel`, `x402GetReceipts`, `x402GetAllPermissions`, `x402RevokePermission`, `x402RevokeAllForOrigin`, `x402UpdatePermission` | null/false/empty | payment approval or permission UI would be unsafe if re-enabled through package chrome | now return structured `X402_PACKAGE_API_UNAVAILABLE` results in package mode; package-hosted approval/unlock uses shell-owned prompts and cap/history management uses the shell-owned trusted payments surface instead of raw adapter APIs |
| `onX402ApprovalNeeded`, `onX402ApprovalResult`, `onX402UnlockNeeded`, `onX402CapConsumed`, `onX402BalancesUpdated` | no-op subscriptions | x402 UI can silently miss events | package chrome no longer receives raw x402 host events; broker/surface only |
| `getWebviewPreloadPath` | returns `null` | package must not choose guest preload | keep unavailable; main enforces guest preload in `will-attach-webview` |
| `saveImage`, `copyText`, `readClipboardText`, `copyImageFromUrl` | false/failure defaults | context menu and clipboard/image controls can fail silently | `copyText`, `copyImageFromUrl`, and `saveImage` now delegate to narrow `freedomShell` APIs gated by `clipboard.write` / `downloads.saveImage`; `saveImage` does not return the selected file path to package chrome; `readClipboardText` remains unavailable in package mode, the custom address-bar Paste item is disabled, and keyboard paste remains browser/input-mediated with package smoke coverage |
| `getSurfaceState`, `openSurface`, `closeSurface`, `toggleSurface`, `onSurfaceStateChanged` | unavailable through the renderer adapter while direct `freedomShell` methods existed | wallet/sidebar control could stay hidden, reach around the adapter, or fail to mirror shell-owned state changes | now delegate to `freedomShell` surface-control methods; `wallet` is gated by `surfaces.wallet.control`, `payments` is gated by `surfaces.payments.control`, `swarmPublish` is gated by `surfaces.swarmPublish.control`, and `surfaces.stateChanged` derives its required capability from the event surface; official package smoke proves wallet trusted-window behavior and the visible package-hosted payments and publish pages can open their shell-owned trusted windows |
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

## Profile Settings Page Status

The direct `freedom://settings/profiles` section is intentionally unavailable
for package-hosted internal pages. The bundled trusted settings page still owns
full profile management, including profile creation/import, switching, delete,
rename, and profile node-configuration edits. When the same internal page is
hosted inside package chrome, main returns structured
`PROFILE_MANAGEMENT_UNAVAILABLE` before raw profile reads or mutations reach
the profile resolver. The page surfaces that result, disables profile creation
controls, and replaces the profile/node list with a visible package-mode
message in official package smoke.

Raw `profile:updated` broadcasts are also withheld from registered package
chrome windows and their hosted internal pages. Package chrome receives only
the sanitized `browserState.profiles.updated` shell event when it declares
`browserState.profiles.read`.

## Checkpoint Gates

Browser-state implementation may start after this document exists and the
progress ledger records the audit. Surface-control and provider-flow work must
wait until the browser-state checkpoint has green unit tests and package smoke.
Trusted prompt broker work must wait until a provider-flow bypass test proves
guest content talks to main without package chrome in the path.

## Surface-Control Status

The first `surface-control-api` slice implemented `surfaces.wallet.control` for
the wallet placeholder state. The current wallet slice promotes it to a real
shell-owned trusted window with `mode: "shell-owned-trusted-window"`. The
payments slice adds `surfaces.payments.control` for the shell-owned trusted
payments window. The Swarm publish slice adds
`surfaces.swarmPublish.control` for the shell-owned trusted Swarm publish
window. All surfaces use `getSurfaceState(...)`,
`openSurface(...)`, `closeSurface(...)`, `toggleSurface(...)`, and the
surface-scoped `surfaces.stateChanged` event through the sender-checked
`window.freedomShell` bridge. Unsupported surfaces return a structured
`SURFACE_UNSUPPORTED` result, and callers without the surface-specific
capability are denied by the shell API policy for both methods and events.

Wallet, payments, and Swarm publish windows are bundled shell code with
dedicated preloads; only each trusted WebContents can call its scoped IPC
channels. The wallet window reads public wallet rows and dApp wallet
permissions in main, can revoke dApp wallet permissions, set the active
wallet, create derived wallets when the vault is already unlocked, rename
wallets, delete non-main wallets after connected dApp grants are revoked, and
export the vault seed phrase or a selected wallet private key after
vault-password verification without exposing wallet, identity, vault,
mnemonic, private-key, or dApp permission-store APIs to package chrome. The payments window reads recent
payment history and x402 caps in main and supports cap update, cap revoke,
revoke all caps for an origin, and payment-history clear without exposing
those operations to package chrome. The Swarm publish window loads the bundled
publish page as trusted shell UI with a dedicated preload and per-window
scoped IPC for file/folder picker, stamp reads, upload status,
text/file/folder publishing, publish history, clipboard copy, and host-tab
open requests without exposing raw Swarm publish IPC to package chrome. This
checkpoint still does not migrate identity onboarding, richer signing/account
review and switching, richer feed-review UX, or non-provider vault
unlock/management into package mode.

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

The broker foundation lives in `src/main/trusted-prompt-broker.js` and is
documented in `docs/trusted-prompt-broker.md`. It implements a test-only
`trustedPrompts.requestTest` method behind `trustedPrompts.test` and
package-hosted wallet prompt paths for `eth_requestAccounts`,
`eth_sendTransaction`, `eth_sign`, `personal_sign`, and `eth_signTypedData*`.

The test broker proves the required boundary shape:

- package chrome can request a brokered prompt result only through
  `window.freedomShell`
- the request is sender-checked and capability-gated
- the result says the surface owner is `shell` and the renderer is
  either `trusted-prompt-broker` for the synthetic test path or
  `shell-native-dialog` for the native-dialog test presentation
- the native-dialog test presentation is owned by main and attached to the
  package BrowserWindow; package chrome cannot render or supply that prompt UI
- package-supplied `origin`, `tabId`, URL, label, and permission-key claims are
  not trusted as final security truth
- package chrome still receives no wallet, identity, provider, x402, Swarm,
  vault, signing, Node, Electron, or arbitrary IPC authority

The wallet-connect prompt path can now succeed for a selected account: main
derives the guest origin and package host identity, presents the bundled
trusted wallet approval window with main-derived account choices, revalidates
the selected wallet index after acceptance, writes the dApp permission from
main, and returns the selected wallet address to the guest page.
Package-hosted `eth_accounts` reads existing main-owned grants without
prompting. Signature prompts can now sign `personal_sign` and
modern EIP-712 typed-data requests for connected origins; main checks the
permission and connected account, presents the trusted wallet approval window
with bounded message or typed-data review details, borrows the key through
`withVaultPrivateKey()`, signs in main, and returns only the signature. If
signing first finds the vault locked after the user accepts the shell-owned
signing prompt, main opens the shell-owned trusted vault-unlock window and
retries only after unlock succeeds. Transaction prompts can now send
`eth_sendTransaction` for connected origins when the user chooses Send: main
validates the requested account and chain, shows the trusted wallet approval
window with account/chain/recipient/value review details, fills gas and fee
fields through shell-owned wallet services, signs/broadcasts through the
existing transaction recorder, records dApp-send payment history, and returns
only the transaction hash. Locked-vault transaction signing uses the same
shell-owned unlock window and retry path. This still does not expose vault
primitives, raw wallet authority, or richer signing/account review to package
chrome. The
Swarm connect prompt
path now lets package-hosted `swarm_requestAccess` write the main-owned Swarm
permission after a shell-owned trusted-window Allow decision: main derives the
guest origin and package host identity and ignores payload-supplied origin claims.
Rejections still return a page-facing `4001`. The Swarm publish prompt path
lets package-hosted `swarm_publishData` and `swarm_publishFiles` execute after
a shell-owned trusted-window Publish decision: main derives the guest origin
and package host identity, validates display-safe payload details before
prompting, and executes through the existing main-owned provider publish path.
The Swarm feed prompt path lets package-hosted `swarm_createFeed` establish an
app-scoped feed grant and execute feed creation after a shell-owned
trusted-window Allow decision. It also lets package-hosted `swarm_updateFeed`
execute existing-feed updates after a shell-owned trusted-window Allow
decision, but only after main verifies the derived origin has a Swarm
permission, feed grant, and feed record. `swarm_writeFeedEntry` uses the same
shell-owned trusted-window feed prompt boundary
for existing feed-entry writes; main validates the payload shape and optional
index before prompting, shows only display-safe feed name and payload size
details, and writes through the existing main-owned provider path after
approval. These paths do not expose stamp management, enable the full publish
center, or expose raw Swarm IPC.
Package-hosted x402 approval and vault-unlock needs now also reach shell-owned
trusted windows. x402 payment approval can sign and queue the retry through the
existing main sign-flow when the user chooses Pay and the vault is unlocked.
For recognized EIP-155 token requirements, the trusted approval window can also
create the bounded default 10-token/30-day cap by returning a broker result
that main threads into the existing x402 permission store. Main derives
payment-review details from parsed x402 requirements and shows amount, asset,
network, recipient, and resource URL when present; cap values come from those
parsed requirements, not from renderer-supplied payload. Vault-unlock prompts
now receive those same parsed payment-review details when signing needs an
unlock. The approval and vault-unlock windows are bundled shell code with
dedicated preloads and scoped IPC; the vault prompt submits the password to
main, calls the identity vault unlock path, and only then lets x402 retry the
existing sign/retry flow. Package chrome still cannot receive raw x402 IPC,
raw vault state, raw cap-edit APIs, arbitrary payment permission APIs, or raw
payment-history IPC. Cap editing/revocation and payment-history review now
live in the shell-owned trusted payments window behind
`surfaces.payments.control`. Package-hosted Swarm publish entry points can now
open the shell-owned trusted publish window behind
`surfaces.swarmPublish.control`, while richer signing/account review,
identity/export vault management UX, and richer feed-review UX still need
main-derived guest/request context and real shell-owned prompt surfaces before
they can be called complete in package mode.

## Ethereum Provider Status

Package-hosted guest content receives the page-facing Ethereum provider under
the hardened transitional webview preload. The low-risk `eth_chainId` method
bypasses package chrome and goes from the guest preload directly to main over
`dapp:provider-readonly-request`.

Higher-risk Ethereum provider requests from package-hosted guest content ask
main for their host context before any host-renderer forwarding.
`eth_requestAccounts` uses the shell-owned wallet-connect prompt path: main
derives the guest origin and package host identity, presents the bundled
trusted wallet approval window with main-derived account choices, revalidates
the selected wallet index on acceptance, writes the dApp permission for that
wallet, and returns the selected account to the page without sending the
request through package chrome. Package-hosted `eth_accounts` reads existing
main-owned grants. `personal_sign`,
`eth_signTypedData`, `eth_signTypedData_v3`, and `eth_signTypedData_v4` use the
shell-owned trusted wallet approval window and sign in main through vault
access when the origin is already connected and the user chooses Sign; the
window shows the connected account plus bounded message or typed-data review
details. If the vault is locked, main opens the trusted vault-unlock window
and retries after successful unlock. `eth_sendTransaction` uses the
shell-owned trusted wallet approval window and sends in main through vault
access and the existing transaction recorder when the origin is already
connected, the account and chain match the grant, and the user chooses Send;
the window shows the connected account, chain, recipient, and value preview.
Locked-vault execution uses the same trusted unlock-and-retry path.
Deprecated `eth_sign` and unsupported signing variants still return structured
provider errors until richer shell-owned approval paths exist.
Other higher-risk methods still return `trusted_prompt_unavailable` until their
shell-owned prompt paths exist. Bundled trusted chrome keeps the legacy
renderer prompt path for those methods until the prompt migration is complete.

This checkpoint does not expose wallet globals, identity globals, raw wallet
IPC, dApp permission stores, raw signing authority, or final transaction
approval UI to package chrome. Wallet connect now supports selected-account
grants through the shell-owned prompt, and package-hosted signing uses the
connected account only; richer signing/account review and switching plus
broader non-provider vault unlock/management still require additional
shell-owned surface migration before wallet UX can be called complete in
package mode.

## Swarm Provider Status

Package-hosted guest content now receives the page-facing Swarm provider under
the same hardened transitional webview preload as bundled chrome. The
low-risk `swarm_getCapabilities` method bypasses package chrome and goes from
the guest preload directly to main over `swarm:provider-readonly-request`.
That read-only channel accepts only `swarm_getCapabilities`, returns structured
provider results to the page, and rejects publish/feed/signing methods.
Higher-risk Swarm provider requests from package-hosted guest content ask main
for their host context before any host-renderer forwarding.
`swarm_requestAccess` now uses a shell-owned trusted Swarm approval window:
main derives the guest origin and package host identity, presents bundled
trusted UI with a dedicated preload, and writes the Swarm permission in main
if the user chooses Allow. Existing permissions are read in main and update
last-used without prompting. `swarm_publishData`, `swarm_publishFiles`, and
`swarm_publishChunk` also use that trusted-window path: main derives the guest
origin and package host identity, validates data/files/chunk payloads before
prompting, and executes through the existing main-owned provider publish paths
if the user chooses Publish. `swarm_createFeed`
uses a shell-owned prompt path that validates the feed name, ensures an
app-scoped feed grant in main after approval, and executes the existing
main-owned feed-create path. `swarm_updateFeed` uses the same shell-owned feed
prompt boundary for existing feeds: main validates the reference, verifies the
feed grant and feed record before prompting, and executes the existing
main-owned feed-update path after approval. `swarm_writeFeedEntry` uses the
same shell-owned feed prompt boundary for existing feeds: main validates the
payload shape and optional index, verifies the feed grant and feed record
before prompting, and executes the existing main-owned feed-entry write path
after approval. `swarm_getSigningIdentity` and
`swarm_writeSingleOwnerChunk` use a shell-owned publisher signing prompt:
main verifies the derived origin has an existing Swarm permission and feed
grant before prompting, validates SOC identifiers/payload/span in main, and
executes through the existing signer/SOC provider paths only after the user
chooses Allow. Rejections still return structured
`shell_trusted_prompt_rejected` provider errors. Other higher-risk methods
still return `trusted_prompt_unavailable` until their shell-owned prompt paths
exist. Bundled trusted chrome keeps the legacy renderer prompt path for those
methods until the prompt migration is complete.

This checkpoint does not expose `window.swarmProvider`,
`window.swarmPermissions`, raw Swarm IPC, raw feed-store IPC, stamp-management
authority, vault-unlock authority, or final Swarm approval UI to package
chrome. `swarm_requestAccess` can grant only the main-derived guest origin, and
`swarm_publishData`, `swarm_publishFiles`, and `swarm_publishChunk` can succeed
only after shell-owned approval and normal node/stamp readiness.
`swarm_createFeed` can create only through the main-owned app-scoped feed
grant path after shell-owned approval and normal node/stamp/signer readiness.
`swarm_updateFeed` and `swarm_writeFeedEntry` can update only existing
main-owned feed records after shell-owned approval and normal
node/stamp/signer readiness. `swarm_getSigningIdentity` and
`swarm_writeSingleOwnerChunk` can disclose the active publisher identity or
write an SOC only for origins with existing Swarm permission/feed grants after
shell-owned trusted-window approval and normal vault/signer/node/stamp
readiness. Other higher-risk Swarm provider methods still require the trusted
prompt/surface migration before they can succeed in package mode.

## Swarm Publish Page Status

The direct `freedom://publish` internal page is intentionally unavailable when
it is hosted inside package chrome. The page still exists as bundled trusted UI,
but its path-based publish, file/folder picker, upload-status, stamp-read, and
publish-history IPC calls return structured `SWARM_PUBLISH_UNAVAILABLE` when
main detects that the internal page's `hostWebContents` is a registered package
window. The page surfaces that result and disables Publish File, Publish
Folder, and Publish Text in official package smoke. It also offers an Open
trusted publish window action that delegates to the host package's
capability-gated `surfaces.open("swarmPublish")` path.

The provider-path `swarm_publishData`, `swarm_publishFiles`,
`swarm_publishChunk`, `swarm_createFeed`, `swarm_updateFeed`,
`swarm_writeFeedEntry`, `swarm_getSigningIdentity`, and
`swarm_writeSingleOwnerChunk` approvals remain provider-path flows and do not
make package chrome a publish broker. The trusted Swarm publish window is
bundled shell code with a dedicated preload and per-window scoped IPC for the
existing publish page behavior. Package chrome may request the surface, but it
does not receive raw publish paths, stamp management authority, feed signing
authority, vault unlock, or final approval rendering authority.

## Payment History Page Status

The direct `freedom://payments` internal page is intentionally unavailable when
it is hosted inside package chrome. The page still exists as bundled trusted UI,
but its internal payment-history reads cover x402 micropayments, wallet sends,
and dApp-routed sends, and the page exposes a clear-history mutation. Main
returns structured `PAYMENTS_UNAVAILABLE` for package-hosted payment
read/count/by-id/clear IPC before touching the store. The page surfaces that
result and disables search, filters, and Clear all in official package smoke.

This does not implement the final shell-owned payment history surface or x402
approval UX. Package chrome must not receive raw payment history IPC or final
payment/vault approval rendering authority.

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
