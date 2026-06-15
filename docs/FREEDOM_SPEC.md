# Freedom Browser Developer Platform Specification (v0.3)

> **Status.** Part I (Architecture) is the design thesis carried forward from
> v0.2. Part II (Implementation Specification) is new in v0.3 and is the
> contract engineering builds against. Where the two disagree, Part II wins for
> anything shipping in a phase; Part I governs long-term direction.

---

# Part I — Architecture

## 1. Introduction

Freedom is a browser that integrates decentralized technologies directly into
its runtime. Unlike traditional browsers augmented with extensions, Freedom
exposes decentralized capabilities as browser-owned, permissioned APIs.

These capabilities may include:

- wallet functionality
- decentralized content access
- decentralized storage
- protocol-specific naming and resolution
- local replication and sync
- browser-managed local services

The central thesis is:

> Freedom should expose a browser-native decentralized runtime, not a
> collection of injected globals.

## 2. Core Question

How should a browser expose decentralized runtime capabilities within the web
platform?

## 3. Design Goals

- Preserve a clear boundary between browser and page
- Provide a unified, extensible API surface
- Align with browser capability patterns where possible
- Maintain compatibility with existing decentralized app ecosystems
- Support protocol growth without fragmenting the programming model
- Minimize security, privacy, and fingerprinting risk

## 4. Chosen Architecture

### 4.1 Canonical API

```js
navigator.freedom
```

### 4.2 High-Level Structure

```text
navigator.freedom
  ├── capabilities()
  ├── permissions
  ├── wallet
  ├── dweb
  ├── storage
  │     ├── upload()      // unified, network-selected (canonical)
  │     ├── swarm         // per-network helpers (advanced)
  │     └── ipfs
  ├── runtime
  └── db
```

### 4.3 Conceptual Model

Freedom exposes a runtime environment, not isolated providers.

- the browser owns capabilities
- capabilities are asynchronous
- capabilities are permissioned
- capabilities may appear or disappear at runtime
- module presence is discoverable
- browser mediation is preferred over direct page access to local services

## 5. Capability Tiers

Not all decentralized capabilities have the same trust profile. Freedom defines
three exposure tiers.

### 5.1 Tier 1: Compatibility

Compatibility surfaces exist to support today's dapps and libraries.

- example: `window.ethereum`
- mirrors existing provider expectations
- focused on ecosystem interoperability
- not the primary long-term design center

### 5.2 Tier 2: Web-Facing Native Capabilities

Browser-native APIs intended for ordinary secure web applications.

- wallet access with explicit user mediation
- decentralized content reads
- storage writes with explicit permission
- naming and resolution APIs
- available to secure contexts, permission-gated where appropriate

### 5.3 Tier 3: Privileged Runtime Capabilities

Expose local runtime state or browser-managed services; stricter controls.

- local protocol/node status, process lifecycle, replication state, diagnostics
- restricted to browser-owned pages, trusted app contexts, or elevated permissions
- not exposed by default to arbitrary web pages

## 6. Exposure Rules

### 6.1 Secure Contexts

Tier 2 APIs are only exposed in secure contexts: `https://`, browser-owned
`freedom://` pages, and the `bzz://` / `ipfs://` / `ipns://` privileged schemes
(which Freedom registers as standard, secure schemes — see README "Swarm /
IPFS Content Retrieval").

### 6.2 Untrusted Contexts

These contexts do not receive sensitive Freedom capabilities by default:

- insecure `http://` pages
- arbitrary local files
- sandboxed frames without delegation
- cross-origin embeddings unless explicitly permitted

### 6.3 Browser-Owned Pages

`freedom://` pages may access additional privileged surfaces (Tier 3) not
available to the open web.

## 7. Permissions Model

- permissions are scoped to origin **and** capability
- permissions may be persistent or session-bound
- permissions must be revocable by the user
- permissions must be inspectable by both browser UI and page API
- states: `granted` · `denied` · `prompt`

## 8. Error Model

Browser-style failure semantics rather than protocol-specific ad hoc errors:

| Condition | Error |
| --- | --- |
| Capability not available on this platform/build | `NotSupportedError` |
| Permission denied by user / not connected | `NotAllowedError` |
| Local service disabled or not ready | `InvalidStateError` |
| User canceled upload or prompt, or `signal` aborted | `AbortError` |
| Decentralized fetch / upload could not complete | `NetworkError` |
| Bad arguments | `TypeError` |

## 9. Security and Privacy Constraints

- page code must not gain arbitrary control over local daemons
- browser mediation is preferred over direct socket/port/filesystem exposure
- capability APIs preserve context-isolation boundaries
- sensitive operations require explicit user action or permission
- APIs minimize fingerprinting surface; high-entropy runtime details are
  hidden, coarse-grained, or privileged

## 10. Why `navigator.freedom`

`window` is where pages observe *injected providers*; `navigator` is where
browsers expose *native capabilities*. Freedom uses `navigator.freedom` to
signal browser-owned, permissioned, user-agent-mediated APIs.

| Model | Example |
| --- | --- |
| Injection | `window.ethereum` |
| Capability | `navigator.bluetooth` |

## 11. Key Distinction

MetaMask exposes a provider. Freedom exposes an environment.

## 12. Non-Goals (this version)

- unrestricted local daemon control for arbitrary web pages
- protocol-standardization claims beyond Freedom itself
- complete database (`db`) APIs
- a standards-track `navigator.dweb` alias

---

# Part II — Implementation Specification

This part pins concrete shapes, maps the surface onto the code that exists
today, and phases the work. The forcing function is the DappCon "Writing the
dweb" workshop: Phase 1 is exactly the surface that workshop touches.

## 13. Surface Summary (v1)

```ts
interface NavigatorFreedom {
  readonly version: string;                       // spec/impl version, e.g. "0.3"
  capabilities(): Promise<Capabilities>;
  readonly permissions: FreedomPermissions;
  readonly wallet: FreedomWallet;                 // EIP-1193-shaped, browser-owned
  readonly storage: FreedomStorage;
  readonly dweb: FreedomDweb;
  // runtime, db — reserved, Tier 3 / future (see §19)
}
```

`navigator.freedom` is always present in a supported context (so feature
detection via `typeof navigator.freedom !== "undefined"` — as the workshop
setup step does — succeeds whenever Freedom injects the surface). Individual
*capabilities* may still be unavailable; that is reported by `capabilities()`
and by per-call errors, never by the namespace being absent.

## 14. `capabilities()`

```ts
type Availability = { available: boolean; reason?: string };

interface Capabilities {
  wallet: Availability & { version?: string };
  dweb: { available: boolean; protocols: string[] };   // e.g. ["bzz","ipfs","ipns","ens"]
  storage: {
    swarm: Availability;                                 // available when Ant node ready + stamp present
    ipfs:  Availability;                                 // available:false until native write lands (§18)
  };
  runtime: Availability;                                 // false for open web (Tier 3)
}
```

Rules:

- Must resolve (never throw) for unavailable modules.
- `available` reflects platform + settings + node readiness at call time.
- `storage.swarm.available` is `false` with `reason` when the `enableIdentityWallet`
  gate is off, the Ant node isn't ready, or no usable postage stamp exists.
- `storage.ipfs.available` is `false` (`reason: "write-not-supported"`) until
  the native IPFS write path exists (§18).

## 15. `wallet` (Tier 2, compatibility-aligned)

A browser-owned EIP-1193 surface. Semantically identical to today's
`window.ethereum`, but reached through the capability namespace.

```ts
interface FreedomWallet {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: WalletEvent, handler: (data: unknown) => void): void;
  removeListener(event: WalletEvent, handler: (data: unknown) => void): void;
}
// WalletEvent: "connect" | "disconnect" | "chainChanged" | "accountsChanged" | "message"
```

- Methods, params, and results match the existing provider exactly:
  `eth_requestAccounts`, `eth_accounts`, `personal_sign`, `eth_signTypedData_v4`,
  `eth_sendTransaction`, `wallet_switchEthereumChain`, read-only RPC, etc.
  (see `src/renderer/lib/dapp-provider.js`).
- `window.ethereum` remains as the Tier 1 compatibility alias (unchanged).
- The workshop's wallet calls continue to use `window.ethereum`; `navigator.freedom.wallet`
  is the canonical equivalent and may be documented as the preferred form.

## 16. `storage` (Tier 2, permission-gated)

### 16.1 Canonical: unified upload

```ts
type UploadInput = Blob | File | ArrayBuffer | Uint8Array | string;

interface UploadOptions {
  data: UploadInput;
  network: "swarm" | "ipfs";
  contentType?: string;        // defaults: Blob/File type, else "application/octet-stream"
  filename?: string;           // hint for single-file manifests
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;        // cancellation → AbortError
}

interface UploadProgress { loaded?: number; total?: number; phase?: string; }

interface UploadResult {
  network: "swarm" | "ipfs";
  hash: string;                // swarm: 64/128-hex reference; ipfs: CIDv1 base32
  url: string;                 // swarm: "bzz://<hash>"; ipfs: "ipfs://<cid>"
  raw?: unknown;               // underlying provider result (tagUid, batchId, …)
}

interface FreedomStorage {
  upload(options: UploadOptions): Promise<UploadResult>;
  swarm: SwarmStorage;         // advanced, §16.2
  ipfs: IpfsStorage;           // advanced, §16.2
}
```

This is the exact shape the workshop relies on:

```js
const upload = await navigator.freedom.storage.upload({
  data: new Blob(["<h1>Hello dweb</h1>"], { type: "text/html" }),
  network: "swarm",
});
// → { network: "swarm", hash: "7a3f…c91e", url: "bzz://7a3f…c91e", raw: { tagUid, … } }
```

Normalization rules for `data`:

- `string` → encoded UTF-8 bytes, default `contentType: "text/plain"` unless given.
- `Blob`/`File` → bytes via `arrayBuffer()`; `contentType`/`filename` inferred if absent.
- `ArrayBuffer`/`Uint8Array` → bytes as-is.

### 16.2 Advanced: per-network helpers

For callers that need protocol-specific options (Swarm feeds/SOCs, IPFS pin
flags). These are thin and return the same `UploadResult` for the upload case:

```ts
interface SwarmStorage { upload(o: Omit<UploadOptions,"network">): Promise<UploadResult>; /* feeds, SOC — Phase 2 */ }
interface IpfsStorage  { add(o: Omit<UploadOptions,"network">): Promise<UploadResult>;    /* pin opts — Phase 2 */ }
```

### 16.3 Permissions & approval

- `upload({network:"swarm"})` requires `storage.swarm.write`; `network:"ipfs"`
  requires `storage.ipfs.write`.
- First write from an origin shows the existing approval UI; subsequent writes
  honor the stored auto-approve setting (mirrors `swarm-provider.js`).
- Denied/unconnected → `NotAllowedError`. Node not ready → `InvalidStateError`.

## 17. `dweb` (Tier 2)

Naming/resolution first; mediated fetch is Phase 2.

```ts
interface FreedomDweb {
  resolve(name: string): Promise<{ protocol: "bzz"|"ipfs"|"ipns"; hash: string; url: string }>;
  // fetch(url): Promise<Response>  — Phase 2, browser-mediated; reads otherwise
  //                                  happen by navigating bzz:// / ipfs:// directly.
}
```

`resolve("example.eth")` wraps the in-process ENS resolver
(`src/main/ens-resolver.js`) and returns the transport + contenthash, matching
the address-bar resolution. The workshop's ENS segment is a demo (set
contenthash on-chain via `wallet`, then open the name), so `dweb.resolve` is
nice-to-have for Phase 1, not required.

## 18. Mapping onto existing implementation

| Surface | Backed by | Notes |
| --- | --- | --- |
| Injection of `navigator.freedom` | `src/main/webview-preload.js` + a new inject source modeled on `webview-preload-ethereum-inject.js` | page-realm object that postMessages to the preload bridge, same pattern as `window.ethereum` / `window.swarm` |
| `wallet.request` | `dapp-provider.js` (renderer) → wallet IPC | reuse verbatim; route `navigator.freedom.wallet` requests through the same `dapp:provider-request` channel |
| `storage.upload({network:"swarm"})` | `swarm-provider.js` → `swarm-provider-ipc.js` → `publish-service.js` | call `swarm_publishData`; map `{ reference, bzzUrl, tagUid }` → `{ network, hash: reference, url: bzzUrl, raw }` |
| `storage.upload({network:"ipfs"})` | **does not exist yet** | native `freedom-ipfs` node is retrieval-only (`src/main/ipfs/` is a request dispatcher). Tracked work item — see below |
| `dweb.resolve` | `src/main/ens-resolver.js` | already used by the address bar |
| `capabilities()` | service registry + settings + permission stores | aggregate readiness |
| `permissions.query/request` | `dapp-permissions.js` / `swarm-permissions` | unify under one query API |

### Feature gate (resolved)

Both underlying providers (`dapp-provider.js`, `swarm-provider.js`) are gated
behind the `enableIdentityWallet` setting and reject every request with
`DISCONNECTED` (code 4900) when it is off. However, the setting **defaults to
`true`** (`src/main/settings-store.js`), so a fresh install already has the
surface live.

**Resolution — rely on the default, report honestly, no workshop-specific
auto-enable:**

1. Do **not** add a config-import / auto-enable mechanism for the workshop.
   Leaning on the default-on flag is less fragile than pushing hidden config.
2. `capabilities()` reflects the gate honestly: when off, `wallet.available` and
   `storage.swarm.available` are `false` with `reason: "identity-wallet-disabled"`,
   and direct calls reject with `NotAllowedError` carrying an actionable message
   ("Enable Identity & Wallet in Settings → Experimental") — never a silent
   `DISCONNECTED`.
3. **Fix the init race** in both providers: they start `identityWalletEnabled =
   false` and load the real value asynchronously, so a call in the first tick can
   be spuriously rejected. Treat "settings not yet loaded" as *pending* (await the
   first settings load) rather than *disabled*.
4. Workshop setup guide: a single verify line ("confirm Identity & Wallet is on
   — it is by default").

Settings placement (decided): the flag stays under `Settings → Experimental`
("Enable Identity & Wallet (Beta)") for now. Graduating it out of Experimental
is deferred to a later settings cleanup pass — out of scope for Phase 1.

### Tracked dependency — native IPFS write

The embedded node has no `add`/`put`. Until it does, `network:"ipfs"` resolves
its availability to `false` and `upload({network:"ipfs"})` rejects with
`NotSupportedError (reason: "write-not-supported")`. Scoped as a separate work
item: extend the `freedom-ipfs` native addon (or an alternate write route) to
import bytes and return a CID, then flip `capabilities().storage.ipfs`.

## 19. Reserved (Tier 3 / future)

- `runtime` — `getProtocolStatus(network)`, lifecycle. Privileged; `freedom://`
  pages only. Today's `window.ipfs` node-control surface (renderer-internal) is
  the precedent; not exposed to the open web.
- `db` — local-first/replicated DB. Unspecified.

## 20. Phasing

**Phase 1 — Workshop surface (this effort)**

- Inject `navigator.freedom` with `version`, `capabilities()`, `wallet`,
  `storage.upload` (swarm working; ipfs reports unavailable), `permissions.query/request`.
- `storage.upload` swarm path end-to-end over existing publish pipeline.
- `dweb.resolve` (optional but cheap).
- Honest gate handling per §18 "Feature gate (resolved)": no workshop auto-enable,
  `capabilities()` reflects the flag, and fix the provider init race.

**Phase 2**

- Native IPFS write → enable `storage.upload({network:"ipfs"})`.
- `storage.swarm` feeds/SOC helpers; `storage.ipfs` pin options.
- `dweb.fetch` (browser-mediated reads).
- Lifecycle events on `wallet` and `storage` (`accountschange`, upload progress as events).

**Phase 3**

- `runtime` (Tier 3, `freedom://`-scoped) and `db`.
- Capability discovery hardening, privacy review, revocation UI.

## 21. Open Questions

1. ~~Workshop gate: auto-enable `enableIdentityWallet`?~~ **Resolved** — rely on
   the default-on flag, report state via `capabilities()`, fix the init race; no
   workshop-specific auto-enable. See §18 "Feature gate (resolved)". The flag
   stays under "Experimental" for now; settings cleanup is deferred.
2. Is `navigator.freedom.wallet` documented as *preferred* for the workshop, or
   do we keep teaching `window.ethereum` to match every other dapp tutorial?
3. Progress reporting for `storage.upload`: `onProgress` callback (in spec now)
   vs. event-based — pick one before Phase 2.
4. Should `bzz://`/`ipfs://` pages count as secure contexts for Tier 2 exposure
   by default, or require an explicit per-origin grant like `https://`?
