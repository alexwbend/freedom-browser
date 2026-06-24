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

### Package-Hosted Wallet Connect Denial

Package-hosted guest content can now route
`ethereum.request({ method: "eth_requestAccounts" })` to main without package
chrome brokering the provider request:

```text
guest webview preload
  -> dapp:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker wallet.connect
  -> shell-owned native dialog
  -> page-facing EIP-1193 user rejection
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims are not used as final security truth.

The current result intentionally rejects the connection:

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

This proves a real provider request reaches shell-owned prompt presentation
with main-derived context. It does not grant accounts, write dApp permissions,
or migrate transaction/signing approval UI.

### Package-Hosted Wallet Transaction And Signature Denials

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
  -> page-facing EIP-1193 user rejection
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims and transaction/signature details are not trusted as final
security truth.

The current result intentionally rejects the transaction or signature request:

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

This proves the package-hosted provider path reaches shell-owned prompt
presentation for signing-class requests. It does not sign, send transactions,
select accounts, unlock vault state, write dApp permissions, or migrate the
final transaction/signature approval UI.

### Package-Hosted Swarm Publish Denial

Package-hosted guest content can now route `swarm.publishData()` to main
without package chrome brokering the provider request:

```text
guest webview preload
  -> swarm:provider-trusted-prompt-request
  -> main-owned package host/context derivation
  -> trusted prompt broker swarm.publish
  -> shell-owned native dialog
  -> page-facing user rejection
```

Main derives the guest origin from the requesting WebContents URL and the
package identity from the host WebContents registration. Payload-supplied
origin claims are not used as final security truth.

The current result intentionally rejects the publish request:

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

This proves a Swarm provider request reaches shell-owned prompt presentation
with main-derived context. It does not publish data, write feed permissions,
spend stamps, or migrate the full Swarm publish/feed approval UI.

### Package-Hosted x402 Approval And Vault-Unlock Denials

Package-hosted guest content can now surface x402 payment approval and
vault-unlock needs through shell-owned native prompts instead of package chrome
approval cards:

```text
guest webContents x402 interception
  -> main-owned package host/context derivation
  -> trusted prompt broker x402.approval or x402.vaultUnlock
  -> shell-owned native dialog
  -> original 402 remains visible to the page
```

Main derives the payment origin from the intercepted request URL and the package
identity from the host WebContents registration. Package chrome does not receive
raw x402 approval events, raw payment-history IPC, vault-unlock primitives, or
payment signing authority.

The current result intentionally rejects the payment or vault-unlock request
and passes the original 402 through. This proves shell-owned prompt presentation
for package-hosted x402 failures without signing payments, granting caps,
unlocking vault state, writing payment permissions, or migrating the final x402
approval UI.

## Future Real Prompt Paths

Real prompt paths should use the same broker shape, but with main-derived
context from the guest WebContents, tab registry, network/request interceptor,
or vault state.

Wallet connect:

- initiated by website provider path, not package chrome
- main derives committed origin and permission key from the guest WebContents
- broker opens shell-owned wallet-connect prompt
- current package-hosted slice rejects after shell-owned native presentation
- future completion work must add real account-grant permission handling from
  main before wallet connect can succeed in package mode

Transaction and typed-data signing:

- initiated by website provider path
- main derives origin, chain, account, request id, and tab identity
- broker opens shell-owned transaction or signing prompt
- current package-hosted slices reject after shell-owned native presentation
- package chrome never receives private keys, raw transaction authority, or
  final approval rendering authority
- future completion work must add real wallet/account/vault execution handling
  from main before transaction or signing requests can succeed in package mode

x402 approvals:

- initiated by network interception or provider path
- main derives URL, charge, origin, payment network, and existing permission
  state
- broker opens shell-owned payment approval or unlock prompt
- current package-hosted slices reject after shell-owned native presentation and
  pass the original 402 through
- package chrome may receive status after the decision, not raw approval APIs
- future completion work must add real payment approval, cap grant, vault
  unlock, and signing execution handling from main before x402 can succeed in
  package mode

Swarm publish/feed approval:

- initiated by website/provider or shell-owned publish request
- main derives origin, feed identity, stamp/batch constraints, and publish
  target
- broker opens shell-owned publish/feed prompt
- current package-hosted `swarm_publishData` slice rejects after shell-owned
  native presentation
- package chrome does not broker Swarm access or render final publish approval

Vault unlock:

- initiated by a privileged flow that requires identity material
- main derives the operation being unlocked and target surface
- broker opens shell-owned unlock prompt backed by the trusted vault preload or
  native UI
- package chrome never receives secrets, seed material, or unlock primitives

## Non-Goals In This Slice

- no real wallet center migration
- no account exposure, transaction sending, or signing implementation
- no successful x402 payment, cap-grant, or vault-unlock migration
- no successful Swarm publish/feed approval migration
- no package-rendered prompt UI
- no production prompt capability granted to official package chrome
