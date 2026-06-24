const { contextBridge, ipcRenderer } = require('electron');

function getSurfaceId() {
  try {
    return new URL(window.location.href).searchParams.get('surfaceId') || '';
  } catch {
    return '';
  }
}

function channelFor(kind) {
  return `trusted-payments-surface:${kind}:${getSurfaceId()}`;
}

contextBridge.exposeInMainWorld('trustedPaymentsSurface', {
  getContext: () => ipcRenderer.invoke(channelFor('context')),
  getSnapshot: () => ipcRenderer.invoke(channelFor('snapshot')),
  updatePermission: (payload) => ipcRenderer.invoke(channelFor('update-permission'), payload || {}),
  revokePermission: (payload) => ipcRenderer.invoke(channelFor('revoke-permission'), payload || {}),
  revokeAllForOrigin: (payload) =>
    ipcRenderer.invoke(channelFor('revoke-all-for-origin'), payload || {}),
  clearHistory: () => ipcRenderer.invoke(channelFor('clear-history')),
  close: () => ipcRenderer.invoke(channelFor('close')),
  onSnapshotUpdated: (callback) => {
    const channel = channelFor('snapshot-updated');
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
