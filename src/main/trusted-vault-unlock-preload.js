const { contextBridge, ipcRenderer } = require('electron');

function getRequestId() {
  try {
    return new URL(window.location.href).searchParams.get('requestId') || '';
  } catch {
    return '';
  }
}

function channelFor(kind) {
  return `trusted-vault-unlock:${kind}:${getRequestId()}`;
}

contextBridge.exposeInMainWorld('trustedVaultUnlock', {
  getContext: () => ipcRenderer.invoke(channelFor('context')),
  submit: (password) => ipcRenderer.invoke(channelFor('submit'), String(password || '')),
  cancel: () => ipcRenderer.invoke(channelFor('cancel')),
});
