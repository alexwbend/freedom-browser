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
  -> shell-owned native dialog
  -> main-side dApp permission grant and page-facing account result
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims are not used as final security truth.

If the user chooses Connect and the shell has an active wallet address,
main writes the dApp permission with the derived origin and active wallet index
and returns the active wallet address to the guest page:

```json
{
  "result": ["0x1111111111111111111111111111111111111111"],
  "error": null
}
```

If the user rejects the prompt, the page still receives an EIP-1193 `4001`
user rejection. Package-hosted `eth_accounts` reads existing main-owned dApp
permissions and returns the granted account without opening a prompt. This
does not migrate transaction approval UI, expose wallet management, or give
package chrome dApp permission-store authority.

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
  -> shell-owned native dialog
  -> shell-owned execution or page-facing provider error
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims and transaction/signature details are not trusted as final
security truth.

For connected origins, `personal_sign`, `eth_signTypedData`,
`eth_signTypedData_v3`, and `eth_signTypedData_v4` can now succeed when the
user chooses Sign and the vault is unlocked. Main checks the existing dApp
permission, verifies the requested signing account against the connected
account, borrows the private key through `withVaultPrivateKey()`, performs the
signature in main, updates the permission last-used timestamp, and returns only
the signature to the guest page:

```json
{
  "result": "0x...",
  "error": null
}
```

For connected origins, `eth_sendTransaction` can now succeed when the user
chooses Send and the vault is unlocked. Main checks the existing dApp
permission, verifies the requested `from` account against the connected
account, requires the transaction chain to match the granted chain, fills
missing gas and fee fields through the shell-owned wallet services, borrows the
private key through `withVaultPrivateKey()`, signs/broadcasts through the
existing transaction recorder, records dApp-send payment history, updates the
permission last-used timestamp, and returns only the transaction hash to the
guest page:

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

If the origin is not connected, the requested account is not connected, the
parameters are invalid, or the vault is locked, main returns structured
provider errors without falling back to package chrome. Deprecated/unsupported
signing methods such as `eth_sign` remain safe failure paths for now. This
does not select accounts, unlock vault state, expose raw wallet authority, or
migrate the full wallet center UI.

### Package-Hosted Swarm Connection Approval

Package-hosted guest content can now route `swarm.requestAccess()` to main
without package chrome brokering the provider request:

```text
guest webview preload
  -> swarm:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker swarm.connect
  -> shell-owned native dialog
  -> main-owned Swarm permission grant or page-facing provider error
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims are not used as final security truth. If an existing main-owned
permission is present, main updates last-used and returns the connected result
without prompting. If the user chooses Allow, main writes the Swarm permission
for the derived origin and returns:

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

### Package-Hosted Swarm Data And File Publish Approval

Package-hosted guest content can now route `swarm.publishData()` and
`swarm.publishFiles()` to main without package chrome brokering the provider
request:

```text
guest webview preload
  -> swarm:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker swarm.publish
  -> shell-owned native dialog
  -> main-owned provider publish execution or page-facing provider error
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims are not used as final security truth. Payload details are
validated in main before the prompt opens; the prompt receives display-only
content type, byte size, optional name, file count, and optional index-document
metadata.

If the user chooses Publish, main executes the existing `swarm_publishData` or
`swarm_publishFiles` provider path as a shell-owned authorization using the
derived origin. The publish still depends on the local Bee node and usable
stamps, so the page can receive normal provider errors such as `4900` with
`data.reason: "node-stopped"` under the deterministic harness.

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
or migrate the full Swarm publish/feed approval UI.

### Package-Hosted Swarm Feed Creation, Update, And Entry Write Approval

Package-hosted guest content can now route `swarm.createFeed()` and
`swarm.updateFeed()` and `swarm.writeFeedEntry()` to main without package
chrome brokering the provider request:

```text
guest webview preload
  -> swarm:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker swarm.feed
  -> shell-owned native dialog
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
The update still depends on local Bee node readiness, usable stamps, and the
feed signer. If the feed does not exist, package-hosted requests fail with
structured `feed_not_found` before opening a prompt.

For `swarm_writeFeedEntry`, accepted prompts execute the existing main-owned
`swarm_writeFeedEntry` provider path using the identity that created the feed.
The prompt receives display-only feed name, payload size, and optional index
details; it does not receive or display the raw payload. If the feed does not
exist, package-hosted requests fail with structured `feed_not_found` before
opening a prompt.

If the user rejects the prompt, the page still receives a provider-style
`4001` with `data.reason: "shell_trusted_prompt_rejected"`. This slice does
not expose stamp management, expose raw feed-store IPC, or migrate the full
Swarm publish/feed approval UI.

### Package-Hosted x402 Approval And Vault-Unlock Prompts

Package-hosted guest content can now surface x402 payment approval and
vault-unlock needs through shell-owned native prompts instead of package chrome
approval cards:

```text
guest webContents x402 interception
  -> main-owned package host/context derivation
  -> trusted prompt broker x402.approval or x402.vaultUnlock
  -> shell-owned native dialog
  -> shell-owned signing/retry or original 402 remains visible to the page
```

Main derives the payment origin from the intercepted request URL and the package
identity from the host WebContents registration. Package chrome does not receive
raw x402 approval events, raw payment-history IPC, vault-unlock primitives, or
payment signing authority.

For non-cap-covered package-hosted paywalls, the shell-owned payment prompt can
now succeed for a one-time payment when the user chooses Pay and the vault is
unlocked. Main derives display-only payment review details from the parsed
x402 requirements before prompting, including amount, asset, network,
recipient, and resource URL when present. Main signs through the existing
vault-backed x402 client, queues the payment header for the retry, returns a
same-URL 307 for subresources, and re-navigates main-frame requests through
the existing sign-flow path. Rejected prompts pass the original 402 through.

Package-hosted x402 still does not grant caps, unlock vault state, write
payment permissions, expose payment history, or migrate the full x402 approval
UI. Package-hosted vault-unlock prompts still intentionally reject and pass the
original 402 through when signing needs an unlock.

## Future Real Prompt Paths

Real prompt paths should use the same broker shape, but with main-derived
context from the guest WebContents, tab registry, network/request interceptor,
or vault state.

Wallet connect:

- initiated by website provider path, not package chrome
- main derives committed origin and permission key from the guest WebContents
- broker opens shell-owned wallet-connect prompt
- current package-hosted slice can grant the active account after shell-owned
  native presentation and writes the dApp permission from main
- future completion work should replace the native connect dialog with the
  full shell-owned wallet-connect surface when account selection or richer
  permission review is needed

Transaction and typed-data signing:

- initiated by website provider path
- main derives origin, chain, account, request id, and tab identity
- broker opens shell-owned transaction or signing prompt
- current package-hosted signature slice can sign `personal_sign` and modern
  EIP-712 typed-data requests for already connected origins when the vault is
  unlocked
- current package-hosted transaction slice can send `eth_sendTransaction` for
  already connected origins when the vault is unlocked, after account/chain
  validation and main-owned gas/fee preparation
- package chrome never receives private keys, raw transaction authority, or
  final approval rendering authority
- future completion work must add richer account selection/review and
  vault-unlock handling before the broader wallet approval surface can be
  called complete in package mode

x402 approvals:

- initiated by network interception or provider path
- main derives URL, charge, origin, payment network, and existing permission
  state
- broker opens shell-owned payment approval or unlock prompt
- current package-hosted approval slice can sign one-time payments after
  shell-owned native presentation when the vault is unlocked
- package-hosted vault-unlock prompts still reject after shell-owned native
  presentation and pass the original 402 through
- package chrome may receive status after the decision, not raw approval APIs
- future completion work must add cap grants, vault unlock, payment
  permission management, and richer review UI before x402 can be called
  complete in package mode

Swarm publish/feed approval:

- initiated by website/provider or shell-owned publish request
- main derives origin, feed identity, stamp/batch constraints, and publish
  target
- broker opens shell-owned publish/feed prompt
- current package-hosted `swarm_requestAccess` slice can grant the
  main-derived guest origin after shell-owned native approval
- current package-hosted `swarm_publishData` slice can execute data-only
  publish after shell-owned native approval, subject to normal node/stamp
  readiness
- current package-hosted `swarm_publishFiles` slice can execute file-set
  publish after shell-owned native approval, subject to normal node/stamp
  readiness
- current package-hosted `swarm_createFeed`, `swarm_updateFeed`, and
  `swarm_writeFeedEntry` slices can execute feed creation, existing-feed
  updates, and feed-entry writes after shell-owned native approval, subject to
  normal node/stamp/signer readiness
- package chrome does not broker Swarm access or render final publish approval

Vault unlock:

- initiated by a privileged flow that requires identity material
- main derives the operation being unlocked and target surface
- broker opens shell-owned unlock prompt backed by the trusted vault preload or
  native UI
- package chrome never receives secrets, seed material, or unlock primitives

## Non-Goals In This Slice

- no real wallet center migration
- no richer wallet account-selection implementation
- no x402 cap-grant, payment-permission, or vault-unlock migration
- no full publish-center approval migration
- no package-rendered prompt UI
- no production prompt capability granted to official package chrome
