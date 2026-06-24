(function initTrustedWalletApproval() {
  const api = window.trustedWalletApproval;
  const heading = document.getElementById('heading');
  const summary = document.getElementById('summary');
  const details = document.getElementById('details');
  const accountChoices = document.getElementById('account-choices');
  const accountChoiceList = document.getElementById('account-choice-list');
  const notice = document.getElementById('notice');
  const accept = document.getElementById('accept');
  const reject = document.getElementById('reject');
  const error = document.getElementById('error');
  let selectedWalletIndex = null;

  function setError(message) {
    error.textContent = message || '';
  }

  function setBusy(isBusy) {
    accept.disabled = isBusy;
    reject.disabled = isBusy;
  }

  function renderRows(rows) {
    details.textContent = '';
    if (!Array.isArray(rows) || rows.length === 0) {
      details.hidden = true;
      return;
    }
    rows.forEach((row) => {
      const term = document.createElement('dt');
      term.textContent = row.label;
      const value = document.createElement('dd');
      value.textContent = row.value;
      details.append(term, value);
    });
    details.hidden = false;
  }

  function formatAddress(address) {
    if (typeof address !== 'string' || address.length < 14) {
      return address || 'Unavailable';
    }
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  }

  function clearChildren(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function renderAccountChoices(choices) {
    clearChildren(accountChoiceList);
    selectedWalletIndex = null;
    if (!Array.isArray(choices) || choices.length === 0) {
      accountChoices.hidden = true;
      return;
    }
    const defaultChoice = choices.find((choice) => choice.active) || choices[0];
    selectedWalletIndex = defaultChoice.walletIndex;
    choices.forEach((choice, index) => {
      const label = document.createElement('label');
      label.className = 'account-choice';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'wallet-account';
      input.value = String(choice.walletIndex);
      input.checked = choice.walletIndex === selectedWalletIndex;
      input.addEventListener('change', () => {
        selectedWalletIndex = choice.walletIndex;
      });

      const body = document.createElement('span');
      body.className = 'account-choice-body';

      const title = document.createElement('span');
      title.className = 'account-choice-title';
      title.textContent = choice.name || `Wallet ${choice.walletIndex}`;

      const meta = document.createElement('span');
      meta.className = 'account-choice-meta';
      meta.textContent = `${formatAddress(choice.account)} - #${choice.walletIndex}`;

      body.append(title, meta);
      if (choice.active) {
        const badge = document.createElement('span');
        badge.className = 'account-choice-badge';
        badge.textContent = 'Active';
        body.append(badge);
      }
      label.append(input, body);
      accountChoiceList.append(label);
      if (index === 0 && selectedWalletIndex === null) {
        selectedWalletIndex = choice.walletIndex;
      }
    });
    accountChoices.hidden = false;
  }

  async function submitDecision(decide, payload = {}) {
    setError('');
    setBusy(true);
    try {
      const result = await decide(payload);
      if (!result || result.ok !== true) {
        setError(result?.error?.message || 'Wallet approval decision failed.');
        setBusy(false);
      }
    } catch (err) {
      setError(err?.message || 'Wallet approval decision failed.');
      setBusy(false);
    }
  }

  async function loadContext() {
    if (!api || typeof api.getContext !== 'function') {
      setError('Wallet approval prompt is unavailable.');
      setBusy(true);
      return;
    }
    const result = await api.getContext();
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Wallet approval prompt is unavailable.');
      setBusy(true);
      return;
    }
    const context = result.context || {};
    const actions = context.actions || {};
    heading.textContent = context.heading || 'Review wallet request';
    summary.textContent = context.summary || 'A site requested wallet access.';
    notice.textContent = context.notice || 'Approve only if this request matches what you intended.';
    renderRows(context.rows);
    renderAccountChoices(context.accountChoices);
    accept.textContent = actions.acceptLabel || 'Approve';
    reject.textContent = actions.rejectLabel || 'Reject';
    accept.focus();
  }

  accept.addEventListener('click', () => submitDecision(api.accept, { selectedWalletIndex }));
  reject.addEventListener('click', () => submitDecision(api.reject));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      submitDecision(api.reject);
    }
  });

  loadContext().catch((err) => {
    setError(err?.message || 'Wallet approval prompt failed.');
    setBusy(true);
  });
}());
