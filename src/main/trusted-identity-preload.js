const { contextBridge, ipcRenderer } = require('electron');

function getSurfaceId() {
  try {
    return new URL(window.location.href).searchParams.get('surfaceId') || '';
  } catch {
    return '';
  }
}

function channelFor(kind) {
  return `trusted-identity-surface:${kind}:${getSurfaceId()}`;
}

contextBridge.exposeInMainWorld('trustedIdentitySurface', {
  getContext: () => ipcRenderer.invoke(channelFor('context')),
  getSnapshot: () => ipcRenderer.invoke(channelFor('snapshot')),
  createVault: (payload) => ipcRenderer.invoke(channelFor('create-vault'), payload || {}),
  importMnemonic: (payload) => ipcRenderer.invoke(channelFor('import-mnemonic'), payload || {}),
  unlock: (payload) => ipcRenderer.invoke(channelFor('unlock'), payload || {}),
  lock: () => ipcRenderer.invoke(channelFor('lock')),
  changePassword: (payload) => ipcRenderer.invoke(channelFor('change-password'), payload || {}),
  deleteVault: (payload) => ipcRenderer.invoke(channelFor('delete-vault'), payload || {}),
  enableQuickUnlock: (payload) => ipcRenderer.invoke(channelFor('enable-quick-unlock'), payload || {}),
  disableQuickUnlock: () => ipcRenderer.invoke(channelFor('disable-quick-unlock')),
  close: () => ipcRenderer.invoke(channelFor('close')),
  onSnapshotUpdated: (callback) => {
    const channel = channelFor('snapshot-updated');
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
