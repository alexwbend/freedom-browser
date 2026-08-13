# Configuration

## Node Endpoints

Freedom automatically manages node connections per profile. The default profile's managed endpoints start at:

- **Swarm Ant**: `http://127.0.0.1:11633`
- **IPFS**: embedded native `freedom-ipfs` handler; no desktop loopback gateway/API port is started
- **Radicle httpd**: `http://127.0.0.1:18780`

Named profiles use the next profile slot for Ant and Radicle (`11634`, `18781`, and so on). The ecosystem default Swarm/Radicle ports (`1633`, `8780`) are treated as external/system-node endpoints, not Freedom-managed defaults. IPFS is native-only and does not expose or reuse Kubo API/gateway ports.

If Freedom detects a compatible Swarm or Radicle daemon on an ecosystem default port for a protocol that would start at launch, it asks whether that profile should use the existing external node or keep an independent managed node.

For advanced users who need to connect a profile to a remote or system Bee/Radicle node, use **Settings → Profiles → Node endpoints** and switch the relevant protocol to external mode. Development-only renderer gateway overrides are still available via environment variables:

```bash
# Connect to a remote Swarm node
export ANT_API="http://remote-host:1633"

npm start
```

## External Protocol Links And Profiles

Inside Freedom, `bzz://`, `ipfs://`, `ipns://`, and `rad://` URLs always resolve through the active profile's node settings and storage. OS-level protocol launches from other apps are a v1 limitation: they are not profile-aware and should not be used when a link must open in a specific profile. Open the target profile first and paste or navigate to the URL inside that window.

## Ethereum Name Resolution

ENS, WNS, and GNS domains are resolved against Ethereum mainnet. ENS uses the ENS Universal Resolver; WNS reads the Wei Name Service contract directly; GNS reads the Gwei Name Service contract directly.

Under **Settings → Ethereum Name Resolution**, choose one of:

- **Colibri**: Cryptographically verifies answers against the Ethereum sync committee through a configured prover, with the public-RPC quorum as fallback.
- **Public-RPC quorum**: Queries several providers and accepts matching answers.
- **Direct RPC first**: Uses the first trusted endpoint, then falls back to the public quorum.

Manage per-chain public and custom endpoints under **Settings → Chains**. API keys for supported commercial providers live under **Settings → RPC Providers** and remain profile-local. For development, `ETH_RPC` prepends an endpoint to the effective Ethereum mainnet pool:

```bash
export ETH_RPC="http://127.0.0.1:8545"
npm start
```

Never commit provider keys or put them directly in documentation, issue reports, or command history.

## Home Page

Edit `src/renderer/pages/home.html` to customize the welcome view shown on startup or when clicking Home.
