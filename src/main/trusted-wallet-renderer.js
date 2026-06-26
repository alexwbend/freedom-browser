(function initTrustedWalletSurface() {
  const api = window.trustedWalletSurface;
  const heading = document.getElementById('heading');
  const sidebarFrame = window.trustedSidebarFrame?.init({
    onClose: () => api?.close?.(),
    onLayoutToggle: (layoutMode) => handleLayoutToggle(layoutMode),
  });
  const walletList = document.getElementById('wallet-list');
  const permissionList = document.getElementById('permission-list');
  const walletEmpty = document.getElementById('wallet-empty');
  const permissionEmpty = document.getElementById('permission-empty');
  const error = document.getElementById('error');
  const close = document.getElementById('close');
  const exportPanel = document.getElementById('export-panel');
  const exportTitle = document.getElementById('export-title');
  const exportAddress = document.getElementById('export-address');
  const exportPassword = document.getElementById('export-password');
  const exportSubmit = document.getElementById('export-submit');
  const exportCancel = document.getElementById('export-cancel');
  const exportError = document.getElementById('export-error');
  const exportResult = document.getElementById('export-result');
  const exportResultLabel = document.getElementById('export-result-label');
  const exportValue = document.getElementById('export-value');
  const exportCopy = document.getElementById('export-copy');
  const exportMnemonicOpen = document.getElementById('export-mnemonic-open');
  const createWalletName = document.getElementById('create-wallet-name');
  const createWalletSubmit = document.getElementById('create-wallet-submit');
  const managementError = document.getElementById('management-error');

  let exportRequest = null;
  let currentSnapshot = {};
  let currentLayoutMode = 'dock';

  function applyTheme(theme) {
    if (sidebarFrame) {
      sidebarFrame.applyTheme(theme);
      return;
    }
    const effective = theme?.effective === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = effective;
    document.documentElement.style.colorScheme = effective;
    document.body.dataset.theme = effective;
  }

  function applySurfaceContext(context = {}) {
    const hasCompositorLayout = context.layoutMode === 'overlay' || context.layoutMode === 'dock';
    currentLayoutMode = context.layoutMode === 'overlay' ? 'overlay' : 'dock';
    if (sidebarFrame) {
      sidebarFrame.setContext({
        ...context,
        title: context.title || 'Freedom Wallet',
        subtitle: '',
        eyebrow: '',
        layoutMode: hasCompositorLayout ? currentLayoutMode : null,
      });
      return;
    }
    applyTheme(context.theme);
    heading.textContent = context.title || 'Freedom Wallet';
  }

  function applyLayoutMode(layoutMode) {
    currentLayoutMode = layoutMode === 'overlay' ? 'overlay' : 'dock';
    sidebarFrame?.setLayoutMode(currentLayoutMode);
  }

  async function handleLayoutToggle(layoutMode) {
    if (!api?.setLayoutMode) {
      return;
    }
    const requestedLayoutMode = layoutMode === 'overlay' ? 'overlay' : 'dock';
    try {
      const result = await api.setLayoutMode({ layoutMode: requestedLayoutMode });
      if (result?.ok === true) {
        applyLayoutMode(result.layoutMode);
        return;
      }
      setManagementError(result?.error?.message || 'Failed to update wallet layout.');
    } catch (err) {
      setManagementError(err?.message || 'Failed to update wallet layout.');
    }
  }

  function setError(message) {
    error.textContent = message || '';
    error.hidden = !message;
  }

  function setExportError(message) {
    exportError.textContent = message || '';
    exportError.hidden = !message;
  }

  function setManagementError(message) {
    managementError.textContent = message || '';
    managementError.hidden = !message;
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

  function renderAndStoreSnapshot(snapshot = {}) {
    currentSnapshot = snapshot;
    renderSnapshot(snapshot);
  }

  async function runWalletManagement(operation, busyButton) {
    setManagementError('');
    if (busyButton) {
      busyButton.disabled = true;
    }
    try {
      const result = await operation();
      if (!result || result.ok !== true) {
        setManagementError(result?.error?.message || 'Wallet management action failed.');
        return null;
      }
      renderAndStoreSnapshot(result.snapshot || currentSnapshot);
      return result;
    } catch (err) {
      setManagementError(err?.message || 'Wallet management action failed.');
      return null;
    } finally {
      if (busyButton) {
        busyButton.disabled = false;
      }
    }
  }

  async function handleCreateWallet() {
    const name = createWalletName.value.trim();
    const result = await runWalletManagement(
      () => api.createWallet({ name }),
      createWalletSubmit
    );
    if (result) {
      createWalletName.value = '';
    }
  }

  async function handleSetActiveWallet(wallet, button) {
    await runWalletManagement(
      () => api.setActiveWallet({ walletIndex: wallet.index }),
      button
    );
  }

  async function handleRenameWallet(wallet, button) {
    const name = window.prompt('Wallet name', wallet.name || `Wallet ${wallet.index}`);
    if (name === null) {
      return;
    }
    await runWalletManagement(
      () => api.renameWallet({ walletIndex: wallet.index, name }),
      button
    );
  }

  async function handleDeleteWallet(wallet, button) {
    if (wallet.index === 0) {
      setManagementError('The main wallet cannot be deleted.');
      return;
    }
    const confirmed = window.confirm(
      `Delete ${wallet.name || `Wallet ${wallet.index}`}? This removes the account from the wallet list but it can be recovered from the vault recovery phrase.`
    );
    if (!confirmed) {
      return;
    }
    await runWalletManagement(
      () => api.deleteWallet({ walletIndex: wallet.index }),
      button
    );
  }

  function resetExportPanel() {
    exportRequest = null;
    exportPanel.hidden = true;
    exportPassword.value = '';
    exportValue.textContent = '';
    exportResultLabel.textContent = 'Private key';
    exportResult.hidden = true;
    exportSubmit.disabled = false;
    exportCopy.textContent = 'Copy';
    setExportError('');
  }

  function openExportPanel(wallet) {
    exportRequest = { kind: 'privateKey', wallet };
    exportTitle.textContent = `Export private key for ${wallet.name || `Wallet ${wallet.index}`}`;
    exportAddress.textContent = wallet.address || 'Address unavailable';
    exportPassword.value = '';
    exportValue.textContent = '';
    exportResultLabel.textContent = 'Private key';
    exportResult.hidden = true;
    exportSubmit.disabled = false;
    exportCopy.textContent = 'Copy';
    setExportError('');
    exportPanel.hidden = false;
    exportPassword.focus();
  }

  function openMnemonicExportPanel() {
    exportRequest = { kind: 'mnemonic' };
    exportTitle.textContent = 'Export recovery phrase';
    exportAddress.textContent = 'This phrase can recover every wallet and node identity in the vault.';
    exportPassword.value = '';
    exportValue.textContent = '';
    exportResultLabel.textContent = 'Recovery phrase';
    exportResult.hidden = true;
    exportSubmit.disabled = false;
    exportCopy.textContent = 'Copy';
    setExportError('');
    exportPanel.hidden = false;
    exportPassword.focus();
  }

  async function handleExportSubmit() {
    if (!exportRequest) {
      return;
    }
    exportSubmit.disabled = true;
    exportResult.hidden = true;
    exportValue.textContent = '';
    setExportError('');
    let result;
    if (exportRequest.kind === 'mnemonic') {
      result = await api.exportMnemonic({
        password: exportPassword.value,
      });
    } else {
      result = await api.exportPrivateKey({
        walletIndex: exportRequest.wallet.index,
        password: exportPassword.value,
      });
    }
    exportSubmit.disabled = false;
    if (!result || result.ok !== true) {
      setExportError(result?.error?.message || 'Failed to export secret.');
      return;
    }
    exportPassword.value = '';
    exportValue.textContent = result.mnemonic || result.privateKey || '';
    exportResult.hidden = false;
  }

  async function handleCopyExportedKey() {
    const value = exportValue.textContent;
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      exportCopy.textContent = 'Copied';
      setTimeout(() => {
        exportCopy.textContent = 'Copy';
      }, 1200);
    } catch {
      setExportError('Copy unavailable; select the key manually.');
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

      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.className = 'secondary-button';
      exportButton.textContent = 'Export key';
      exportButton.addEventListener('click', () => openExportPanel(wallet));

      const activeButton = document.createElement('button');
      activeButton.type = 'button';
      activeButton.className = 'secondary-button';
      activeButton.textContent = wallet.index === snapshot.activeWalletIndex ? 'Active' : 'Set active';
      activeButton.disabled = wallet.index === snapshot.activeWalletIndex;
      activeButton.addEventListener('click', () => {
        handleSetActiveWallet(wallet, activeButton);
      });

      const renameButton = document.createElement('button');
      renameButton.type = 'button';
      renameButton.className = 'secondary-button';
      renameButton.textContent = 'Rename';
      renameButton.addEventListener('click', () => {
        handleRenameWallet(wallet, renameButton);
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'secondary-button';
      deleteButton.textContent = 'Delete';
      deleteButton.disabled = wallet.index === 0;
      deleteButton.addEventListener('click', () => {
        handleDeleteWallet(wallet, deleteButton);
      });

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.append(badge, activeButton, renameButton, deleteButton, exportButton);

      const content = document.createElement('div');
      content.className = 'row-main';
      content.append(title, meta);
      row.append(content, actions);
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
        renderAndStoreSnapshot(result.snapshot || snapshot);
      });

      const content = document.createElement('div');
      content.className = 'row-main';
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
    applySurfaceContext(context);

    const snapshotResult = await api.getSnapshot();
    if (!snapshotResult || snapshotResult.ok !== true) {
      setError(snapshotResult?.error?.message || 'Failed to load wallet state.');
      return;
    }
    renderAndStoreSnapshot(snapshotResult.snapshot);
  }

  if (!sidebarFrame) {
    close.addEventListener('click', () => {
      api.close();
    });
  }
  createWalletSubmit.addEventListener('click', () => {
    handleCreateWallet();
  });
  createWalletName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleCreateWallet();
    }
  });
  exportMnemonicOpen.addEventListener('click', openMnemonicExportPanel);
  exportSubmit.addEventListener('click', () => {
    handleExportSubmit().catch((err) => {
      exportSubmit.disabled = false;
      setExportError(err?.message || 'Failed to export private key.');
    });
  });
  exportPassword.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleExportSubmit().catch((err) => {
        exportSubmit.disabled = false;
        setExportError(err?.message || 'Failed to export private key.');
      });
    }
  });
  exportCancel.addEventListener('click', resetExportPanel);
  exportCopy.addEventListener('click', () => {
    handleCopyExportedKey().catch(() => {
      setExportError('Copy unavailable; select the key manually.');
    });
  });

  if (api && typeof api.onSnapshotUpdated === 'function') {
    api.onSnapshotUpdated((payload) => {
      if (payload?.ok === true) {
        renderAndStoreSnapshot(payload.snapshot);
      }
    });
  }
  if (api && typeof api.onThemeUpdated === 'function') {
    api.onThemeUpdated((payload) => {
      if (payload?.ok === true) {
        applyTheme(payload.theme);
      }
    });
  }
  if (api && typeof api.onLayoutUpdated === 'function') {
    api.onLayoutUpdated((payload) => {
      if (payload?.ok === true) {
        applyLayoutMode(payload.layoutMode);
      }
    });
  }

  load().catch((err) => {
    setError(err?.message || 'Failed to load wallet surface.');
  });
}());
