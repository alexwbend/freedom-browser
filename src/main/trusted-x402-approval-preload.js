const { contextBridge, ipcRenderer } = require('electron');

function getRequestId() {
  try {
    return new URL(window.location.href).searchParams.get('requestId') || '';
  } catch {
    return '';
  }
}

function channelFor(kind) {
  return `trusted-x402-approval:${kind}:${getRequestId()}`;
}

contextBridge.exposeInMainWorld('trustedX402Approval', {
  getContext: () => ipcRenderer.invoke(channelFor('context')),
  payOnce: () => ipcRenderer.invoke(channelFor('decision'), { action: 'pay-once' }),
  payAndAllow: () => ipcRenderer.invoke(channelFor('decision'), { action: 'allow' }),
  reject: () => ipcRenderer.invoke(channelFor('decision'), { action: 'reject' }),
});
