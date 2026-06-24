const { contextBridge, ipcRenderer } = require('electron');

function getRequestId() {
  try {
    return new URL(window.location.href).searchParams.get('requestId') || '';
  } catch {
    return '';
  }
}

function channelFor(kind) {
  return `trusted-wallet-approval:${kind}:${getRequestId()}`;
}

contextBridge.exposeInMainWorld('trustedWalletApproval', {
  getContext: () => ipcRenderer.invoke(channelFor('context')),
  accept: (payload = {}) => ipcRenderer.invoke(channelFor('decision'), {
    action: 'accept',
    selectedWalletIndex: payload?.selectedWalletIndex,
  }),
  reject: () => ipcRenderer.invoke(channelFor('decision'), { action: 'reject' }),
});
