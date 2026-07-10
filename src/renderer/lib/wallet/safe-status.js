/**
 * Safe account status card — the blocking states of a Safe account as
 * first-class UI (research doc Part B, decision 2), shown under the
 * Send/Receive actions when the active account is a Safe:
 *   - ready:        activation fee quote + who pays + Activate button
 *   - needs-funds:  blocking "fund <executor> with ≥ X xDAI" card
 *   - no-executor:  none of the owners is a browser account that can pay
 *   - pending tx:   a half-signed SafeTx waiting for signatures, with
 *                   continue/discard (it survives restarts)
 * A deployed Safe with nothing pending shows no card. The Send button's
 * availability is owned by send.js; this module just triggers the
 * re-evaluation whenever the active account changes.
 */

import { walletState } from './wallet-state.js';
import {
  escapeHtml,
  truncateAddress,
  formatRawTokenBalance,
  walletRecord,
  showInlineError,
} from './wallet-utils.js';
import { updateSendAvailability } from './send.js';
import { refreshBalances } from './balance-display.js';

let card;
let refreshToken = 0;

// A safe send that just finished (or was abandoned) changes what the
// card should show — re-evaluate when the send screen closes.
window.addEventListener('wallet:send-closed', () => refreshSafeStatusCard());

/**
 * Re-evaluate the card for the active account. Called whenever the
 * active account changes (wallet-selector) and after activation.
 */
export async function refreshSafeStatusCard() {
  card = document.getElementById('safe-status-card');
  if (!card) return;

  updateSendAvailability();

  const wallet = walletRecord();
  if (wallet?.type !== 'safe') {
    card.classList.add('hidden');
    return;
  }

  const token = ++refreshToken;
  render(`<div class="safe-status-text">Checking account status…</div>`);

  // A pending half-signed tx trumps everything else the card could show
  // (and implies the safe is deployed — no need to quote activation).
  const pendingResult = await window.wallet.safePendingInfo(wallet.index);
  if (token !== refreshToken) return; // superseded by an account switch
  if (pendingResult.success && pendingResult.pending) {
    renderPending(pendingResult.pending);
    return;
  }

  const statusResult = await window.wallet.getSafeStatus(wallet.index);
  if (token !== refreshToken) return;
  if (!statusResult.success) {
    render(`<div class="safe-status-text">${escapeHtml(statusResult.error)}</div>`);
    return;
  }

  // Main owns deployment truth (it self-heals the stored record from
  // chain state) — sync the renderer's record snapshot so capability
  // gates like the Send button don't act on a stale copy.
  if (statusResult.status.deployed && !wallet.deployed?.[statusResult.status.chainId]) {
    wallet.deployed = { ...wallet.deployed, [statusResult.status.chainId]: true };
    updateSendAvailability();
  }

  renderStatus(statusResult.status);
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

function renderPending(pending) {
  render(`
    <div class="safe-status-text">
      <strong>Transaction awaiting signatures</strong>
      (${pending.collected} of ${pending.threshold} collected). It was
      kept safe — continue signing or discard it.
    </div>
    <div class="safe-status-btn-row">
      <button type="button" class="safe-status-btn primary" id="safe-status-continue">Continue signing</button>
      <button type="button" class="safe-status-btn" id="safe-status-discard">Discard</button>
    </div>
    <div class="unlock-error hidden" id="safe-status-error"></div>
  `);
  document.getElementById('safe-status-continue')?.addEventListener('click', handleResume);
  document.getElementById('safe-status-discard')?.addEventListener('click', handleDiscard);
}

async function handleResume() {
  const wallet = walletRecord();
  if (!wallet) return;

  const button = document.getElementById('safe-status-continue');
  if (button) {
    button.disabled = true;
    button.textContent = 'Collecting signatures…';
  }

  const result = await window.wallet.safeResume(wallet.index);
  await refreshSafeStatusCard(); // re-render first, then surface errors on it
  if (result.success) {
    setTimeout(() => refreshBalances(), 3000);
  } else {
    console.error('[SafeStatus] Resume failed:', result.error);
    showInlineError(document.getElementById('safe-status-error'), result.error);
  }
}

async function handleDiscard() {
  const wallet = walletRecord();
  if (!wallet) return;
  if (!confirm('Discard this transaction? The collected signatures will be thrown away.')) {
    return;
  }
  await window.wallet.safeCancelPending(wallet.index);
  await refreshSafeStatusCard();
}

async function handleActivate() {
  const wallet = walletRecord();
  if (!wallet) return;

  const button = document.getElementById('safe-status-activate');
  if (button) {
    button.disabled = true;
    button.textContent = 'Activating…';
  }

  const result = await window.wallet.activateSafe(wallet.index);
  if (!result.success) {
    // NEEDS_FUNDS and friends: the re-rendered status is the blocking
    // state that explains what to do.
    console.error('[SafeStatus] Activation failed:', result.error);
  }
  await refreshSafeStatusCard();
}

function render(html) {
  card.innerHTML = html;
  card.classList.remove('hidden');
}
