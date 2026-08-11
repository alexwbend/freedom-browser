/**
 * Approval-surface ownership lock.
 *
 * A hardware signature is a device prompt we cannot recall: once the user
 * has been asked to confirm on the device, nothing in the renderer can take
 * the request back. The sidebar is a single shared surface, so while such a
 * signature is in flight the approval screen that started it owns the
 * sidebar — no other surface (dapp-tx, dapp-sign, dapp-connect, x402,
 * vault-unlock, swarm, permission management) may repaint over it or tear it
 * down via hideAllSubscreens().
 *
 * The lock lives here, not in the individual modules, because a per-module
 * `pending.signing` flag only stops a module from stealing its *own* screen;
 * the screen itself is shared by every module. It is also deliberately not
 * part of `walletState` — that object is view state that tests replace
 * wholesale, whereas this lock must be the same instance for every surface.
 */

// The request object that owns the sidebar, or null when idle. Identity of
// the token matters (not just a boolean) so a late `end` from a superseded
// request cannot release a lock it no longer holds.
let owner = null;

/** Take the lock for `token` (typically the module's `pending` object). */
export function beginSignatureFlight(token) {
  owner = token ?? null;
}

/** Release the lock, but only if `token` still holds it. */
export function endSignatureFlight(token) {
  if (token && owner === token) {
    owner = null;
  }
}

export function isSignatureInFlight() {
  return owner !== null;
}

/**
 * The standard "already pending" JSON-RPC error handed to whichever dApp
 * request tried to take the screen while a device confirmation was live.
 * The dApp can retry once the device is done.
 */
export function signatureInFlightError() {
  return Object.assign(
    new Error('A signature is already in progress — finish it on your device first'),
    { code: -32002 }
  );
}

export function assertNoSignatureInFlight() {
  if (owner !== null) {
    throw signatureInFlightError();
  }
}
