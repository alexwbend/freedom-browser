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
  close: () => ipcRenderer.invoke(channelFor('close')),
  onSnapshotUpdated: (callback) => {
    const channel = channelFor('snapshot-updated');
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
