(function initTrustedWalletSurface() {
  const api = window.trustedWalletSurface;
  const heading = document.getElementById('heading');
  const packageLabel = document.getElementById('package-label');
  const walletList = document.getElementById('wallet-list');
  const permissionList = document.getElementById('permission-list');
  const walletEmpty = document.getElementById('wallet-empty');
  const permissionEmpty = document.getElementById('permission-empty');
  const error = document.getElementById('error');
  const close = document.getElementById('close');

  function setError(message) {
    error.textContent = message || '';
    error.hidden = !message;
  }

  function formatDate(value) {
    if (!Number.isFinite(value)) {
      return 'Never';
    }
    try {
      return new Date(value).toLocaleString();
    } catch {
      return 'Unknown';
    }
  }

  function formatAddress(address) {
    if (typeof address !== 'string' || address.length < 12) {
      return address || 'Unavailable';
    }
    return `${address.slice(0, 8)}...${address.slice(-6)}`;
  }

  function clearChildren(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function renderWallets(snapshot) {
    clearChildren(walletList);
    const wallets = Array.isArray(snapshot.wallets) ? snapshot.wallets : [];
    walletEmpty.hidden = wallets.length > 0;
    wallets.forEach((wallet) => {
      const row = document.createElement('li');
      row.className = 'item-row';
      if (wallet.index === snapshot.activeWalletIndex) {
        row.classList.add('active');
      }

      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = wallet.name || `Wallet ${wallet.index}`;

      const meta = document.createElement('div');
      meta.className = 'item-meta mono';
      meta.textContent = formatAddress(wallet.address);

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = wallet.index === snapshot.activeWalletIndex ? 'Active' : `#${wallet.index}`;

      const content = document.createElement('div');
      content.append(title, meta);
      row.append(content, badge);
      walletList.append(row);
    });
  }

  function renderPermissions(snapshot) {
    clearChildren(permissionList);
    const permissions = Array.isArray(snapshot.permissions) ? snapshot.permissions : [];
    permissionEmpty.hidden = permissions.length > 0;
    permissions.forEach((permission) => {
      const row = document.createElement('li');
      row.className = 'item-row permission-row';

      const title = document.createElement('div');
      title.className = 'item-title';
      title.textContent = permission.origin || 'Unknown origin';

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      const lastUsed = formatDate(permission.lastUsed);
      meta.textContent =
        `Wallet ${permission.walletIndex ?? '-'} - Chain ${permission.chainId ?? '-'} - Last used ${lastUsed}`;

      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.className = 'secondary-button';
      revoke.textContent = 'Revoke';
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        const result = await api.revokePermission({ origin: permission.origin });
        if (!result || result.ok !== true) {
          setError(result?.error?.message || 'Failed to revoke permission.');
          revoke.disabled = false;
          return;
        }
        setError('');
        renderSnapshot(result.snapshot || snapshot);
      });

      const content = document.createElement('div');
      content.append(title, meta);
      row.append(content, revoke);
      permissionList.append(row);
    });
  }

  function renderSnapshot(snapshot = {}) {
    renderWallets(snapshot);
    renderPermissions(snapshot);
    setError(snapshot.walletError || '');
  }

  async function load() {
    if (!api || typeof api.getContext !== 'function') {
      setError('Wallet surface is unavailable.');
      return;
    }
    const contextResult = await api.getContext();
    if (!contextResult || contextResult.ok !== true) {
      setError(contextResult?.error?.message || 'Wallet surface is unavailable.');
      return;
    }
    const context = contextResult.context || {};
    heading.textContent = context.heading || 'Wallet Accounts';
    packageLabel.textContent = context.caller?.packageId
      ? `Opened by ${context.caller.packageId}`
      : 'Shell-owned trusted surface';

    const snapshotResult = await api.getSnapshot();
    if (!snapshotResult || snapshotResult.ok !== true) {
      setError(snapshotResult?.error?.message || 'Failed to load wallet state.');
      return;
    }
    renderSnapshot(snapshotResult.snapshot);
  }

  close.addEventListener('click', () => {
    api.close();
  });

  if (api && typeof api.onSnapshotUpdated === 'function') {
    api.onSnapshotUpdated((payload) => {
      if (payload?.ok === true) {
        renderSnapshot(payload.snapshot);
      }
    });
  }

  load().catch((err) => {
    setError(err?.message || 'Failed to load wallet surface.');
  });
}());
