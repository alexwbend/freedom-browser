# Trusted Prompt Broker

The trusted prompt broker is the main-process boundary for prompts whose final
security truth must not be rendered or decided by package chrome.

Package chrome may request a trusted prompt or surface through a narrow,
capability-gated shell API. Main derives or binds the security context, chooses
the shell-owned prompt implementation, and returns a serializable result.
Package chrome can display non-authoritative status around that result, but it
does not render the final approval moment and does not receive wallet,
identity, provider, x402, Swarm, vault, or signing authority.

## Implemented Slice

The current implemented slice is test-only:

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
  "reason": "Fixture package broker check"
}
```

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

## Future Real Prompt Paths

Real prompt paths should use the same broker shape, but with main-derived
context from the guest WebContents, tab registry, network/request interceptor,
or vault state.

Wallet connect:

- initiated by website provider path, not package chrome
- main derives committed origin and permission key from the guest WebContents
- broker opens shell-owned wallet-connect prompt
- result grants or rejects provider permissions from main

Transaction and typed-data signing:

- initiated by website provider path
- main derives origin, chain, account, request id, and tab identity
- broker opens shell-owned signing prompt
- package chrome never receives private keys, raw transaction authority, or
  final approval rendering authority

x402 approvals:

- initiated by network interception or provider path
- main derives URL, charge, origin, payment network, and existing permission
  state
- broker opens shell-owned payment approval or unlock prompt
- package chrome may receive status after the decision, not raw approval APIs

Swarm publish/feed approval:

- initiated by website/provider or shell-owned publish request
- main derives origin, feed identity, stamp/batch constraints, and publish
  target
- broker opens shell-owned publish/feed prompt
- package chrome does not broker Swarm access or render final publish approval

Vault unlock:

- initiated by a privileged flow that requires identity material
- main derives the operation being unlocked and target surface
- broker opens shell-owned unlock prompt backed by the trusted vault preload or
  native UI
- package chrome never receives secrets, seed material, or unlock primitives

## Non-Goals In This Slice

- no real wallet center migration
- no account exposure or signing implementation
- no x402 payment migration
- no Swarm publish migration
- no package-rendered prompt UI
- no production prompt capability granted to official package chrome
