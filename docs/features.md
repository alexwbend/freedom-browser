# Features

## Decentralized Network Architecture

Freedom runs Swarm, IPFS, and Radicle nodes, an experimental Myotis Ethereum light client, and optional Tor routing, giving you access to decentralized and onion networks from a single interface.

|                          | Swarm                                         | IPFS                                 | Radicle                           |
| ------------------------ | --------------------------------------------- | ------------------------------------ | --------------------------------- |
| **Protocol**             | `bzz://`                                      | `ipfs://`, `ipns://`                 | `rad://`                          |
| **Node Software**        | Ant (antd, bee-compatible)                    | freedom-ipfs native                  | radicle-node + radicle-httpd      |
| **Hash Format**          | 64 or 128-char hex (encrypted refs supported) | CIDv0 (`Qm...`) or CIDv1 (`bafy...`) | Repository ID (`z...`)            |
| **Managed Gateway Port** | 11633+                                        | internal native handler              | 18780+                            |
| **Managed API Port**     | 11633+                                        | internal native handler              | 18780+                            |
| **Managed P2P Port**     | 12633+                                        | internal native handler              | 18776+                            |
| **Route Prefix**         | `/bzz/{hash}/`                                | `/ipfs/{cid}/`, `/ipns/{name}/`      | `/api/v1/repos/{rid}/`            |
| **Data Directory**       | `<profile>/ant-data/`                         | `<profile>/ipfs-data/freedom-ipfs/`  | profile-scoped short Radicle home |
| **Binary Directory**     | `ant-bin/`                                    | `native/freedom-ipfs-node/`          | `radicle-bin/`                    |

## Smart Node Connection

Freedom manages nodes per browser profile:

1. **Independent Managed Nodes**: By default, each profile has separate Ant, native IPFS, Myotis, Radicle, and Tor data. Ant, Radicle, and Tor use profile-specific non-default ports; IPFS and Myotis run as embedded native clients without loopback API or gateway ports.
2. **Explicit External Nodes**: Profiles can opt into external Swarm/Radicle endpoints or an external Tor SOCKS5 endpoint in profile settings. External node identity, storage, or circuit state is shared outside that profile. IPFS and Myotis always use their embedded native clients.
3. **Port Conflict Handling**: If a managed Ant, Radicle, or Tor profile port is busy, Freedom picks a free profile port and persists the reassignment.
4. **Visual Feedback**: The Nodes panel and profile settings show whether a node is managed, external/shared, or disabled.

This means Freedom works seamlessly whether you:

- Run it standalone (bundled Swarm and native IPFS nodes start automatically; Radicle is optional and behind an Experimental setting)
- Create multiple independent browser profiles with their own browser data, vault, and managed node state
- Already have system-wide Swarm/Radicle daemons running and explicitly configure a profile to use them
- Have port conflicts with other software (Freedom finds and records available profile ports)

On macOS, the packaged app explicitly allows multiple bundle instances so profile
launching can use `open -n -a Freedom --args --profile=<id>`.

## Profiles and Sidebar

- **Independent Profiles**: Each profile has separate tabs, history, settings, wallets, identities, and managed node data.
- **Side-by-Side Windows**: Open multiple profiles in separate windows; macOS launches distinct application instances when needed.
- **Profile Manager**: Create, rename, open, and remove profiles from `freedom://profiles`.
- **Browser Sidebar**: Switch between wallet, node, and settings panels without leaving the active page.

## Integrated Swarm Node (Ant)

- **Toolbar Toggle**: Click the network icon to access the Nodes panel with independent on/off switches.
- **Live Statistics**: View connected peers, visible network peers, and the Ant node version in real-time.
- **DHT Client Mode**: Runs in ultra-light mode for minimal bandwidth and resource usage.
- **Automatic Configuration**: First-run setup generates keys and config automatically.

## Integrated IPFS Native Node

- **Independent Toggle**: Start and stop IPFS separately from Swarm.
- **Native Transport**: Uses the embedded `freedom-ipfs` native addon instead of a loopback Kubo process.
- **Live Diagnostics**: View native gateway stats and request progress while IPFS/IPNS pages load.

## Integrated Myotis Light Client (Experimental)

- **Per-profile clients**: Ethereum and Gnosis have independent native runtimes and state for each browser profile.
- **Independent controls**: Each chain has separate startup, runtime, synchronization, peer, and finalized-block controls.
- **Verified chain data**: Wallet and compatible dApp reads can prefer Myotis before falling back through the configured Colibri and RPC methods.
- **No loopback API**: Myotis runs in-process through its native addon and does not expose a managed port.

## Tor `.onion` Access (Experimental)

- **Onion-only routing**: When enabled, Freedom routes only `.onion` hosts through the profile's Arti SOCKS5 proxy; clearnet and decentralized protocols remain direct.
- **Fail-closed behavior**: If Arti stops unexpectedly, `.onion` requests fail instead of falling back to direct DNS.
- **Profile isolation**: Managed Tor state, cache, endpoint, and private-window routing are profile-scoped.
- **Optional binary**: Source builds require `npm run tor:download`; bundled Tor is currently available on macOS and Linux.

## Integrated Radicle Node (macOS & Linux)

- **Two-Process Architecture**: Manages both `radicle-node` (P2P network) and `radicle-httpd` (HTTP API) as a coordinated pair.
- **Automatic Identity**: Creates a Radicle identity on first run (no manual setup required).
- **Experimental Gate**: Radicle is controlled via **Settings → Experimental → Enable Radicle integration (Beta)**.
- **Node Toggle**: Once enabled, start and stop Radicle from the Nodes panel.
- **Live Statistics**: View connected peers, seeded repos, version, and Node ID.
- **Repository Seeding**: Seed Radicle repositories directly from the browser to help replicate them across the network.
- **Stale Socket Cleanup**: Automatically cleans up control sockets from unclean shutdowns.
- **Port Conflict Resolution**: Uses profile-specific managed ports and persists reassignment if one is unavailable.
- **Windows**: Radicle is not available on Windows yet (no upstream binaries). The Experimental settings section is hidden on Windows builds.

## Universal Address Bar

Enter any of the following in the address bar:

| Input Type    | Example                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| Swarm Hash    | `a1b2c3...` (64 or 128 hex characters)                                      |
| Swarm URL     | `bzz://a1b2c3.../path/to/file.html`                                         |
| IPFS CID      | `QmHash...` or `bafybeic...`                                                |
| IPFS URL      | `ipfs://QmHash.../path`                                                     |
| IPNS URL      | `ipns://k51...` or `ipns://domain.eth`                                      |
| Radicle ID    | `rad://z3gqc...`                                                            |
| Onion URL     | `http://example.onion`                                                      |
| Ethereum Name | `vitalik.eth`, `mysite.box`, `alice.wei`, `apoorv.gwei`, `mysite.eth/about` |
| Tezos Domain  | `mysite.tez`, `ipfs://mysite.tez/docs`                                      |
| HTTP(S) URL   | `https://example.com`                                                       |
| Domain        | `example.com` (auto-prefixes `https://`)                                    |

The address bar also provides **autocomplete suggestions** from browsing history as you type.

## Ethereum Name Resolution

- **Automatic Resolution**: `.eth`, `.box`, `.wei`, and `.gwei` domains resolve to their Swarm, IPFS, or IPNS content. `.eth` and `.box` use ENS; `.wei` uses Wei Name Service (WNS); `.gwei` uses Gwei Name Service (GNS).
- **CCIP-Read Support**: `.box` domains resolve via offchain CCIP-Read (EIP-3668) through 3dns.xyz.
- **Protocol Detection**: Automatically detects and routes to Swarm (`bzz://`), IPFS (`ipfs://`), or IPNS (`ipns://`) content.
- **Transport-Aware Address Bar**: After resolution, the address bar shows the resolved transport with the name as the host — e.g. `vitalik.eth` resolves and displays as `ipfs://vitalik.eth`, a Swarm-backed `mysite.eth` displays as `bzz://mysite.eth`, a WNS-backed `alice.wei` displays as `ipfs://alice.wei`, and a GNS-backed `apoorv.gwei` displays as `ipfs://apoorv.gwei`. The legacy `ens://` form is still accepted as input (and stored bookmarks keep working) but is no longer the canonical display.
- **Typed Scheme Is an Assertion**: Typing `bzz://name.eth`, `ipfs://name.eth`, `ipns://name.eth`, or the equivalent `.wei`/`.gwei` forms only resolves if the contenthash matches the typed transport. Mismatches surface as a "resolves to X, not Y" message rather than silently switching transports — same rule the `bzz://` protocol handler enforces for subresource fetches. Bare names and the legacy `ens://` form make no assertion and accept any supported transport.
- **Path Forwarding**: Paths appended to names (e.g., `mysite.eth/docs`, `alice.wei/docs`, `apoorv.gwei/docs`) are preserved after resolution.
- **In-HTML Links**: Ethereum name links inside web pages must carry a scheme — `ens://name.eth`, `bzz://name.eth`, `ipfs://name.eth`, `ipns://name.eth`, `bzz://name.wei`, `ipfs://name.wei`, `ipns://name.wei`, `bzz://name.gwei`, `ipfs://name.gwei`, or `ipns://name.gwei`. Bare hrefs like `<a href="vitalik.eth">` are relative URLs by HTML/URL-spec rules and resolve against the page's base before any of our handlers see them; bare names are only resolved in the address bar, where input is always absolute.

## Tezos Domains Website Resolution

- **Native on-chain resolution**: Bare `.tez` names are resolved directly from the Tezos Domains mainnet registry through three public Tezos RPC endpoints. Freedom follows the upgradeable proxy, discovers the annotated records and expiry big maps, pins all providers to one block, and requires a 2-of-3 matching result before marking it verified. Set `TEZOS_RPC` to prepend an additional endpoint; it must serve Tezos **mainnet**, since the chain ID is verified on every lookup.
- **Published website records**: `web:redirect_url` takes precedence over `web:content_url`, matching Tezos Domains publishing semantics. HTTP(S) records navigate directly; IPFS and IPNS records stay on Freedom's native transports and keep the `.tez` name as the page origin.
- **Paths and assertions**: A base path embedded in the published URI is preserved when an address-bar path is appended. Typed `ipfs://name.tez` and `ipns://name.tez` forms assert that transport; `ens://name.tez` is intentionally rejected because `.tez` is not ENS.
- **Expiry and caching**: Expired domains do not resolve. Positive cache entries honor `td:ttl` within a bounded lifetime and never outlive the on-chain expiry; negative results use a short cache.

## Tabbed Browsing

- **Multiple Tabs**: Open multiple pages simultaneously with `Cmd+T`.
- **Tab Management**: Close tabs with `Cmd+W` or middle-click.
- **Audio Indicators & Mute**: Tabs playing sound show a speaker icon; click it (or use "Mute Tab" in the tab context menu) to mute or unmute the tab. Mute survives navigation within the tab.
- **Drag & Drop Reordering**: Rearrange tabs by dragging.
- **Per-Tab State**: Each tab maintains its own navigation history, address bar state, and bzz/ipfs base.
- **Link Handling**: Links that open new windows are captured and opened in new tabs instead.

## Navigation Controls

- **Back/Forward**: Standard browser history navigation per tab.
- **Reload**: Refresh the current page (ignores cache). On error pages, retries the original URL.
- **Stop**: Cancel page loading mid-request.
- **Home**: Return to the welcome page.
- **Keyboard Shortcuts** (defaults; remap them under Settings > Shortcuts — click a binding, press the new combination, changes apply immediately; `Cmd+Q`, the standard Cut/Copy/Paste/Select-All/Undo set, and `F12` stay reserved):
  - `Cmd+N` / `Ctrl+N`: New window
  - `Cmd+T` / `Ctrl+T`: New tab
  - `Cmd+W` / `Ctrl+W` / `Ctrl+F4`: Close tab
  - `Cmd+Shift+T` / `Ctrl+Shift+T`: Reopen last closed tab
  - `Ctrl+PgDn` / `Ctrl+Tab`: Next tab
  - `Ctrl+PgUp` / `Ctrl+Shift+Tab`: Previous tab
  - `Ctrl+Shift+PgDn`: Move tab right
  - `Ctrl+Shift+PgUp`: Move tab left
  - `Cmd+R` / `Ctrl+R`: Reload (from cache)
  - `Cmd+Shift+R` / `Ctrl+Shift+R`: Hard reload (bypass cache)
  - `Cmd+F` / `Ctrl+F`: Find in page (`Enter` next match, `Shift+Enter` previous, `Esc` close)
  - `Cmd+Shift+B` / `Ctrl+Shift+B`: Toggle bookmark bar
  - `Cmd+Shift+J` / `Ctrl+Shift+J`: Downloads
  - `F11`: Toggle fullscreen
  - `F12` / `Cmd+Alt+I` / `Ctrl+Shift+I`: Developer Tools
  - `Cmd+=` / `Ctrl+=`: Zoom in
  - `Cmd+-` / `Ctrl+-`: Zoom out
  - `Cmd+0` / `Ctrl+0`: Reset zoom
  - `Cmd+P` / `Ctrl+P`: Print
  - `Escape`: Stop loading or restore address bar

## Bookmarks

- **Address Bar Star**: Click the star icon to bookmark or unbookmark the current page.
- **Supported Protocols**: Bookmark any `bzz://`, `ipfs://`, `ipns://`, `rad://`, `http://`, or `https://` URL.
- **Named Bookmarks**: Name and edit bookmarks via modal or right-click.
- **Bookmarks Bar**: Quick access below the toolbar, with an overflow menu when bookmarks don't fit. Always visible on the new tab page; toggle visibility on other pages with `Cmd+Shift+B` / `Ctrl+Shift+B` (persisted across sessions).

## Browsing History

- **Automatic Recording**: Pages are recorded as you browse.
- **History Page**: View and search your browsing history at `freedom://history`.

## Downloads

- **Download Manager**: Every download — http(s), `bzz://`, `ipfs://`/`ipns://`, and data URIs — is tracked with progress, pause/resume, and cancel.
- **Shelf**: A compact card in the bottom corner shows progress and offers Cancel; on completion it offers Open and Show in Folder, then dismisses itself. Files are never opened automatically.
- **Downloads Page**: View and search download history at `freedom://downloads` (`Cmd+Shift+J` / `Ctrl+Shift+J`), with per-item open / show-in-folder / remove and Clear All.
- **Save Location**: Files land in the OS Downloads folder by default; enable "Ask where to save each file" under Settings > Downloads for a save dialog per download.

## Ad Blocking

- **Request Blocking**: Blocks ads and trackers with Ghostery's blocking engine.
- **List Categories**: Configure EasyList, EasyPrivacy, cookie-notice, and annoyance lists independently.
- **Authenticated Updates**: Optional Swarm-delivered updates require a pinned signer, valid manifest shape, increasing version, and matching content hashes before activation.
- **Per-Site Allowlist**: Exempt individual hosts from filtering in Settings.

## Wallet and dApp Integration

- **Multiple Accounts**: Create and manage software wallets per profile.
- **Ledger Support**: Connect Ledger Ethereum accounts over USB and confirm signatures and transactions on the device.
- **Ethereum Provider**: Sites can request wallet access, signatures, and transactions through the permissioned `window.ethereum` provider.
- **Swarm Provider**: Permissioned `window.swarm` APIs cover publishing, chunks, feeds, signing identities, and messaging.
- **Radicle Provider**: Permissioned `window.radicle` APIs cover repository data, node operations, signing, and seeding; see the [provider reference](radicle-provider-api.md).
- **x402 Payments**: Approve pay-as-you-browse requests, configure per-origin auto-pay allowances, and inspect payment history.

## Context Menus

Right-click on pages for context-sensitive actions:

- **Page Context**: Back, Forward, Reload, View Page Source, Inspect
- **Link Context**: Open Link in New Tab, Open Link in New Window, Copy Link Address
- **Selection Context**: Copy selected text
- **Image Context**: Open Image in New Tab, Save Image As, Copy Image, Copy Image Address
- **View Page Source**: Opens `view-source:` URL in a new tab

## Request Rewriting

- **Automatic Path Rewriting**: Absolute paths in decentralized content (e.g., `/images/logo.png`) are automatically rewritten to stay within the current hash/CID for IPFS (`/ipfs/`, `/ipns/`) and Radicle (`/api/v1/repos/`) content.
- **Per-Tab Tracking**: Each tab tracks its own content base for correct path resolution.
- **Swarm (`bzz://`)**: Handled by a custom protocol handler rather than gateway rewriting — see [Swarm content retrieval](protocols/swarm.md).

## Debug Console

- **Toggle via Menu**: Open the hamburger menu (☰) and click "Debug Console".
- **Console Logs**: Captures JavaScript console output from loaded pages.
- **Navigation Events**: Shows page load, navigation, and error events.
- **Timestamps**: All messages include timestamps for debugging.
- **Clear/Close**: Clear the log or close the panel with dedicated buttons.
- **CLI Logging**: Debug messages also appear in the terminal.

## Internal Pages

Access built-in browser pages using the `freedom://` protocol:

| Page                      | Description                  |
| ------------------------- | ---------------------------- |
| `freedom://home`          | Welcome/home page            |
| `freedom://downloads`     | Download manager             |
| `freedom://history`       | Browsing history             |
| `freedom://links`         | Link behavior test page      |
| `freedom://payments`      | x402 payment history         |
| `freedom://profiles`      | Browser profile manager      |
| `freedom://protocol-test` | Protocol and media test page |
| `freedom://publish`       | Publish files to Swarm       |
| `freedom://settings`      | Browser and network settings |
| `rad://{rid}`             | Radicle repository browser   |

## Settings & UI

- **Theme**: Light, Dark, or System (follows OS preference).
- **Node Auto-start**: Toggle whether Swarm and IPFS nodes start automatically at launch (enabled by default).
- **Site Permissions**: When a site asks to use your camera, microphone, notifications, clipboard, location, or MIDI devices, a prompt appears under the address bar (Allow / Block, with "Remember for this site"). Remembered decisions are listed under Settings → Site Permissions with per-permission, per-site, and remove-all revocation; sites with granted permissions show an indicator icon in the address bar with quick revoke.
- **Ad Blocking**: Choose filter categories, automatic list updates, and per-host exemptions.
- **Shortcuts**: Search and remap browser commands with conflict detection and per-command reset.
- **Chains and RPC Providers**: Configure chain endpoints, keyed providers, and ENS verification behavior.
- **Experimental**: Enable Radicle integration (Beta) and set `Start Radicle node when Freedom opens`.
- **Auto-Updates**: Toggle automatic update checks (enabled by default).
- **Protocol Icons**: Address bar shows Swarm (hexagon), IPFS (cube), Radicle (seedling), or HTTP (globe) icon based on current protocol.
- **Hamburger Menu**: Access browser features (New Tab, New Window, History, Zoom, Print, Developer Tools, Settings, About).

## Error Handling

- **Friendly Error Pages**: Clear error messages with the original URL preserved.
- **Feature-Gated Radicle Errors**: Opening `rad://` while integration is disabled shows: `Radicle integration is disabled. Enable it in Settings > Experimental`.
- **Retry on Reload**: Pressing reload on an error page retries the original request.
- **Graceful Degradation**: Navigation errors don't crash the browser.
