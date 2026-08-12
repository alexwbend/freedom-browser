/**
 * Connect Ledger Module
 *
 * "Connect hardware wallet" subscreen: waits for a Ledger with the
 * Ethereum app open, lists device accounts per derivation scheme, and
 * adds the chosen one to the wallet list. No vault unlock involved —
 * the key never leaves the device.
 */

import { walletState, registerScreenHider } from './wallet-state.js';
import { refuseSubscreenWhileInFlight } from './signature-flight.js';
import { loadDerivedWallets, updateWalletSelectorDisplay } from './wallet-selector.js';
import { refreshBalances } from './balance-display.js';
import { escapeHtml, truncateAddress } from './wallet-utils.js';

const ACCOUNTS_PER_PAGE = 5;
const DETECT_POLL_MS = 1500;

// DOM references
let screen;
let backBtn;
let detectView;
let statusText;
let accountsView;
let schemeSelect;
let accountList;
let loadMoreBtn;
let nameInput;
let submitBtn;
let errorEl;
let successView;
let resultName;
let resultAddress;
let doneBtn;

// Flow state
let detectTimer = null;
let discoveredAccounts = [];
let selectedAccount = null;
let accountAdded = false;

export function initConnectLedger() {
  screen = document.getElementById('sidebar-connect-ledger');
  backBtn = document.getElementById('connect-ledger-back');
  detectView = document.getElementById('connect-ledger-detect');
  statusText = document.getElementById('connect-ledger-status-text');
  accountsView = document.getElementById('connect-ledger-accounts-step');
  schemeSelect = document.getElementById('connect-ledger-scheme');
  accountList = document.getElementById('connect-ledger-account-list');
  loadMoreBtn = document.getElementById('connect-ledger-load-more');
  nameInput = document.getElementById('connect-ledger-name-input');
  submitBtn = document.getElementById('connect-ledger-submit');
  errorEl = document.getElementById('connect-ledger-error');
  successView = document.getElementById('connect-ledger-success');
  resultName = document.getElementById('connect-ledger-result-name');
  resultAddress = document.getElementById('connect-ledger-result-address');
  doneBtn = document.getElementById('connect-ledger-done');

  registerScreenHider(() => {
    stopDetectLoop();
    screen?.classList.add('hidden');
  });

  backBtn?.addEventListener('click', closeConnectLedger);
  doneBtn?.addEventListener('click', closeConnectLedger);
  schemeSelect?.addEventListener('change', () => reloadAccounts());
  loadMoreBtn?.addEventListener('click', () => loadAccountsPage(false));
  submitBtn?.addEventListener('click', handleAddAccount);
}

export async function openConnectLedger() {
  if (refuseSubscreenWhileInFlight('Connect Ledger screen')) return;

  walletState.identityView?.classList.add('hidden');
  screen?.classList.remove('hidden');

  resetFlowState();
  showStep('detect');
  detectTick();
}

export async function closeConnectLedger() {
  if (!screen || screen.classList.contains('hidden')) return;

  stopDetectLoop();
  screen.classList.add('hidden');
  walletState.identityView?.classList.remove('hidden');

  if (accountAdded) {
    await loadDerivedWallets();
    if (walletState.fullAddresses.wallet) {
      refreshBalances();
    }
  }
}

function resetFlowState() {
  discoveredAccounts = [];
  selectedAccount = null;
  accountAdded = false;
  if (nameInput) nameInput.value = '';
  if (accountList) accountList.innerHTML = '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Add Account';
  }
  hideError();
  setStatus('Looking for your Ledger…');
}

function showStep(step) {
  detectView?.classList.toggle('hidden', step !== 'detect');
  accountsView?.classList.toggle('hidden', step !== 'accounts');
  successView?.classList.toggle('hidden', step !== 'success');
}

// --- Step 1: detection loop -------------------------------------------

function stopDetectLoop() {
  if (detectTimer) {
    clearTimeout(detectTimer);
    detectTimer = null;
  }
}

async function detectTick() {
  // The screen may have been closed while an IPC call was in flight.
  if (!screen || screen.classList.contains('hidden')) return;

  const loaded = await loadAccountsPage(true, setStatus);
  if (loaded) {
    showStep('accounts');
  } else {
    detectTimer = setTimeout(detectTick, DETECT_POLL_MS);
  }
}

function setStatus(message) {
  if (statusText) statusText.textContent = message;
}

// --- Step 2: account selection ----------------------------------------

async function reloadAccounts() {
  discoveredAccounts = [];
  selectedAccount = null;
  if (submitBtn) submitBtn.disabled = true;
  if (accountList) accountList.innerHTML = '<div class="connect-ledger-loading">Reading accounts…</div>';
  hideError();

  const loaded = await loadAccountsPage(true, showError);
  if (!loaded) {
    // The device may have been unplugged mid-flow — fall back to detection.
    showStep('detect');
    detectTick();
  }
}

/**
 * Fetch one page of device accounts.
 *
 * @param {boolean} replace - true replaces the list (first page), false appends
 * @param {(message: string) => void} [onFailure] - where a failure message goes
 *   (detect step: status line; accounts step: error box)
 * @returns {Promise<boolean>} whether the page loaded
 */
async function loadAccountsPage(replace, onFailure = showError) {
  if (loadMoreBtn) loadMoreBtn.disabled = true;
  try {
    const result = await window.ledger.getAccounts({
      scheme: schemeSelect?.value || 'live',
      start: replace ? 0 : discoveredAccounts.length,
      count: ACCOUNTS_PER_PAGE,
    });
    if (!result.success) {
      onFailure(result.error || 'Failed to read accounts from the device');
      return false;
    }
    discoveredAccounts = replace ? result.accounts : [...discoveredAccounts, ...result.accounts];
    renderAccountList();
    return true;
  } catch (err) {
    console.error('[ConnectLedger] Account load failed:', err);
    onFailure(err.message);
    return false;
  } finally {
    if (loadMoreBtn) loadMoreBtn.disabled = false;
  }
}

function renderAccountList() {
  if (!accountList) return;
  accountList.innerHTML = '';

  const existingAddresses = new Set(
    walletState.derivedWallets
      .filter((wallet) => wallet.address)
      .map((wallet) => wallet.address.toLowerCase())
  );

  discoveredAccounts.forEach((account) => {
    const alreadyAdded = existingAddresses.has(account.address.toLowerCase());
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'connect-ledger-account';
    if (alreadyAdded) item.classList.add('added');
    if (selectedAccount?.address === account.address) item.classList.add('selected');
    item.disabled = alreadyAdded;

    item.innerHTML = `
      <div class="connect-ledger-account-info">
        <code class="connect-ledger-account-address">${escapeHtml(truncateAddress(account.address))}</code>
        <span class="connect-ledger-account-path">m/${escapeHtml(account.path)}</span>
      </div>
      ${alreadyAdded ? '<span class="connect-ledger-account-added">Added</span>' : ''}
    `;

    if (!alreadyAdded) {
      item.addEventListener('click', () => {
        selectedAccount = account;
        if (submitBtn) submitBtn.disabled = false;
        renderAccountList();
      });
    }

    accountList.appendChild(item);
  });
}

async function handleAddAccount() {
  if (!selectedAccount) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding…';
  }
  hideError();

  try {
    const result = await window.ledger.addAccount(
      nameInput?.value?.trim() || '',
      selectedAccount.address,
      selectedAccount.path
    );
    if (!result.success) {
      throw new Error(result.error);
    }

    accountAdded = true;
    walletState.derivedWallets.push(result.wallet);

    if (resultName) resultName.textContent = result.wallet.name;
    if (resultAddress) resultAddress.textContent = result.wallet.address;

    // Switch to the new account, mirroring the create-wallet flow.
    const activated = await window.wallet.setActiveWallet(result.wallet.index);
    if (activated.success) {
      walletState.activeWalletIndex = result.wallet.index;
      updateWalletSelectorDisplay(result.wallet);
      walletState.fullAddresses.wallet = result.wallet.address || '';
    }

    showStep('success');
  } catch (err) {
    console.error('[ConnectLedger] Failed to add account:', err);
    showError(err.message || 'Failed to add the Ledger account');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add Account';
    }
  }
}

function showError(message) {
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }
}

function hideError() {
  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }
}
