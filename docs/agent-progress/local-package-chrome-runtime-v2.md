# Local Package Chrome Runtime v2 Progress

Branch: `goal/local-package-chrome-runtime-v2`

Starting baseline: latest `origin/goal/local-package-chrome-runtime-v1`, known
at goal start as `f7ce3ba` (`docs(chrome): record v1 local verification`).

Prior baseline ledgers:

- `docs/agent-progress/local-package-chrome-runtime-v0.md`
- `docs/agent-progress/local-package-chrome-runtime-v1.md`

Goal source spec:
`/root/codex/freedom-browser-goal5.md`.

## Checkpoint 1: Baseline And Cleanup Inventory

Status: inventory recorded before cleanup edits, as required by the v2 hard
gate.

### Branch Setup

- Fetched `origin`.
- `origin/goal/local-package-chrome-runtime-v2` did not exist.
- Created local `goal/local-package-chrome-runtime-v2` from
  `origin/goal/local-package-chrome-runtime-v1` at
  `f7ce3badf2bc3661751dd4c79112baa23880f15c`.

### Required Context Read

- `AGENTS.md`
- `docs/local-package-chrome-runtime.md`
- `docs/package-chrome-trust-boundaries.md`
- `docs/trusted-prompt-broker.md`
- `docs/agent-progress/local-package-chrome-runtime-v1.md`
- `eslint.config.js`
- `docs/agent-playbooks/commit-messages.md`
- `packages/official-browser-chrome/src/index.html`
- `packages/official-browser-chrome/src/index.js`
- `packages/official-browser-chrome/src/lib/sidebar.js`
- `packages/official-browser-chrome/src/lib/chrome-runtime-api.js`
- `scripts/build-official-chrome-package.js`
- `scripts/check-official-chrome-boundary.js`
- `test-e2e/chrome-package.spec.js`

### Current Package Source Residue

The official package source already avoids importing bundled-only wallet,
onboarding, dApp provider, and Swarm provider modules. Runtime package mode
uses `window.freedomShell` surface control for the wallet toolbar button, and
the official package smoke proves the real wallet UI opens in a shell-owned
trusted window.

The remaining v1 residue is mostly static package markup and CSS copied from
the old trusted renderer sidebar:

- `packages/official-browser-chrome/src/index.html` still contains a large
  `#sidebar-identity` subtree with wallet, vault, send/receive, dApp
  connection, transaction/signature approval, x402 approval, dApp permission,
  Swarm permission, publisher identity, and standalone vault-unlock UI.
- The package runtime hides that subtree in package mode, but the source still
  includes trusted-only IDs and security-sensitive labels such as recovery
  phrase export, private-key export, vault unlock, transaction signing, and
  dApp/x402 approval.
- `packages/official-browser-chrome/src/styles/sidebar.css` still contains
  selectors for the deleted-in-principle sidebar panels, including mnemonic
  display, wallet selector, create wallet, receive, wallet settings, send
  unlock, dApp approval, x402 approval, and publisher identity controls.
- `packages/official-browser-chrome/src/lib/sidebar.js` is already narrow in
  package mode: it initializes the toolbar button, requests wallet surface
  state through the package adapter, hides old tabs/content if present, and
  creates a package-safe `#package-wallet-surface-placeholder` only for
  non-trusted placeholder mode.

### First Cleanup Slice

Target 1 will remove the package-owned copy of the trusted sidebar body while
preserving the shell-owned wallet surface workflow.

Markup planned for removal from package `index.html`:

- `#sidebar-setup-cta`
- `#sidebar-identity`
- `#tab-wallet`
- `#tab-nodes`
- `#tab-settings`
- `#sidebar-export-mnemonic`
- `#sidebar-create-wallet`
- `#sidebar-receive`
- `#sidebar-wallet-settings`
- `#sidebar-send`
- `#sidebar-dapp-connect`
- `#sidebar-dapp-tx`
- `#sidebar-dapp-sign`
- `#sidebar-x402-approval`
- `#sidebar-vault-unlock`
- `#sidebar-dapp-permissions`
- `#sidebar-x402-permissions`
- `#sidebar-swarm-permissions`
- `#sidebar-publisher-identities`
- `#sidebar-publisher-identity-create`

Allowed package-owned shell after the cleanup:

- `#wallet-toggle-btn`
- `#sidebar`
- `.sidebar-content`
- `#sidebar-close`
- `#package-wallet-surface-placeholder`, created by `sidebar.js` only when the
  shell reports placeholder mode instead of the current trusted-window mode

### Ratchet Plan

Positive behavior coverage:

- Strengthen the official package smoke to assert that removed sidebar residue
  IDs are absent in the running package DOM.
- Keep the existing wallet surface assertions:
  - `#wallet-toggle-btn` is visible
  - `freedomShell.getSurfaceState("wallet")` reports
    `mode: "shell-owned-trusted-window"`
  - opening/toggling the wallet button opens the trusted wallet window
  - `#package-wallet-surface-placeholder` is absent in trusted-window mode

Negative boundary coverage:

- Extend `scripts/check-official-chrome-boundary.js` with explicit denied
  package residue markers for the trusted sidebar IDs/selectors removed in
  this slice.
- Add or extend Jest coverage proving the boundary guard catches those markers.
- Run the boundary guard against both package source and generated package
  output through `npm run chrome:package:check-boundary`.

CSS cleanup:

- After the markup removal passes focused package smoke, prune
  `styles/sidebar.css` down to selectors needed by the toolbar button, minimal
  sidebar shell, close button, and package placeholder.
- Treat any remaining CSS for deleted trusted sidebar panels as a boundary
  failure unless explicitly listed here with a reason.

### Remaining

- Commit and push this inventory checkpoint to establish
  `origin/goal/local-package-chrome-runtime-v2`.
- Implement the wallet/sidebar markup ratchet.
- Implement the sidebar CSS ratchet.
- Decide whether adapter purity is small enough for this goal; otherwise
  record it as post-goal cleanup.
- Run final local verification and GitHub target jobs.
