/**
 * Trust anchor for the Swarm-distributed filter-list update channel (WP5).
 *
 * The publisher (freedom-adblock-service) writes a signed manifest to a Swarm
 * feed owned by a dedicated key. The client reads that feed by (owner, topic)
 * — hardcoded here — so it never has to trust a reference handed to it, only
 * this compiled-in anchor. Two independent checks gate an update:
 *   1. the feed's Single-Owner-Chunk signature (owner = FEED_OWNER_ADDRESS)
 *   2. the manifest's application-level `sig` (signer = MANIFEST_SIG_ADDRESS)
 * Separating them gives key-rotation headroom (see the design note).
 *
 * MANIFEST_SCHEMA / FEED_TOPIC mirror src/manifest.ts in freedom-adblock-service
 * and must stay in sync with it — this pair is a cross-repo contract.
 */

// Kept in lockstep with freedom-adblock-service/src/manifest.ts.
const MANIFEST_SCHEMA = 1;
const FEED_TOPIC = 'freedom/adblock/lists/v1';

// PLACEHOLDERS — filled once the publisher key exists (WP5 5.A2). Until then
// `isTrustAnchorConfigured()` is false and the update-manager stays dormant,
// so the browser ships on bundled lists (the permanent floor) with no live
// updates. Do NOT enable the update path against a zero address.
//
// The env overrides let a dev/E2E build point at a test publisher's feed
// without recompiling; production relies on the hardcoded constants.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const FEED_OWNER_ADDRESS = process.env.FREEDOM_ADBLOCK_FEED_OWNER || ZERO_ADDRESS;
const MANIFEST_SIG_ADDRESS = process.env.FREEDOM_ADBLOCK_SIG_ADDRESS || ZERO_ADDRESS;

/**
 * Whether real publisher-key constants have been compiled in. The update
 * manager must check this and no-op while false.
 */
function isTrustAnchorConfigured() {
  return (
    FEED_OWNER_ADDRESS.toLowerCase() !== ZERO_ADDRESS &&
    MANIFEST_SIG_ADDRESS.toLowerCase() !== ZERO_ADDRESS
  );
}

module.exports = {
  MANIFEST_SCHEMA,
  FEED_TOPIC,
  FEED_OWNER_ADDRESS,
  MANIFEST_SIG_ADDRESS,
  isTrustAnchorConfigured,
};
