(function initTrustedSwarmApproval() {
  const api = window.trustedSwarmApproval;
  const heading = document.getElementById('heading');
  const summary = document.getElementById('summary');
  const details = document.getElementById('details');
  const notice = document.getElementById('notice');
  const accept = document.getElementById('accept');
  const reject = document.getElementById('reject');
  const error = document.getElementById('error');

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

  async function submitDecision(decide) {
    setError('');
    setBusy(true);
    try {
      const result = await decide();
      if (!result || result.ok !== true) {
        setError(result?.error?.message || 'Swarm approval decision failed.');
        setBusy(false);
      }
    } catch (err) {
      setError(err?.message || 'Swarm approval decision failed.');
      setBusy(false);
    }
  }

  async function loadContext() {
    if (!api || typeof api.getContext !== 'function') {
      setError('Swarm approval prompt is unavailable.');
      setBusy(true);
      return;
    }
    const result = await api.getContext();
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Swarm approval prompt is unavailable.');
      setBusy(true);
      return;
    }
    const context = result.context || {};
    const actions = context.actions || {};
    heading.textContent = context.heading || 'Review Swarm request';
    summary.textContent = context.summary || 'A site requested Swarm access.';
    notice.textContent = context.notice || 'Approve only if this request matches what you intended.';
    renderRows(context.rows);
    accept.textContent = actions.acceptLabel || 'Allow';
    reject.textContent = actions.rejectLabel || 'Reject';
    reject.focus();
  }

  accept.addEventListener('click', () => submitDecision(api.accept));
  reject.addEventListener('click', () => submitDecision(api.reject));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      submitDecision(api.reject);
    }
  });

  loadContext().catch((err) => {
    setError(err?.message || 'Swarm approval prompt failed.');
    setBusy(true);
  });
}());
