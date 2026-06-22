const { contextBridge, ipcRenderer } = require('electron');

// Keep these in sync with src/shared/ipc-channels.js and
// src/shared/shell-api-policy.js. Runtime Electron preloads do not reliably
// support relative requires, so unit tests enforce parity with the shared
// contract instead.
const SHELL_REQUEST = 'shell:request';
const SHELL_EVENT = 'shell:event';
const SHELL_API_METHODS = Object.freeze({
  GET_INFO: 'getInfo',
  MARK_READY: 'markReady',
  RESOLVE_NAVIGATION_INPUT: 'resolveNavigationInput',
  RESOLVE_ENS: 'navigation.resolveEns',
  INVALIDATE_ENS_CONTENT: 'navigation.invalidateEnsContent',
  TABS_GET_SNAPSHOT: 'tabs.getSnapshot',
  TABS_CREATE: 'tabs.create',
  TABS_CLOSE: 'tabs.close',
  TABS_ACTIVATE: 'tabs.activate',
  TABS_NAVIGATE: 'tabs.navigate',
  TABS_RELOAD: 'tabs.reload',
  TABS_GO_HOME: 'tabs.goHome',
});
const SHELL_API_EVENTS = Object.freeze({
  TABS_COMMAND_RESULT: 'tabs.commandResult',
  TABS_SNAPSHOT_CHANGED: 'tabs.snapshotChanged',
});

const invokeShell = (method, ...args) => ipcRenderer.invoke(SHELL_REQUEST, { method, args });
const onShellEvent = (eventName, callback) => {
  const handler = (_event, payload = {}) => {
    if (payload?.event === eventName) {
      callback(payload.data);
    }
  };
  ipcRenderer.on(SHELL_EVENT, handler);
  return () => ipcRenderer.removeListener(SHELL_EVENT, handler);
};

const freedomShell = Object.freeze({
  getInfo: () => invokeShell(SHELL_API_METHODS.GET_INFO),
  markReady: () => invokeShell(SHELL_API_METHODS.MARK_READY),
  resolveNavigationInput: (input) => invokeShell(SHELL_API_METHODS.RESOLVE_NAVIGATION_INPUT, input),
  resolveEns: (name) => invokeShell(SHELL_API_METHODS.RESOLVE_ENS, name),
  invalidateEnsContent: (name) => invokeShell(SHELL_API_METHODS.INVALIDATE_ENS_CONTENT, name),
  getTabSnapshot: () => invokeShell(SHELL_API_METHODS.TABS_GET_SNAPSHOT),
  createTab: (options = {}) => invokeShell(SHELL_API_METHODS.TABS_CREATE, options),
  closeTab: (tabId) => invokeShell(SHELL_API_METHODS.TABS_CLOSE, { tabId }),
  activateTab: (tabId) => invokeShell(SHELL_API_METHODS.TABS_ACTIVATE, { tabId }),
  navigateTab: (tabId, url) => invokeShell(SHELL_API_METHODS.TABS_NAVIGATE, { tabId, url }),
  reloadTab: (tabId) => invokeShell(SHELL_API_METHODS.TABS_RELOAD, { tabId }),
  goHome: (tabId) => invokeShell(SHELL_API_METHODS.TABS_GO_HOME, { tabId }),
  onTabCommandResult: (callback) => onShellEvent(SHELL_API_EVENTS.TABS_COMMAND_RESULT, callback),
  onTabSnapshotChanged: (callback) =>
    onShellEvent(SHELL_API_EVENTS.TABS_SNAPSHOT_CHANGED, callback),
});

contextBridge.exposeInMainWorld('freedomShell', freedomShell);

module.exports = {
  SHELL_API_EVENTS,
  SHELL_EVENT,
  SHELL_API_METHODS,
  SHELL_REQUEST,
};
