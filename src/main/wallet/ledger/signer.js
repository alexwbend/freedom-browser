/**
 * Ledger signing backend for the wallet signer factory.
 *
 * getAddress serves the address stored on the account record (read from
 * the device when the account was added) — no device round-trip, no vault.
 *
 * Signing methods arrive with the device-confirmation flow (WP3); until
 * then they fail closed with a stable code so approval UIs can explain
 * instead of silently mis-signing.
 */

const { LEDGER_ERROR_CODES, createLedgerError } = require('./errors');

function signingUnavailable() {
  return Promise.reject(createLedgerError(LEDGER_ERROR_CODES.SIGNING_UNAVAILABLE));
}

/**
 * @param {{address: string, path: string}} record - Ledger wallet record from vault-meta
 * @returns {import('../signers').Signer}
 */
function createLedgerBackend(record) {
  return {
    getAddress: async () => record.address,
    signTransaction: () => signingUnavailable(),
    signMessage: () => signingUnavailable(),
    signTypedData: () => signingUnavailable(),
  };
}

module.exports = { createLedgerBackend };
