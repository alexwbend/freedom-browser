(function initTrustedPaymentsSurface() {
  const api = window.trustedPaymentsSurface;
  const heading = document.getElementById('heading');
  const summary = document.getElementById('summary');
  const permissionCount = document.getElementById('permission-count');
  const paymentCount = document.getElementById('payment-count');
  const permissionsEl = document.getElementById('permissions');
  const paymentsEl = document.getElementById('payments');
  const refreshBtn = document.getElementById('refresh');
  const closeBtn = document.getElementById('close');
  const clearHistoryBtn = document.getElementById('clear-history');
  const errorEl = document.getElementById('error');

  let snapshot = null;

  function setError(message) {
    errorEl.textContent = message || '';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }

  function formatPermissionMeta(permission) {
    const spent = permission.spentAmount || '0';
    const cap = permission.capAmount || '0';
    const expires = permission.expiresAt
      ? new Date(permission.expiresAt * 1000).toLocaleString()
      : 'unknown';
    return `chain ${permission.chainId} | ${permission.asset} | spent ${spent} of ${cap} | expires ${expires}`;
  }

  function permissionKey(permission) {
    return `${permission.origin}\n${permission.chainId}\n${permission.asset}`;
  }

  function parsePermissionKey(key) {
    const [origin, chainId, asset] = String(key || '').split('\n');
    return { origin, chainId: Number(chainId), asset };
  }

  function renderPermissions() {
    const permissions = Array.isArray(snapshot?.permissions) ? snapshot.permissions : [];
    permissionCount.textContent = String(permissions.length);
    if (permissions.length === 0) {
      permissionsEl.innerHTML = '<div class="empty">No active x402 caps.</div>';
      return;
    }

    permissionsEl.innerHTML = permissions.map((permission) => `
      <div class="permission" data-key="${escapeHtml(permissionKey(permission))}">
        <div class="row-main">
          <div>
            <div class="origin">${escapeHtml(permission.origin)}</div>
            <div class="meta">${escapeHtml(formatPermissionMeta(permission))}</div>
          </div>
          <button class="danger revoke-origin" type="button">Revoke site</button>
        </div>
        <div class="permission-controls">
          <label>
            Cap amount
            <input class="cap-amount" inputmode="numeric" value="${escapeHtml(permission.capAmount || '')}">
          </label>
          <label>
            Window days
            <input class="window-days" inputmode="numeric" value="30">
          </label>
          <button class="primary update-permission" type="button">Update</button>
          <button class="danger revoke-permission" type="button">Revoke</button>
        </div>
      </div>
    `).join('');
  }

  function renderPayments() {
    const payments = Array.isArray(snapshot?.payments) ? snapshot.payments : [];
    paymentCount.textContent = String(snapshot?.paymentCount ?? payments.length);
    clearHistoryBtn.disabled = payments.length === 0;
    if (payments.length === 0) {
      paymentsEl.innerHTML = '<div class="empty">No payment history.</div>';
      return;
    }

    paymentsEl.innerHTML = payments.map((payment) => `
      <div class="payment">
        <div class="payment-grid">
          <div class="muted">${escapeHtml(formatDate(payment.createdAt))}</div>
          <div>
            <div class="origin">${escapeHtml(payment.origin || payment.url || payment.toAddress || 'Shell payment')}</div>
            <div class="meta">${escapeHtml(payment.amount || '0')} ${escapeHtml(payment.asset || 'native')} on chain ${escapeHtml(payment.chainId || '')}</div>
            <div class="meta">${escapeHtml(payment.txHash || 'no transaction hash')}</div>
          </div>
          <div class="status">
            <span class="badge">${escapeHtml(payment.kind || 'payment')}</span>
            <div class="meta">${escapeHtml(payment.status || '')}</div>
          </div>
        </div>
      </div>
    `).join('');
  }

  function render() {
    renderPermissions();
    renderPayments();
  }

  async function loadSnapshot() {
    if (!api || typeof api.getSnapshot !== 'function') {
      setError('Trusted payments surface is unavailable.');
      return;
    }
    const result = await api.getSnapshot();
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Failed to load payments.');
      return;
    }
    snapshot = result.snapshot || {};
    setError('');
    render();
  }

  async function loadContext() {
    if (!api || typeof api.getContext !== 'function') {
      setError('Trusted payments surface is unavailable.');
      return;
    }
    const result = await api.getContext();
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Trusted payments surface is unavailable.');
      return;
    }
    const context = result.context || {};
    heading.textContent = context.heading || 'Payment Permissions';
    summary.textContent = context.trusted
      ? 'Shell-owned payment review and cap management'
      : 'Payment review';
  }

  async function updatePermission(node) {
    const target = parsePermissionKey(node.dataset.key);
    const capAmount = node.querySelector('.cap-amount')?.value?.trim();
    const windowDays = Number(node.querySelector('.window-days')?.value || 0);
    const result = await api.updatePermission({
      ...target,
      capAmount,
      windowSeconds: Math.round(windowDays * 24 * 60 * 60),
    });
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Failed to update cap.');
      return;
    }
    snapshot = result.snapshot || snapshot;
    setError('');
    render();
  }

  async function revokePermission(node) {
    const result = await api.revokePermission(parsePermissionKey(node.dataset.key));
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Failed to revoke cap.');
      return;
    }
    snapshot = result.snapshot || snapshot;
    setError('');
    render();
  }

  async function revokeAllForOrigin(node) {
    const target = parsePermissionKey(node.dataset.key);
    const result = await api.revokeAllForOrigin({ origin: target.origin });
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Failed to revoke site caps.');
      return;
    }
    snapshot = result.snapshot || snapshot;
    setError('');
    render();
  }

  permissionsEl.addEventListener('click', (event) => {
    const permission = event.target.closest('.permission');
    if (!permission) return;
    if (event.target.closest('.update-permission')) {
      updatePermission(permission).catch((err) => setError(err?.message || 'Failed to update cap.'));
    } else if (event.target.closest('.revoke-permission')) {
      revokePermission(permission).catch((err) => setError(err?.message || 'Failed to revoke cap.'));
    } else if (event.target.closest('.revoke-origin')) {
      revokeAllForOrigin(permission).catch((err) => setError(err?.message || 'Failed to revoke site caps.'));
    }
  });

  refreshBtn.addEventListener('click', () => {
    loadSnapshot().catch((err) => setError(err?.message || 'Refresh failed.'));
  });

  closeBtn.addEventListener('click', () => {
    api.close();
  });

  clearHistoryBtn.addEventListener('click', async () => {
    const result = await api.clearHistory();
    if (!result || result.ok !== true) {
      setError(result?.error?.message || 'Failed to clear payment history.');
      return;
    }
    snapshot = result.snapshot || snapshot;
    setError('');
    render();
  });

  api?.onSnapshotUpdated?.((payload) => {
    if (payload?.ok === true && payload.snapshot) {
      snapshot = payload.snapshot;
      render();
    }
  });

  Promise.all([loadContext(), loadSnapshot()]).catch((err) => {
    setError(err?.message || 'Trusted payments surface failed.');
  });
}());
