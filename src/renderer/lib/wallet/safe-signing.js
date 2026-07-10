/**
 * Safe signing board — the "collect signatures" subscreen.
 *
 * Collecting owner signatures is a task the user completes at their own
 * pace, possibly across days and app restarts: each owner row carries
 * its own action ("Sign with Ledger", "Show QR code") that the user
 * taps when the device is actually in hand. A failed or rejected
 * attempt is a ROW state; the transaction itself just keeps waiting.
 * Closing the board parks it (persisted main-side); the account status
 * card is the way back in.
 *
 * Free signatures stay free: unsigned mnemonic owners are collected
 * silently when the board opens (vault unlocked). The moment the
 * threshold is met the board executes automatically — the user already
 * approved the send on the review screen.
 */

import { walletState, registerScreenHider } from './wallet-state.js';
import { escapeHtml, truncateAddress, formatRawTokenBalance, walletRecord, timeAgo } from './wallet-utils.js';
import { refreshBalances } from './balance-display.js';
import { showVaultUnlock } from './vault-unlock.js';

// DOM references
let screen;
let backBtn;
let titleEl;
let content;

// Board state
let boardSafeIndex = null;
let state = null; // SafeSendState from main
let phase = 'board'; // 'board' | 'executing' | 'success' | 'superseded'
let executed = null; // {hash, explorerUrl}
let executeError = null; // {message, needsFunds}
let signingIndex = null; // owner row with a live ceremony
let rowNotes = new Map(); // ownerIndex → {kind: 'error'|'info', text}
let ledgerDetected = false;
let ledgerPollTimer = null;

export function initSafeSigning() {
  screen = document.getElementById('sidebar-safe-signing');
  backBtn = document.getElementById('safe-signing-back');
  titleEl = document.getElementById('safe-signing-title');
  content = document.getElementById('safe-signing-content');

  registerScreenHider(() => hideScreen());
  backBtn?.addEventListener('click', closeSafeSigning);
}

/** Open (or re-open) the board for a safe's pending transaction. */
export async function openSafeSigningBoard(safeIndex) {
  boardSafeIndex = safeIndex;
  phase = 'board';
  executed = null;
  executeError = null;
  signingIndex = null;
  rowNotes = new Map();

  walletState.identityView?.classList.add('hidden');
  screen?.classList.remove('hidden');

  await refreshState();
  if (!state) {
    // nothing pending (e.g. discarded elsewhere) — nothing to show
    closeSafeSigning();
    return;
  }
  render();
  startLedgerDetection();
  await progressAutomatics();
}

export function closeSafeSigning() {
  if (!screen || screen.classList.contains('hidden')) return;
  if (signingIndex !== null || phase === 'executing') return; // busy — see render() note
  hideScreen();
  walletState.identityView?.classList.remove('hidden');
  window.dispatchEvent(new CustomEvent('wallet:safe-signing-closed'));
  if (executed) {
    setTimeout(() => refreshBalances(), 3000);
  }
}

function hideScreen() {
  stopLedgerDetection();
  screen?.classList.add('hidden');
}

async function refreshState() {
  const result = await window.wallet.safeState(boardSafeIndex);
  state = result.success ? result.state : null;
  if (state?.status === 'superseded') phase = 'superseded';
}

/**
 * Walk the user through the standard vault unlock (a locked vault is a
 * step, not an error). The unlock screen replaces the board; bring the
 * board back either way.
 * @returns {Promise<boolean>} whether the vault is now unlocked
 */
async function requestVaultUnlock() {
  let unlocked = true;
  try {
    await showVaultUnlock('Your multi-owner transaction');
  } catch {
    unlocked = false; // user cancelled
  }
  walletState.identityView?.classList.add('hidden');
  screen?.classList.remove('hidden');
  render();
  return unlocked;
}

/** Silent free signatures (main owns the policy) + execute if ready. */
async function progressAutomatics() {
  if (!state || phase !== 'board') return;
  if (state.collected < state.threshold) {
    const result = await window.wallet.safeSign(boardSafeIndex); // free-signature sweep
    if (result.success) {
      state = result.state;
      render();
    }
  }
  await maybeExecute();
}

/**
 * The single decision site for execution: threshold met, board idle,
 * and no unresolved execution error (its banner owns the retry).
 */
async function maybeExecute() {
  if (state && phase === 'board' && !executeError && state.collected >= state.threshold) {
    await executeNow();
  }
}

// --- signing ---------------------------------------------------------------

async function signOwner(ownerIndex) {
  if (signingIndex !== null || phase !== 'board') return;
  signingIndex = ownerIndex;
  rowNotes.delete(ownerIndex);
  render();

  const result = await window.wallet.safeSign(boardSafeIndex, ownerIndex);
  signingIndex = null;

  if (result.success) {
    state = result.state;
    render();
    await maybeExecute();
    return;
  }

  if (result.code === 'VAULT_LOCKED') {
    if (await requestVaultUnlock()) {
      return signOwner(ownerIndex);
    }
    rowNotes.set(ownerIndex, { kind: 'info', text: 'Unlock your wallet to sign' });
    render();
    return;
  }

  const note = describeRowFailure(result);
  if (note) rowNotes.set(ownerIndex, note);
  await refreshState();
  render();
  // A failed Ledger attempt may mean it was unplugged again — re-probe.
  if (walletRecord(ownerIndex)?.type === 'ledger') {
    startLedgerDetection();
  }
}

/**
 * A rejection is a decision, not an error — the row returns to waiting
 * with a quiet note (or none for a closed QR). Everything else keeps
 * main's curated error message with error styling.
 */
function describeRowFailure(result) {
  if (result.code === 'LEDGER_USER_REJECTED' || result.code === 'REMOTE_USER_REJECTED') {
    return { kind: 'info', text: 'Declined on the device' };
  }
  if (result.code === 'REMOTE_USER_CANCELLED') {
    return null; // QR closed — plain return to waiting
  }
  return { kind: 'error', text: result.error || 'Signing failed — try again' };
}

// --- executing -------------------------------------------------------------

async function executeNow() {
  phase = 'executing';
  executeError = null;
  render();

  const result = await window.wallet.safeExecute(boardSafeIndex);
  if (result.success && result.state?.status === 'executed') {
    state = result.state; // pre-clear snapshot — display survives for the summary
    executed = result.state.executed;
    phase = 'success';
  } else if (result.success && result.state?.status === 'superseded') {
    state = result.state;
    phase = 'superseded';
  } else if (result.code === 'VAULT_LOCKED') {
    // The executor signs with the vault key — unlocking is a step in
    // the flow, not a failure.
    phase = 'board';
    await refreshState();
    if (await requestVaultUnlock()) {
      return executeNow();
    }
    executeError = {
      message: 'Your wallet is locked — unlock it to execute the transaction',
      needsFunds: false,
    };
  } else {
    executeError = {
      message: result.error || 'Execution failed',
      needsFunds: result.code === 'SAFE_NEEDS_FUNDS',
    };
    phase = 'board';
    await refreshState();
  }
  render();
}

async function handleDiscard() {
  if (signingIndex !== null || phase === 'executing') return;
  const what = summaryLine();
  if (!confirm(`Discard ${what}?\n\nThe collected signatures will be deleted — devices that already signed would need to sign again.`)) {
    return;
  }
  const result = await window.wallet.safeCancelPending(boardSafeIndex);
  if (result.success) {
    state = null;
    closeSafeSigning();
  }
}

// --- warm Ledger detection ---------------------------------------------------

function hasUnsignedLedgerRow() {
  return Boolean(state?.owners.some((owner) => owner.type === 'ledger' && !owner.signed));
}

function startLedgerDetection() {
  stopLedgerDetection();
  const tick = async () => {
    ledgerPollTimer = null;
    if (phase !== 'board' || !hasUnsignedLedgerRow()) return;
    if (signingIndex === null) {
      const result = await window.ledger.getAccounts({ scheme: 'live', start: 0, count: 1 });
      if (result.success) {
        // Detected — highlight the row and stop probing (the transport
        // shouldn't be poked more than needed; a failed Ledger signing
        // attempt restarts detection).
        ledgerDetected = true;
        render();
        return;
      }
    }
    ledgerPollTimer = setTimeout(tick, 2000);
  };
  if (hasUnsignedLedgerRow()) ledgerPollTimer = setTimeout(tick, 0);
}

function stopLedgerDetection() {
  if (ledgerPollTimer) {
    clearTimeout(ledgerPollTimer);
    ledgerPollTimer = null;
  }
  ledgerDetected = false;
}

// --- rendering ---------------------------------------------------------------

function ownerName(index) {
  return walletRecord(index)?.name || `Account ${index}`;
}

export function summaryLine(display = state?.display) {
  const d = display || {};
  // Entries persisted before presentation fields existed carry only the
  // atomic amount — format it instead of showing raw wei.
  const amount =
    d.formattedAmount ||
    (d.amount ? formatRawTokenBalance(d.amount, d.decimals ?? 18) : '');
  const symbol = d.symbol || (d.asset ? '' : 'xDAI');
  const to = d.recipientName || truncateAddress(d.toAddress || '');
  return `sending ${amount} ${symbol} to ${to}`.replace(/\s+/g, ' ').trim();
}

function render() {
  if (!content) return;

  if (phase === 'success') {
    renderSuccess();
    return;
  }
  if (phase === 'superseded') {
    renderSuperseded();
    return;
  }
  if (!state) return;

  const executorName = state.executorIndex !== null ? ownerName(state.executorIndex) : null;
  const total = state.owners.length;
  const thresholdNote =
    total > state.threshold
      ? `any ${state.threshold} of the ${total} owners can sign`
      : `all ${state.threshold} owners must sign`;
  const busy = phase === 'executing';

  if (titleEl) titleEl.textContent = busy ? 'Executing transaction' : 'Collect signatures';
  if (backBtn) backBtn.classList.toggle('hidden', busy || signingIndex !== null);

  content.innerHTML = `
    <div class="safe-signing-summary">
      <div class="safe-signing-what">${escapeHtml(capitalize(summaryLine()))}</div>
      <div class="safe-signing-meta">
        from ${escapeHtml(walletRecord(boardSafeIndex)?.name || 'Safe account')} ·
        started ${escapeHtml(timeAgo(new Date(state.createdAt)).toLowerCase())}
      </div>
    </div>

    <div class="safe-signing-counter">
      <strong>${state.collected} of ${state.threshold} signatures</strong> — ${escapeHtml(thresholdNote)}.
    </div>

    <div class="safe-signing-rows">${state.owners.map(renderRow).join('')}</div>

    ${busy ? `
      <div class="safe-signing-executing">
        <span class="connect-ledger-status-spinner"></span>
        Executing — broadcast by ${escapeHtml(executorName || 'an owner account')}…
      </div>
    ` : `
      ${executeError ? renderExecuteError() : ''}
      <div class="safe-signing-note">
        Network fee is paid by ${escapeHtml(executorName || 'an owner account')} when the
        transaction executes${state.collected >= state.threshold ? '' : ' — it executes automatically after the last signature'}.
      </div>
      <div class="safe-signing-note">
        You can leave this screen: the transaction keeps waiting and can be
        continued from the account card anytime.
      </div>
      <button type="button" class="safe-status-btn safe-signing-discard" id="safe-signing-discard"
        ${signingIndex !== null ? 'disabled' : ''}>Discard transaction</button>
    `}
  `;

  content.querySelectorAll('[data-sign-owner]').forEach((button) => {
    button.addEventListener('click', () => signOwner(Number(button.dataset.signOwner)));
  });
  document.getElementById('safe-signing-discard')?.addEventListener('click', handleDiscard);
  document.getElementById('safe-signing-retry-execute')?.addEventListener('click', executeNow);
}

function renderRow(owner) {
  const name = escapeHtml(ownerName(owner.index));
  const note = rowNotes.get(owner.index);
  const thresholdMet = state.collected >= state.threshold;
  const isSigning = signingIndex === owner.index;

  let stateHtml;
  if (owner.signed) {
    stateHtml = '<span class="safe-signing-row-state signed">✓ Signed</span>';
  } else if (isSigning) {
    stateHtml = '<span class="safe-signing-row-state"><span class="connect-ledger-status-spinner"></span> Waiting…</span>';
  } else if (thresholdMet) {
    stateHtml = '<span class="safe-signing-row-state muted">Not needed</span>';
  } else {
    stateHtml = renderRowAction(owner);
  }

  const typeLabel = { ledger: 'Ledger', remote: 'Phone', mnemonic: 'This browser' }[owner.type] || '';
  return `
    <div class="safe-signing-row ${owner.signed ? 'signed' : ''} ${isSigning ? 'signing' : ''}">
      <div class="safe-signing-row-info">
        <span class="safe-signing-row-name">${name}</span>
        <span class="safe-signing-row-type">${typeLabel}</span>
        ${note?.text ? `<span class="safe-signing-row-note ${note.kind}">${escapeHtml(note.text)}</span>` : ''}
      </div>
      ${stateHtml}
    </div>
  `;
}

function renderRowAction(owner) {
  const disabled = signingIndex !== null ? 'disabled' : '';
  if (owner.type === 'ledger') {
    const label = ledgerDetected ? 'Ledger detected — sign now' : 'Sign with Ledger';
    return `<button type="button" class="safe-status-btn ${ledgerDetected ? 'primary' : ''}"
      data-sign-owner="${owner.index}" ${disabled}>${label}</button>`;
  }
  if (owner.type === 'remote') {
    return `<button type="button" class="safe-status-btn" data-sign-owner="${owner.index}" ${disabled}>Show QR code</button>`;
  }
  return `<button type="button" class="safe-status-btn" data-sign-owner="${owner.index}" ${disabled}>Sign</button>`;
}

function renderExecuteError() {
  const hint = executeError.needsFunds
    ? 'Add xDAI to that account, then try again — the signatures are kept.'
    : 'The signatures are kept — you can try again.';
  return `
    <div class="safe-signing-banner">
      <div>${escapeHtml(executeError.message)}</div>
      <div class="safe-signing-banner-hint">${escapeHtml(hint)}</div>
      <button type="button" class="safe-status-btn primary" id="safe-signing-retry-execute">
        ${executeError.needsFunds ? "I've added funds — try again" : 'Try again'}
      </button>
    </div>
  `;
}

function renderSuccess() {
  if (titleEl) titleEl.textContent = 'Transaction sent';
  if (backBtn) backBtn.classList.remove('hidden');
  content.innerHTML = `
    <div class="create-wallet-success-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="8 12 11 15 16 9"/>
      </svg>
    </div>
    <h4 class="create-wallet-success-title">Sent!</h4>
    <p class="create-wallet-message">${escapeHtml(capitalize(summaryLine()))}.</p>
    ${executed?.explorerUrl ? `
      <a href="${escapeHtml(executed.explorerUrl)}" target="_blank" rel="noreferrer"
         class="recent-payments-link">View on explorer →</a>
    ` : ''}
    <button type="button" class="create-wallet-done-btn" id="safe-signing-done">Done</button>
  `;
  document.getElementById('safe-signing-done')?.addEventListener('click', closeSafeSigning);
}

function renderSuperseded() {
  if (titleEl) titleEl.textContent = 'Transaction outdated';
  if (backBtn) backBtn.classList.remove('hidden');
  content.innerHTML = `
    <div class="safe-signing-summary">
      <div class="safe-signing-what">${escapeHtml(capitalize(summaryLine()))}</div>
    </div>
    <div class="safe-signing-banner">
      <div>
        This transaction can no longer be executed — the account has
        processed another transaction since it was created (possibly this
        one, from an earlier attempt).
      </div>
      <div class="safe-signing-banner-hint">
        Check your payment history; if the send isn't there, discard this
        and start again.
      </div>
      <button type="button" class="safe-status-btn" id="safe-signing-discard">Discard transaction</button>
    </div>
  `;
  document.getElementById('safe-signing-discard')?.addEventListener('click', handleDiscard);
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
