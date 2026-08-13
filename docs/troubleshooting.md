# Troubleshooting

## Swarm node (Ant) fails to start

- Check the Nodes panel for the reported state and error.
- Freedom automatically detects managed-port conflicts and persists a free profile port.
- For source builds, confirm that `npm run ant:download` installed the binary for the current platform.
- Check the application log for Ant startup, configuration, or identity errors.

## IPFS fails to start

- IPFS uses the embedded `freedom-ipfs` native addon and does not open a loopback API or gateway port.
- For source builds, rerun `npm run ipfs:download` and confirm the addon target matches the current OS and architecture.
- Check the Nodes panel and application log for native startup diagnostics.

## Radicle fails to start

- Ensure **Settings → Experimental → Enable Radicle integration (Beta)** is enabled
- Freedom automatically detects managed-port conflicts and persists a free profile port
- Ensure both `radicle-node` and `radicle-httpd` binaries exist in `radicle-bin/`
- Ensure Git is installed and available on `PATH`
- If starting for the first time, Freedom creates a Radicle identity automatically
- Check terminal output for specific error messages

## Using an external node

- If you have a system-wide Swarm or Radicle daemon running, configure external mode in **Settings → Profiles → Node endpoints**
- External mode is per profile and per protocol
- The Nodes panel shows external/shared status when connected to an external node
- Freedom does not stop external nodes on quit

## ENS resolution not working

- Verify internet connectivity
- Open the address-bar verification details to inspect the Colibri or RPC result.
- Review **Settings → Ethereum Name Resolution**, **Chains**, and **RPC Providers**.
- For development, prepend a custom mainnet endpoint with `ETH_RPC`.

## Content not loading

- Ensure the respective node (Ant, IPFS, or Radicle) is running (check Nodes panel, for Radicle, first enable it in **Settings → Experimental**)
- Verify the Swarm reference (64 or 128 hex), CID, or Radicle ID is correct
- Check the debug console for error messages
