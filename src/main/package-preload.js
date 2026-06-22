const { contextBridge, ipcRenderer } = require('electron');

// Keep this in sync with src/shared/ipc-channels.js. Relative requires from
// sandboxed preloads are intentionally avoided, matching src/main/preload.js.
const SHELL_REQUEST = 'shell:request';

const invokeShell = (method, ...args) => ipcRenderer.invoke(SHELL_REQUEST, { method, args });

const freedomShell = Object.freeze({
  getInfo: () => invokeShell('getInfo'),
  markReady: () => invokeShell('markReady'),
  resolveNavigationInput: (input) => invokeShell('resolveNavigationInput', input),
});

contextBridge.exposeInMainWorld('freedomShell', freedomShell);
