(function initTrustedVaultUnlock() {
  const api = window.trustedVaultUnlock;
  const heading = document.getElementById('heading');
  const summary = document.getElementById('summary');
  const details = document.getElementById('details');
  const form = document.getElementById('unlock-form');
  const password = document.getElementById('password');
  const submit = document.getElementById('submit');
  const cancel = document.getElementById('cancel');
  const error = document.getElementById('error');

  function setError(message) {
    error.textContent = message || '';
  }

  function setBusy(isBusy) {
    submit.disabled = isBusy;
    cancel.disabled = isBusy;
    password.disabled = isBusy;
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

  async function loadContext() {
    if (!api || typeof api.getContext !== 'function') {
      setError('Vault unlock prompt is unavailable.');
      setBusy(true);
      return;
    }
    const result = await api.getContext();
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Vault unlock prompt is unavailable.');
      setBusy(true);
      return;
    }
    const context = result.context || {};
    heading.textContent = context.heading || 'Unlock vault';
    summary.textContent = context.origin
      ? `${context.origin} needs your vault unlocked to continue.`
      : 'Unlock your vault to continue.';
    renderRows(context.rows);
    password.focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    const result = await api.submit(password.value);
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Vault unlock failed.');
      setBusy(false);
      password.select();
    }
  });

  cancel.addEventListener('click', () => {
    setBusy(true);
    api.cancel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setBusy(true);
      api.cancel();
    }
  });

  loadContext().catch((err) => {
    setError(err?.message || 'Vault unlock prompt failed.');
    setBusy(true);
  });
}());
