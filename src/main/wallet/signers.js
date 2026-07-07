/**
 * Signer factory.
 *
 * Resolves a wallet index to a signer object so callers never touch raw
 * private keys. Today every account is vault-backed (mnemonic-derived);
 * hardware-wallet account types plug in here by returning a different
 * backend behind the same interface.
 *
 * Input normalization (0x-hex personal messages → raw bytes, JSON-string
 * typed data → object) happens once in the factory, so backends always
 * receive the same shapes. The EIP-712 payload keeps its full dApp wire
 * shape (EIP712Domain in types) because backends genuinely diverge there:
 * ethers wants the domain stripped, a Ledger app consumes the full payload.
 *
 * Error contract: vault-locked errors keep their identity (check with
 * `isVaultLockedError`); hardware backends must surface user-rejection
 * distinctly so approval UIs can tell "declined on device" from failure.
 */

const { Wallet, computeAddress } = require('ethers');

const { withVaultPrivateKey, isValidWalletIndex } = require('./vault-access');

/**
 * @typedef {Object} Signer
 * @property {() => Promise<string>} getAddress
 *   Checksummed address of the account (cached after first resolution).
 * @property {(tx: object) => Promise<string>} signTransaction
 *   Complete unsigned tx (nonce, gas, fees, chainId — no population) →
 *   serialized signed tx.
 * @property {(message: string|Uint8Array) => Promise<string>} signMessage
 *   EIP-191 signature over raw bytes (0x-hex is pre-decoded by the factory).
 * @property {(typedData: object) => Promise<string>} signTypedData
 *   EIP-712 signature; receives the parsed full payload
 *   ({domain, types, message}, EIP712Domain in types allowed).
 */

/** 0x-hex dApp messages are signatures over the bytes, not the hex text. */
function normalizeMessage(message) {
  if (typeof message === 'string' && message.startsWith('0x')) {
    return Buffer.from(message.slice(2), 'hex');
  }
  return message;
}

/** dApps send typed data either as an object or a JSON string. */
function normalizeTypedData(typedData) {
  return typeof typedData === 'string' ? JSON.parse(typedData) : typedData;
}

function createVaultBackend(walletIndex) {
  return {
    getAddress: () => withVaultPrivateKey(walletIndex, (privateKey) => computeAddress(privateKey)),
    signTransaction: (tx) =>
      withVaultPrivateKey(walletIndex, (privateKey) => new Wallet(privateKey).signTransaction(tx)),
    signMessage: (message) =>
      withVaultPrivateKey(walletIndex, async (privateKey) => {
        try {
          // signMessage applies the EIP-191 prefix
          return await new Wallet(privateKey).signMessage(message);
        } catch (err) {
          throw new Error(`Message signing failed: ${err.message}`, { cause: err });
        }
      }),
    signTypedData: (typedData) =>
      withVaultPrivateKey(walletIndex, async (privateKey) => {
        try {
          const { domain, types, message } = typedData;
          // ethers computes the domain separator itself
          const typesWithoutDomain = { ...types };
          delete typesWithoutDomain.EIP712Domain;
          return await new Wallet(privateKey).signTypedData(domain, typesWithoutDomain, message);
        } catch (err) {
          throw new Error(`Typed data signing failed: ${err.message}`, { cause: err });
        }
      }),
  };
}

/**
 * Build a signer for the given wallet index.
 *
 * Construction is cheap and does not touch the vault; each method borrows
 * the key per call, so a locked vault fails at signing time with
 * `VAULT_LOCKED_MESSAGE` (same behaviour callers relied on before). The
 * address is memoized after the first successful resolution — it is public
 * and immutable for a given index, and callers like the send flow need it
 * (for the nonce) right before signing.
 *
 * @param {number} walletIndex
 * @returns {Signer}
 */
function getSigner(walletIndex) {
  if (!isValidWalletIndex(walletIndex)) {
    throw new Error('Invalid wallet index');
  }

  const backend = createVaultBackend(walletIndex);

  let address = null;
  return {
    getAddress: async () => {
      if (address === null) {
        address = await backend.getAddress();
      }
      return address;
    },
    signTransaction: (tx) => backend.signTransaction(tx),
    signMessage: (message) => backend.signMessage(normalizeMessage(message)),
    signTypedData: (typedData) => backend.signTypedData(normalizeTypedData(typedData)),
  };
}

module.exports = { getSigner };
