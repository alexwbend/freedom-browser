const { contextBridge, ipcRenderer } = require('electron');

// Keep these in sync with src/shared/ipc-channels.js and
// src/shared/shell-api-policy.js. Runtime Electron preloads do not reliably
// support relative requires, so unit tests enforce parity with the shared
// contract instead.
const SHELL_REQUEST = 'shell:request';
const SHELL_API_METHODS = Object.freeze({
  GET_INFO: 'getInfo',
  MARK_READY: 'markReady',
  RESOLVE_NAVIGATION_INPUT: 'resolveNavigationInput',
  TABS_GET_SNAPSHOT: 'tabs.getSnapshot',
  TABS_CREATE: 'tabs.create',
  TABS_CLOSE: 'tabs.close',
  TABS_ACTIVATE: 'tabs.activate',
  TABS_NAVIGATE: 'tabs.navigate',
  TABS_RELOAD: 'tabs.reload',
  TABS_GO_HOME: 'tabs.goHome',
});

const invokeShell = (method, ...args) => ipcRenderer.invoke(SHELL_REQUEST, { method, args });

const freedomShell = Object.freeze({
  getInfo: () => invokeShell(SHELL_API_METHODS.GET_INFO),
  markReady: () => invokeShell(SHELL_API_METHODS.MARK_READY),
  resolveNavigationInput: (input) => invokeShell(SHELL_API_METHODS.RESOLVE_NAVIGATION_INPUT, input),
  getTabSnapshot: () => invokeShell(SHELL_API_METHODS.TABS_GET_SNAPSHOT),
  createTab: (options = {}) => invokeShell(SHELL_API_METHODS.TABS_CREATE, options),
  closeTab: (tabId) => invokeShell(SHELL_API_METHODS.TABS_CLOSE, { tabId }),
  activateTab: (tabId) => invokeShell(SHELL_API_METHODS.TABS_ACTIVATE, { tabId }),
  navigateTab: (tabId, url) => invokeShell(SHELL_API_METHODS.TABS_NAVIGATE, { tabId, url }),
  reloadTab: (tabId) => invokeShell(SHELL_API_METHODS.TABS_RELOAD, { tabId }),
  goHome: (tabId) => invokeShell(SHELL_API_METHODS.TABS_GO_HOME, { tabId }),
});

contextBridge.exposeInMainWorld('freedomShell', freedomShell);

module.exports = {
  SHELL_API_METHODS,
  SHELL_REQUEST,
};
