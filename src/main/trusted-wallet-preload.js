const { contextBridge, ipcRenderer } = require('electron');

function getSurfaceId() {
  try {
    return new URL(window.location.href).searchParams.get('surfaceId') || '';
  } catch {
    return '';
  }
}

function channelFor(kind) {
  return `trusted-wallet-surface:${kind}:${getSurfaceId()}`;
}

contextBridge.exposeInMainWorld('trustedWalletSurface', {
  getContext: () => ipcRenderer.invoke(channelFor('context')),
  getSnapshot: () => ipcRenderer.invoke(channelFor('snapshot')),
  revokePermission: (payload) => ipcRenderer.invoke(channelFor('revoke-permission'), payload || {}),
  setActiveWallet: (payload) => ipcRenderer.invoke(channelFor('set-active-wallet'), payload || {}),
  createWallet: (payload) => ipcRenderer.invoke(channelFor('create-wallet'), payload || {}),
  renameWallet: (payload) => ipcRenderer.invoke(channelFor('rename-wallet'), payload || {}),
  deleteWallet: (payload) => ipcRenderer.invoke(channelFor('delete-wallet'), payload || {}),
  exportMnemonic: (payload) => ipcRenderer.invoke(channelFor('export-mnemonic'), payload || {}),
  exportPrivateKey: (payload) => ipcRenderer.invoke(channelFor('export-private-key'), payload || {}),
  setLayoutMode: (payload) => ipcRenderer.invoke(channelFor('set-layout-mode'), payload || {}),
  close: () => ipcRenderer.invoke(channelFor('close')),
  onSnapshotUpdated: (callback) => {
    const channel = channelFor('snapshot-updated');
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onThemeUpdated: (callback) => {
    const channel = channelFor('theme-updated');
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onLayoutUpdated: (callback) => {
    const channel = channelFor('layout-updated');
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
