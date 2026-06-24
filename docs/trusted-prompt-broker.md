# Trusted Prompt Broker

The trusted prompt broker is the main-process boundary for prompts whose final
security truth must not be rendered or decided by package chrome.

Package chrome may request a trusted prompt or surface through a narrow,
capability-gated shell API. Main derives or binds the security context, chooses
the shell-owned prompt implementation, and returns a serializable result.
Package chrome can display non-authoritative status around that result, but it
does not render the final approval moment and does not receive wallet,
identity, provider, x402, Swarm, vault, or signing authority.

## Implemented Slices

### Test-Only Package Prompt

The package-requested prompt slice is test-only:

```text
window.freedomShell.requestTestTrustedPrompt(payload)
  -> shell API method trustedPrompts.requestTest
  -> capability trustedPrompts.test
  -> src/main/trusted-prompt-broker.js
```

Accepted payload:

```json
{
  "kind": "test.confirmation",
  "reason": "Fixture package broker check",
  "presentation": "synthetic"
}
```

`presentation` is optional. The default is `synthetic`, which is the original
test-only broker result path. Tests may also request `native-dialog`, which
asks main to present the prompt through a shell-owned Electron native dialog
attached to the package window. That path is still test-only and still requires
`trustedPrompts.test`; it is not a production wallet, payment, publish, vault,
or signing prompt capability.

Result shape:

```json
{
  "ok": true,
  "requestId": "trusted-prompt-...",
  "kind": "test.confirmation",
  "trusted": true,
  "surfaceOwner": "shell",
  "renderedBy": "trusted-prompt-broker",
  "context": {
    "source": "main",
    "caller": {
      "runtimeMode": "local-package",
      "source": "local",
      "packageId": "baby.freedom.chrome.fixture",
      "packageType": "browser-chrome",
      "name": "Freedom Fixture Chrome",
      "version": "0.0.1"
    },
    "origin": null,
    "tabId": null
  },
  "request": {
    "reason": "Fixture package broker check"
  },
  "result": {
    "outcome": "accepted",
    "source": "test-only-broker"
  }
}
```

The native-dialog presentation returns the same shell-owned result shape, but
the renderer is the native shell dialog:

```json
{
  "ok": true,
  "requestId": "trusted-prompt-...",
  "kind": "test.confirmation",
  "trusted": true,
  "surfaceOwner": "shell",
  "renderedBy": "shell-native-dialog",
  "context": {
    "source": "main",
    "caller": {
      "runtimeMode": "local-package",
      "source": "local",
      "packageId": "baby.freedom.chrome.fixture",
      "packageType": "browser-chrome",
      "name": "Freedom Fixture Chrome",
      "version": "0.0.1"
    },
    "origin": null,
    "tabId": null
  },
  "request": {
    "reason": "Fixture native prompt check",
    "presentation": "native-dialog"
  },
  "result": {
    "outcome": "accepted",
    "source": "shell-native-dialog",
    "response": 0
  }
}
```

Package-supplied `origin`, `tabId`, URL, label, or permission-key claims are not
trusted. The current package-chrome test path intentionally returns
`origin: null` and `tabId: null` because no main-owned guest WebContents
identity has been bound to that test prompt.

Unsupported prompt kinds return:

```json
{
  "ok": false,
  "error": {
    "code": "TRUSTED_PROMPT_UNSUPPORTED",
    "message": "Unsupported trusted prompt kind"
  }
}
```

If a test requests the native-dialog presentation in an environment where main
cannot present it, the broker returns
`TRUSTED_PROMPT_PRESENTATION_UNAVAILABLE`. Package chrome cannot provide its own
native presenter or fall back to package-rendered prompt UI.

### Package-Hosted Wallet Connect Approval

Package-hosted guest content can now route
`ethereum.request({ method: "eth_requestAccounts" })` to main without package
chrome brokering the provider request:

```text
guest webview preload
  -> dapp:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker wallet.connect
  -> shell-owned trusted wallet approval window
  -> main-side dApp permission grant and page-facing account result
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims are not used as final security truth. The approval window is
bundled shell code with a dedicated preload and per-request scoped IPC
channels; package chrome cannot render or style the final approval moment.

If the user chooses Connect, the approval window returns the selected wallet
index from the main-derived account choices. Main revalidates that selected
wallet against the current wallet list, writes the dApp permission with the
derived origin and selected wallet index, and returns the selected wallet
address to the guest page. The approval window shows the accounts that can be
shared before the user decides:

```json
{
  "result": ["0x1111111111111111111111111111111111111111"],
  "error": null
}
```

If the user rejects the prompt, the page still receives an EIP-1193 `4001`
user rejection. Package-hosted `eth_accounts` reads existing main-owned dApp
permissions and returns the granted account without opening a prompt. This
does not expose wallet management or give package chrome dApp
permission-store authority.

### Package-Hosted Wallet Transaction And Signature Prompts

Package-hosted guest content can now route these higher-risk Ethereum provider
requests to main without package chrome brokering them:

- `eth_sendTransaction`
- `eth_sign`
- `personal_sign`
- `eth_signTypedData`
- `eth_signTypedData_v1`
- `eth_signTypedData_v3`
- `eth_signTypedData_v4`

The route is the same main-owned provider prompt path as wallet connect, but it
uses distinct broker kinds:

```text
guest webview preload
  -> dapp:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker wallet.transaction or wallet.signature
  -> shell-owned trusted wallet approval window
  -> shell-owned execution or page-facing provider error
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims and transaction/signature details are not trusted as final
security truth. Main supplies bounded display details to the approval window:
connected account, wallet index, chain id, transaction recipient/value, and
message or typed-data previews where available.

For connected origins, `personal_sign`, `eth_signTypedData`,
`eth_signTypedData_v3`, and `eth_signTypedData_v4` can now succeed when the
user chooses Sign and the vault is unlocked. Main checks the existing dApp
permission, verifies the requested signing account against the connected
account, shows the trusted wallet approval window, borrows the private key
through `withVaultPrivateKey()`, performs the signature in main, updates the
permission last-used timestamp, and returns only the signature to the guest
page:

```json
{
  "result": "0x...",
  "error": null
}
```

For connected origins, `eth_sendTransaction` can now succeed when the user
chooses Send and the vault is unlocked. Main checks the existing dApp
permission, verifies the requested `from` account against the connected
account, requires the transaction chain to match the granted chain, shows the
trusted wallet approval window, fills missing gas and fee fields through the
shell-owned wallet services, borrows the private key through
`withVaultPrivateKey()`, signs/broadcasts through the existing transaction
recorder, records dApp-send payment history, updates the permission last-used
timestamp, and returns only the transaction hash to the guest page:

```json
{
  "result": "0x...",
  "error": null
}
```

If the user rejects the shell-owned transaction or signature prompt, the page
still receives:

```json
{
  "result": null,
  "error": {
    "code": 4001,
    "message": "User rejected the request",
    "data": {
      "reason": "shell_trusted_prompt_rejected"
    }
  }
}
```

If the origin is not connected, the requested account is not connected, or the
parameters are invalid, main returns structured provider errors without
falling back to package chrome. If the vault is locked after an accepted
signing or transaction prompt, main opens the shell-owned trusted vault-unlock
window and retries only after unlock succeeds. Deprecated/unsupported signing
methods such as `eth_sign` remain safe failure paths for now. This does not
expose raw wallet authority or migrate broader secret-management UI; signing
and transaction prompts still execute only against the account already granted
to the origin.

### Package-Hosted Swarm Connection Approval

Package-hosted guest content can now route `swarm.requestAccess()` to main
without package chrome brokering the provider request:

```text
guest webview preload
  -> swarm:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker swarm.connect
  -> shell-owned trusted Swarm approval window
  -> main-owned Swarm permission grant or page-facing provider error
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims are not used as final security truth. The approval window is
bundled shell code with a dedicated preload and per-request scoped IPC
channels; package chrome cannot render or style the final approval moment. If
an existing main-owned permission is present, main updates last-used and
returns the connected result without prompting. If the user chooses Allow,
main writes the Swarm permission for the derived origin and returns:

```json
{
  "result": {
    "connected": true,
    "origin": "ipfs://bafyapp",
    "capabilities": ["publish"]
  },
  "error": null
}
```

If the user rejects the prompt, the page still receives a provider-style
`4001` with `data.reason: "shell_trusted_prompt_rejected"`. This slice does
not expose `window.swarmPermissions`, feed grants, stamp management, or final
Swarm approval UI to package chrome.

### Package-Hosted Swarm Data, File, And Chunk Publish Approval

Package-hosted guest content can now route `swarm.publishData()`,
`swarm.publishFiles()`, and `swarm.publishChunk()` to main without package
chrome brokering the provider request:

```text
guest webview preload
  -> swarm:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker swarm.publish
  -> shell-owned trusted Swarm approval window
  -> main-owned provider publish execution or page-facing provider error
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims are not used as final security truth. Payload details are
validated in main before the prompt opens; the prompt receives display-only
content type, byte size, optional name, file count, optional index-document
metadata, and optional chunk span.

If the user chooses Publish, main executes the existing `swarm_publishData`,
`swarm_publishFiles`, or `swarm_publishChunk` provider path as a shell-owned
authorization using the derived origin. The publish still depends on the local
Bee node and usable stamps, so the page can receive normal provider errors
such as `4900` with `data.reason: "node-stopped"` under the deterministic
harness.

Successful data publish returns the normal provider result:

```json
{
  "result": {
    "reference": "abc123",
    "bzzUrl": "bzz://abc123"
  },
  "error": null
}
```

Successful file publish returns the normal provider result including upload
tag identity when Bee provides one:

```json
{
  "result": {
    "reference": "site123",
    "bzzUrl": "bzz://site123",
    "tagUid": 42
  },
  "error": null
}
```

If the user rejects the prompt, the page still receives a provider-style
`4001` with `data.reason: "shell_trusted_prompt_rejected"`. This slice does
not write feed permissions, expose stamp management, allow feed publish/update,
or provide the package-hosted trusted publish surface; it is only the
provider-path file publish approval.

### Package-Hosted Swarm Feed Creation, Update, And Entry Write Approval

Package-hosted guest content can now route `swarm.createFeed()` and
`swarm.updateFeed()` and `swarm.writeFeedEntry()` to main without package
chrome brokering the provider request:

```text
guest webview preload
  -> swarm:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker swarm.feed
  -> shell-owned trusted Swarm approval window
  -> main-owned feed grant plus feed creation/update/entry write or page-facing provider error
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims are not used as final security truth. Feed names, update
references, feed-entry payload shape, and optional feed-entry index are
validated in main before the prompt opens. Feed updates and entry writes also
require an existing Swarm connection permission, an existing feed grant, and an
existing main-owned feed record before a prompt can open.

If the user chooses Allow, main ensures the derived origin has an app-scoped
feed identity and feed grant, then executes the existing `swarm_createFeed`
provider path. Feed creation still depends on local Bee node readiness, usable
stamps, and the publisher identity signer, so the page can receive normal
provider errors such as `4900` with `data.reason: "node-stopped"` under the
deterministic harness.

For `swarm_updateFeed`, accepted prompts execute the existing main-owned
`swarm_updateFeed` provider path using the identity that created the feed.
Before the prompt opens, main reads the existing feed record and passes
display-only review details to the shell-owned approval window. The trusted
window renders those details as a dedicated feed review section with the
operation, feed name, requested reference, current reference, manifest
reference, owner, and feed identity when present. The update still depends on
local Bee node readiness, usable stamps, and the feed signer. If the feed does
not exist, package-hosted requests fail with structured `feed_not_found`
before opening a prompt.

For `swarm_writeFeedEntry`, accepted prompts execute the existing main-owned
`swarm_writeFeedEntry` provider path using the identity that created the feed.
The trusted window renders a dedicated feed review section with display-only
feed name, existing-feed metadata, payload size, optional index details, and a
bounded normalized payload preview. It does not receive raw feed-store
authority or expose stamp management to package chrome. If the feed does not
exist, package-hosted requests fail with structured `feed_not_found` before
opening a prompt.

If the user rejects the prompt, the page still receives a provider-style
`4001` with `data.reason: "shell_trusted_prompt_rejected"`. This slice does
not expose stamp management, expose raw feed-store IPC, or migrate the full
Swarm publish/feed approval UI.

### Package-Hosted Swarm Publisher Signing Approval

Package-hosted guest content can now route `swarm.getSigningIdentity()` and
`swarm.writeSingleOwnerChunk()` to main without package chrome brokering the
provider request:

```text
guest webview preload
  -> swarm:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker swarm.signing
  -> shell-owned trusted Swarm approval window
  -> main-owned signing identity disclosure or SOC write, or page-facing provider error
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims are not used as final security truth. Both methods require an
existing main-owned Swarm permission and feed grant before a prompt can open.
For SOC writes, main validates the identifier, payload, options, and span
before prompting, and the prompt receives only display-safe identifier, byte
size, and span details.

If the user chooses Allow, `swarm_getSigningIdentity` resolves the publisher
owner through the existing main-owned signer path, while
`swarm_writeSingleOwnerChunk` signs and publishes through the existing
main-owned SOC provider path. These operations still depend on normal
vault/signer and Bee node/stamp readiness, so package-hosted smoke may receive
structured provider errors after approval when the deterministic harness lacks
unlocked signing material.

If the user rejects the prompt, the page still receives a provider-style
`4001` with `data.reason: "shell_trusted_prompt_rejected"`. This slice does
not expose raw feed-store IPC, stamp management, vault unlock, account
selection, local file/folder picker UI, or feed-management authority to package
chrome.

### Package-Hosted x402 Approval And Vault-Unlock Prompts

Package-hosted guest content can now surface x402 payment approval and
vault-unlock needs through shell-owned trusted windows instead of package
chrome approval cards:

```text
guest webContents x402 interception
  -> main-owned package host/context derivation
  -> trusted prompt broker x402.approval or x402.vaultUnlock
  -> shell-owned trusted approval or vault-unlock window
  -> shell-owned signing/retry or original 402 remains visible to the page
```

Main derives the payment origin from the intercepted request URL and the package
identity from the host WebContents registration. Package chrome does not receive
raw x402 approval events, raw payment-history IPC, vault-unlock primitives, or
payment signing authority.

For non-cap-covered package-hosted paywalls, the shell-owned payment review
window can now succeed for a one-time payment when the user chooses Pay and
the vault is unlocked. Main derives display-only payment review details from
the parsed x402 requirements before prompting, including amount, asset,
network, recipient, and resource URL when present. Main signs through the
existing vault-backed x402 client, queues the payment header for the retry,
returns a same-URL 307 for subresources, and re-navigates main-frame requests
through the existing sign-flow path. Rejected prompts pass the original 402
through. For recognized EIP-155 token requirements, the same shell-owned
trusted window also offers an explicit bounded cap action: Pay once, or Pay
and allow 10 tokens for 30 days. The cap decision is returned as a broker
result and threaded into the existing main-owned x402 sign-flow, which writes
the permission store; main uses the parsed grant details rather than trusting
renderer-supplied cap values, and package chrome still receives no raw x402
permission API.

Package-hosted vault-unlock prompts now receive the same main-derived payment
review details when available, including amount, asset, network, recipient,
and resource URL. The x402 vault-unlock presentation is a shell-owned trusted
window loaded from bundled code with a dedicated preload and per-request IPC
channels. It submits the password only to main, calls the identity vault unlock
path, and reports acceptance only after unlock succeeds. Accepted unlocks retry
the existing main-owned x402 sign/retry path for package-hosted cap-covered
auto-pay and accepted manual payment flows; rejected or failed unlocks pass the
original 402 through. Package-hosted x402 still does not expose payment
history or cap edit/revoke APIs to package chrome. Cap editing/revocation and
payment-history review live in the separate shell-owned trusted payments
surface opened through `surfaces.payments.control`.

### Package-Hosted Trusted Identity Surface

Package chrome can request the shell-owned trusted identity surface without
receiving identity, vault, mnemonic, quick-unlock, or raw wallet authority:

```text
window.freedomShell.openSurface("identity")
  -> shell API method surfaces.open
  -> capability surfaces.identity.control
  -> src/main/trusted-identity-surface.js
  -> bundled trusted identity BrowserWindow/preload
```

The trusted identity surface is bundled shell code with a dedicated preload
and per-window scoped IPC channels. Only the trusted surface WebContents can
call those channels. It can show display-safe vault status, create a new
recovery phrase vault, import an existing recovery phrase, unlock the vault,
lock the vault, change the vault password, delete the vault after typed
confirmation, and enable or disable quick unlock. Passwords and delete
confirmation values are accepted only on scoped trusted-window IPC channels.
Changing the password or deleting the vault disables stored quick-unlock
credentials so stale credentials do not remain active. The recovery phrase
returned by creation is rendered only inside the trusted shell-owned window.
Package chrome receives only surface open/close state and never receives the
phrase, passwords, raw vault state, quick-unlock handles, or identity-manager
APIs.

### Package-Hosted Trusted Payments Surface

Package chrome can request the shell-owned trusted payments surface without
receiving payment-history or x402 permission-store authority:

```text
window.freedomShell.openSurface("payments")
  -> shell API method surfaces.open
  -> capability surfaces.payments.control
  -> src/main/trusted-payments-surface.js
  -> bundled trusted payments BrowserWindow/preload
```

The package-hosted `freedom://payments` page remains unavailable for raw
history reads. Main still rejects `payments:get-recent`, `payments:get-by-id`,
`payments:get-count`, and `payments:clear` from package-hosted internal pages
with `PAYMENTS_UNAVAILABLE`. The page's Open trusted payments window action
only forwards to the host package WebContents' capability-gated
`surfaces.open("payments")` path.

The trusted payments surface is bundled shell code with a dedicated preload and
per-window scoped IPC channels. Only the trusted surface WebContents can call
those channels. It can list recent payment history, list active x402 caps,
update cap amount or window, revoke one cap, revoke every cap for an origin,
and clear payment history. Package chrome receives only surface open/close
state, not the payment rows, cap rows, mutation APIs, or store internals.

### Package-Hosted Trusted Swarm Publish Surface

Package chrome can request the shell-owned trusted Swarm publish surface
without receiving raw Swarm publish, stamp, feed-store, filesystem, or provider
authority:

```text
window.freedomShell.openSurface("swarmPublish")
  -> shell API method surfaces.open
  -> capability surfaces.swarmPublish.control
  -> src/main/trusted-swarm-publish-surface.js
  -> bundled trusted publish BrowserWindow/preload
```

The package-hosted `freedom://publish` page remains unavailable for raw
path-based publish IPC. Main still rejects package-hosted direct publish,
file/folder picker, upload-status, stamp-read, and publish-history requests
with `SWARM_PUBLISH_UNAVAILABLE`. The page's Open trusted publish window
action only forwards to the host package WebContents' capability-gated
`surfaces.open("swarmPublish")` path.

The trusted Swarm publish surface is bundled shell code with a dedicated
preload and per-window scoped IPC channels. Only the trusted surface
WebContents can call those channels. It loads the existing bundled publish page
inside a shell-owned BrowserWindow, so text/file/folder publishing, file/folder
pickers, stamp reads, upload status, publish history, clipboard copy, and
opening published links through the host tab API stay owned by main and
trusted bundled code. Package chrome receives only surface open/close state,
not publish paths, stamp rows, history rows, or mutation APIs.

## Future Real Prompt Paths

Real prompt paths should use the same broker shape, but with main-derived
context from the guest WebContents, tab registry, network/request interceptor,
or vault state.

Wallet connect:

- initiated by website provider path, not package chrome
- main derives committed origin and permission key from the guest WebContents
- broker opens the shell-owned trusted wallet approval window
- current package-hosted slice shows main-derived account choices in the
  trusted window, revalidates the selected wallet index in main after
  acceptance, and writes the dApp permission from main
- the shell-owned trusted wallet surface can set the active wallet, create a
  derived wallet through the shell-owned vault unlock prompt when needed,
  rename wallets, delete non-main wallets after connected dApp grants are
  revoked, and export the vault seed phrase or a selected wallet private key
  after password verification through scoped trusted-window IPC
- the shell-owned trusted identity surface can create or import the recovery
  phrase vault, unlock or lock it, change the vault password, delete the vault
  after typed confirmation, and enable/disable quick unlock through scoped
  trusted-window IPC
- future completion work should add any remaining non-provider account-management
  surfaces that need shell-owned UI

Transaction and typed-data signing:

- initiated by website provider path
- main derives origin, chain, account, request id, and tab identity
- broker opens the shell-owned trusted wallet approval window for transaction
  or signing prompts
- current package-hosted signature slice can sign `personal_sign` and modern
  EIP-712 typed-data requests for already connected origins. The shell-owned
  signing prompt shows main-derived account choices, the connected account,
  any requested account, and bounded message or typed-data review details.
  Main revalidates the selected wallet index against the current wallet list
  before signing. If the selected account satisfies the request, main signs
  with that wallet and persists a switched dApp grant only after signing
  succeeds. If signing hits a locked vault after the user accepts the
  shell-owned signing prompt, main opens the bundled trusted vault-unlock
  window with main-derived wallet context and retries the same selected-account
  signing operation only after unlock succeeds
- current package-hosted transaction slice can send `eth_sendTransaction` for
  already connected origins after selected/requested account validation,
  chain validation, and main-owned gas/fee preparation. The shell-owned
  transaction prompt shows main-derived account choices and review details.
  Transactions with an explicit `from` still fail unless that address matches
  the selected account. Main persists a switched dApp grant only after the
  transaction succeeds. If transaction signing hits a locked vault after the
  user accepts the shell-owned transaction prompt, main uses the same trusted
  vault-unlock window and retries the same selected-account operation only
  after unlock succeeds
- package chrome never receives private keys, raw transaction authority, or
  final approval rendering authority
- non-provider vault management now lives in the shell-owned trusted identity
  surface; future completion work should continue to avoid exposing raw vault
  APIs to package chrome

x402 approvals:

- initiated by network interception or provider path
- main derives URL, charge, origin, payment network, and existing permission
  state
- broker opens shell-owned payment approval or unlock prompt
- current package-hosted approval slice can sign one-time payments, and can
  create the bounded default 10-token/30-day cap for recognized EIP-155
  assets, after shell-owned trusted-window presentation
- package-hosted vault-unlock prompts show main-derived payment details in a
  shell-owned trusted window, unlock through main on accepted passwords, and
  retry x402 signing without exposing vault APIs to package chrome
- package-hosted payment-history and cap-management UX uses the shell-owned
  trusted payments window; package chrome can request only surface open/close
  state through `surfaces.payments.control`
- package chrome may receive status after the decision, not raw approval APIs

Swarm publish/feed/signing approval:

- initiated by website/provider or shell-owned publish request
- main derives origin, feed identity, stamp/batch constraints, and publish
  target
- broker opens shell-owned publish/feed/signing prompt
- current package-hosted `swarm_requestAccess` slice can grant the
  main-derived guest origin after shell-owned trusted-window approval
- current package-hosted `swarm_publishData` slice can execute data-only
  publish after shell-owned trusted-window approval, subject to normal node/stamp
  readiness
- current package-hosted `swarm_publishFiles` slice can execute file-set
  publish after shell-owned trusted-window approval, subject to normal node/stamp
  readiness
- current package-hosted `swarm_publishChunk` slice can execute CAC chunk
  publish after shell-owned trusted-window approval, subject to normal node/stamp
  readiness
- current package-hosted `swarm_createFeed`, `swarm_updateFeed`, and
  `swarm_writeFeedEntry` slices can execute feed creation, existing-feed
  updates, and feed-entry writes after shell-owned trusted-window approval,
  subject to normal node/stamp/signer readiness. The trusted window renders a
  dedicated feed review section with main-derived feed metadata, and write
  prompts include a bounded payload preview
- current package-hosted `swarm_getSigningIdentity` and
  `swarm_writeSingleOwnerChunk` slices can disclose the active publisher
  signing identity or write an SOC after shell-owned trusted-window approval, subject
  to an existing feed grant and normal vault/signer/node/stamp readiness
- package chrome does not broker Swarm access or render final publish approval

Vault unlock:

- initiated by a privileged flow that requires identity material
- main derives the operation being unlocked and target surface
- broker opens shell-owned unlock prompt backed by the trusted vault preload or
  native UI
- package chrome never receives secrets, seed material, or unlock primitives

## Non-Goals In This Slice

- no general secret-management migration beyond scoped wallet management,
  trusted identity onboarding and vault management, trusted wallet create
  unlock, and password-gated seed/private-key export in the trusted wallet
  surface
- no general vault-unlock migration outside the current x402, wallet-provider,
  and trusted wallet create paths
- no full publish-center approval migration
- no package-rendered prompt UI
- no production prompt capability granted to official package chrome
