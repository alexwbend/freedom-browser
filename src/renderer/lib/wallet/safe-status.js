/**
 * Safe account status card — the "needs funds" / activation blocking
 * states as first-class UI (research doc Part B, decision 2).
 *
 * Shown under the Send/Receive actions whenever the active account is a
 * not-yet-deployed Safe:
 *   - ready:       activation fee quote + who pays + Activate button
 *   - needs-funds: blocking "fund <executor> with ≥ X xDAI" card
 *   - no-executor: none of the owners is a browser account that can pay
 * Deployed Safes show nothing. Sending is disabled for Safe accounts
 * until the signing-checklist flow ships; the card is what explains why
 * the account is receive-only.
 */

import { walletState } from './wallet-state.js';
import { escapeHtml, truncateAddress, formatRawTokenBalance, isSafeAccount } from './wallet-utils.js';
import { updateSendAvailability } from './send.js';

let card;
let refreshToken = 0;

function activeWallet() {
  return walletState.derivedWallets.find(
    (wallet) => wallet.index === walletState.activeWalletIndex
  );
}

/**
 * Re-evaluate the card for the active account. Called whenever the
 * active account changes (wallet-selector) and after activation.
 */
export async function refreshSafeStatusCard() {
  card = document.getElementById('safe-status-card');
  if (!card) return;

  updateSendAvailability();

  const wallet = activeWallet();
  if (!isSafeAccount(wallet?.index)) {
    card.classList.add('hidden');
    return;
  }

  const token = ++refreshToken;
  render(`<div class="safe-status-text">Checking activation status…</div>`);

  const result = await window.wallet.getSafeStatus(wallet.index);
  if (token !== refreshToken) return; // superseded by an account switch
  if (!result.success) {
    render(`<div class="safe-status-text">${escapeHtml(result.error)}</div>`);
    return;
  }

  renderStatus(result.status);
}

function renderStatus(status) {
  if (status.deployed) {
    card.classList.add('hidden');
    return;
  }

  if (status.executorIndex === null) {
    render(`
      <div class="safe-status-text">
        This account can receive funds, but none of its owners is a
        browser account that could pay the activation fee.
      </div>
    `);
    return;
  }

  const executorName =
    walletState.derivedWallets.find((wallet) => wallet.index === status.executorIndex)?.name ||
    'an owner account';

  if (status.needsFunds) {
    render(`
      <div class="safe-status-text">
        <strong>Receive-only.</strong> To activate on Gnosis, fund
        <code>${escapeHtml(truncateAddress(status.executorAddress))}</code>
        (${escapeHtml(executorName)}) with at least
        <strong>${formatRawTokenBalance(status.estimatedCost)} xDAI</strong>.
      </div>
      <button type="button" class="safe-status-btn" id="safe-status-refresh">I've added funds</button>
    `);
    document
      .getElementById('safe-status-refresh')
      ?.addEventListener('click', refreshSafeStatusCard);
    return;
  }

  render(`
    <div class="safe-status-text">
      <strong>Receive-only until activated.</strong> One-time activation
      on Gnosis costs ≈ ${formatRawTokenBalance(status.estimatedCost)} xDAI,
      paid by ${escapeHtml(executorName)}.
    </div>
    <button type="button" class="safe-status-btn primary" id="safe-status-activate">Activate</button>
    <div class="unlock-error hidden" id="safe-status-error"></div>
  `);
  document.getElementById('safe-status-activate')?.addEventListener('click', handleActivate);
}

async function handleActivate() {
  const wallet = activeWallet();
  if (!wallet) return;

  const button = document.getElementById('safe-status-activate');
  const errorEl = document.getElementById('safe-status-error');
  if (button) {
    button.disabled = true;
    button.textContent = 'Activating…';
  }
  errorEl?.classList.add('hidden');

  const result = await window.wallet.activateSafe(wallet.index);
  if (result.success) {
    await refreshSafeStatusCard(); // deployed now → card hides
    return;
  }

  // NEEDS_FUNDS and friends: re-render the status so the blocking state
  // (which explains what to do) replaces the failed button.
  console.error('[SafeStatus] Activation failed:', result.error);
  await refreshSafeStatusCard();
}

function render(html) {
  card.innerHTML = html;
  card.classList.remove('hidden');
}
