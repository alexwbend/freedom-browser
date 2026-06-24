(function initTrustedIdentitySurface() {
  const api = window.trustedIdentitySurface;
  const byId = (id) => document.getElementById(id);

  const heading = byId('heading');
  const summary = byId('summary');
  const closeButton = byId('close');
  const vaultState = byId('vault-state');
  const lockState = byId('lock-state');
  const walletAddress = byId('wallet-address');
  const antState = byId('ant-state');
  const passwordState = byId('password-state');
  const quickUnlockState = byId('quick-unlock-state');
  const createSection = byId('create-section');
  const importSection = byId('import-section');
  const unlockSection = byId('unlock-section');
  const changePasswordSection = byId('change-password-section');
  const quickUnlockSection = byId('quick-unlock-section');
  const deleteVaultSection = byId('delete-vault-section');
  const createForm = byId('create-form');
  const importForm = byId('import-form');
  const unlockForm = byId('unlock-form');
  const changePasswordForm = byId('change-password-form');
  const quickUnlockForm = byId('quick-unlock-form');
  const deleteVaultForm = byId('delete-vault-form');
  const lockButton = byId('lock-submit');
  const quickUnlockEnable = byId('quick-unlock-enable');
  const quickUnlockDisable = byId('quick-unlock-disable');

  function setText(id, text = '') {
    const el = byId(id);
    if (el) {
      el.textContent = text;
    }
  }

  function setBusy(form, busy) {
    form?.querySelectorAll('button, input, textarea, select').forEach((el) => {
      el.disabled = busy;
    });
  }

  function passwordsMatch(password, confirm) {
    if (!password || password.length < 8) {
      return 'Enter a password with at least 8 characters.';
    }
    if (password !== confirm) {
      return 'Passwords do not match.';
    }
    return null;
  }

  function describeQuickUnlock(quickUnlock = {}) {
    if (quickUnlock.error) {
      return 'Unavailable';
    }
    if (!quickUnlock.canUseTouchId) {
      return 'Not available';
    }
    return quickUnlock.enabled ? 'Enabled' : 'Disabled';
  }

  function clearVaultManagementMessages() {
    for (const id of [
      'change-password-error',
      'change-password-success',
      'quick-unlock-error',
      'quick-unlock-success',
      'delete-vault-error',
      'delete-vault-success',
    ]) {
      setText(id);
    }
  }

  function renderSnapshot(snapshot = {}) {
    const hasVault = snapshot.hasVault === true;
    const unlocked = snapshot.isUnlocked === true;
    const status = snapshot.status || {};
    const addresses = snapshot.vaultMeta?.addresses || {};
    const quickUnlock = snapshot.quickUnlock || {};
    const userKnowsPassword = snapshot.vaultMeta?.userKnowsPassword !== false;
    const canManagePassword = hasVault && userKnowsPassword;
    const canUseQuickUnlock =
      hasVault &&
      userKnowsPassword &&
      quickUnlock.canUseTouchId === true &&
      quickUnlock.secureStorageAvailable === true;

    vaultState.textContent = hasVault ? 'Created' : 'Not created';
    lockState.textContent = hasVault ? (unlocked ? 'Unlocked' : 'Locked') : 'Unavailable';
    walletAddress.textContent = addresses.userWallet || 'Not available';
    antState.textContent = status.beeInjected ? 'Injected' : 'Not injected';
    passwordState.textContent = hasVault
      ? (userKnowsPassword ? 'User-defined' : 'Touch ID only')
      : 'Unavailable';
    quickUnlockState.textContent = hasVault ? describeQuickUnlock(quickUnlock) : 'Unavailable';

    createSection.classList.toggle('hidden', hasVault);
    importSection.classList.toggle('hidden', hasVault);
    unlockSection.classList.toggle('hidden', !hasVault);
    changePasswordSection.classList.toggle('hidden', !hasVault);
    quickUnlockSection.classList.toggle('hidden', !hasVault);
    deleteVaultSection.classList.toggle('hidden', !hasVault);
    byId('unlock-submit').disabled = !hasVault || unlocked;
    lockButton.disabled = !hasVault || !unlocked;
    byId('change-password-submit').disabled = !canManagePassword;
    byId('delete-vault-submit').disabled = !canManagePassword;
    quickUnlockEnable.disabled = !canUseQuickUnlock || quickUnlock.enabled === true;
    quickUnlockDisable.disabled = quickUnlock.enabled !== true;
    setText(
      'change-password-note',
      canManagePassword
        ? 'Changing the password disables quick unlock until it is enabled again.'
        : 'Password management is unavailable for Touch ID-only vaults.'
    );
    setText(
      'quick-unlock-note',
      canUseQuickUnlock
        ? 'Quick unlock stores the current password in OS secure storage.'
        : 'Quick unlock is not available for this vault on this system.'
    );

    if (snapshot.identityError) {
      setText('unlock-error', snapshot.identityError);
    }
  }

  async function refresh() {
    const result = await api.getSnapshot();
    if (result?.ok !== true) {
      setText('unlock-error', result?.error?.message || 'Identity surface is unavailable.');
      return;
    }
    renderSnapshot(result.snapshot);
  }

  closeButton.addEventListener('click', () => {
    api.close();
  });

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setText('create-error');
    setText('create-success');
    byId('created-mnemonic').classList.add('hidden');
    const password = byId('create-password').value;
    const confirm = byId('create-confirm').value;
    const error = passwordsMatch(password, confirm);
    if (error) {
      setText('create-error', error);
      return;
    }
    setBusy(createForm, true);
    try {
      const result = await api.createVault({
        password,
        strength: Number(byId('create-strength').value),
        userKnowsPassword: true,
      });
      if (result?.ok !== true) {
        setText('create-error', result?.error?.message || 'Failed to create identity.');
        return;
      }
      byId('created-mnemonic').value = result.mnemonic || '';
      byId('created-mnemonic').classList.remove('hidden');
      setText('create-success', 'Identity created. Store the recovery phrase before closing.');
      renderSnapshot(result.snapshot);
    } finally {
      setBusy(createForm, false);
    }
  });

  importForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setText('import-error');
    setText('import-success');
    const password = byId('import-password').value;
    const confirm = byId('import-confirm').value;
    const error = passwordsMatch(password, confirm);
    if (error) {
      setText('import-error', error);
      return;
    }
    setBusy(importForm, true);
    try {
      const result = await api.importMnemonic({
        password,
        mnemonic: byId('import-mnemonic').value,
        userKnowsPassword: true,
      });
      if (result?.ok !== true) {
        setText('import-error', result?.error?.message || 'Failed to import identity.');
        return;
      }
      setText('import-success', 'Identity imported.');
      renderSnapshot(result.snapshot);
    } finally {
      setBusy(importForm, false);
    }
  });

  unlockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setText('unlock-error');
    setText('unlock-success');
    setBusy(unlockForm, true);
    try {
      const result = await api.unlock({ password: byId('unlock-password').value });
      if (result?.ok !== true) {
        setText('unlock-error', result?.error?.message || 'Failed to unlock vault.');
        return;
      }
      byId('unlock-password').value = '';
      setText('unlock-success', 'Vault unlocked.');
      renderSnapshot(result.snapshot);
    } finally {
      setBusy(unlockForm, false);
    }
  });

  changePasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearVaultManagementMessages();
    const currentPassword = byId('change-current-password').value;
    const newPassword = byId('change-new-password').value;
    const confirm = byId('change-confirm-password').value;
    const error = passwordsMatch(newPassword, confirm);
    if (error) {
      setText('change-password-error', error);
      return;
    }
    setBusy(changePasswordForm, true);
    try {
      const result = await api.changePassword({ currentPassword, newPassword });
      if (result?.ok !== true) {
        setText(
          'change-password-error',
          result?.error?.message || 'Failed to change password.'
        );
        return;
      }
      byId('change-current-password').value = '';
      byId('change-new-password').value = '';
      byId('change-confirm-password').value = '';
      setText('change-password-success', 'Password changed.');
      renderSnapshot(result.snapshot);
    } finally {
      setBusy(changePasswordForm, false);
    }
  });

  quickUnlockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearVaultManagementMessages();
    setBusy(quickUnlockForm, true);
    try {
      const result = await api.enableQuickUnlock({
        password: byId('quick-unlock-password').value,
      });
      if (result?.ok !== true) {
        setText(
          'quick-unlock-error',
          result?.error?.message || 'Failed to enable quick unlock.'
        );
        return;
      }
      byId('quick-unlock-password').value = '';
      setText('quick-unlock-success', 'Quick unlock enabled.');
      renderSnapshot(result.snapshot);
    } finally {
      setBusy(quickUnlockForm, false);
    }
  });

  quickUnlockDisable.addEventListener('click', async () => {
    clearVaultManagementMessages();
    const result = await api.disableQuickUnlock();
    if (result?.ok !== true) {
      setText(
        'quick-unlock-error',
        result?.error?.message || 'Failed to disable quick unlock.'
      );
      return;
    }
    setText('quick-unlock-success', 'Quick unlock disabled.');
    renderSnapshot(result.snapshot);
  });

  deleteVaultForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearVaultManagementMessages();
    if (byId('delete-vault-confirm').value.trim() !== 'DELETE') {
      setText('delete-vault-error', 'Type DELETE to confirm vault deletion.');
      return;
    }
    setBusy(deleteVaultForm, true);
    try {
      const result = await api.deleteVault({
        password: byId('delete-vault-password').value,
        confirmation: byId('delete-vault-confirm').value,
      });
      if (result?.ok !== true) {
        setText('delete-vault-error', result?.error?.message || 'Failed to delete vault.');
        return;
      }
      byId('delete-vault-password').value = '';
      byId('delete-vault-confirm').value = '';
      setText('delete-vault-success', 'Vault deleted.');
      renderSnapshot(result.snapshot);
    } finally {
      setBusy(deleteVaultForm, false);
    }
  });

  lockButton.addEventListener('click', async () => {
    setText('unlock-error');
    setText('unlock-success');
    const result = await api.lock();
    if (result?.ok !== true) {
      setText('unlock-error', result?.error?.message || 'Failed to lock vault.');
      return;
    }
    setText('unlock-success', 'Vault locked.');
    renderSnapshot(result.snapshot);
  });

  api.onSnapshotUpdated((payload) => {
    if (payload?.ok === true) {
      renderSnapshot(payload.snapshot);
    }
  });

  api.getContext()
    .then((result) => {
      if (result?.ok === true) {
        heading.textContent = result.context?.heading || 'Identity And Vault';
        summary.textContent = 'Create, import, and unlock your recovery phrase vault.';
      }
      return refresh();
    })
    .catch((err) => {
      setText('unlock-error', err?.message || 'Identity surface failed.');
    });
}());
