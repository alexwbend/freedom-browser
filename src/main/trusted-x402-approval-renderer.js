(function initTrustedX402Approval() {
  const api = window.trustedX402Approval;
  const heading = document.getElementById('heading');
  const summary = document.getElementById('summary');
  const details = document.getElementById('details');
  const reject = document.getElementById('reject');
  const payOnce = document.getElementById('pay-once');
  const allow = document.getElementById('allow');
  const error = document.getElementById('error');

  function setError(message) {
    error.textContent = message || '';
  }

  function setBusy(isBusy) {
    reject.disabled = isBusy;
    payOnce.disabled = isBusy;
    allow.disabled = isBusy;
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

  async function submitDecision(decide) {
    setError('');
    setBusy(true);
    try {
      const result = await decide();
      if (!result || result.ok !== true) {
        setError(result?.error?.message || 'Payment decision failed.');
        setBusy(false);
      }
    } catch (err) {
      setError(err?.message || 'Payment decision failed.');
      setBusy(false);
    }
  }

  async function loadContext() {
    if (!api || typeof api.getContext !== 'function') {
      setError('Payment approval prompt is unavailable.');
      setBusy(true);
      return;
    }
    const result = await api.getContext();
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Payment approval prompt is unavailable.');
      setBusy(true);
      return;
    }
    const context = result.context || {};
    const actions = context.actions || {};
    heading.textContent = context.heading || 'Review x402 payment';
    summary.textContent = context.origin
      ? `${context.origin} requested a payment.`
      : 'A site requested a payment.';
    renderRows(context.rows);
    payOnce.textContent = actions.payOnceLabel || 'Pay once';
    reject.textContent = actions.rejectLabel || 'Reject';
    if (actions.allowLabel) {
      allow.textContent = actions.allowLabel;
      allow.hidden = false;
    } else {
      allow.hidden = true;
    }
    payOnce.focus();
  }

  payOnce.addEventListener('click', () => submitDecision(api.payOnce));
  allow.addEventListener('click', () => submitDecision(api.payAndAllow));
  reject.addEventListener('click', () => submitDecision(api.reject));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      submitDecision(api.reject);
    }
  });

  loadContext().catch((err) => {
    setError(err?.message || 'Payment approval prompt failed.');
    setBusy(true);
  });
}());
