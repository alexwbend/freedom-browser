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
  BROWSER_STATE_SETTINGS_GET: 'browserState.settings.get',
  BROWSER_STATE_BOOKMARKS_GET: 'browserState.bookmarks.get',
  BROWSER_STATE_BOOKMARKS_ADD: 'browserState.bookmarks.add',
  BROWSER_STATE_BOOKMARKS_UPDATE: 'browserState.bookmarks.update',
  BROWSER_STATE_BOOKMARKS_REMOVE: 'browserState.bookmarks.remove',
  BROWSER_STATE_HISTORY_GET: 'browserState.history.get',
  BROWSER_STATE_HISTORY_ADD: 'browserState.history.add',
  BROWSER_STATE_FAVICONS_GET_CACHED: 'browserState.favicons.getCached',
  SURFACES_GET_STATE: 'surfaces.getState',
  SURFACES_OPEN: 'surfaces.open',
  SURFACES_CLOSE: 'surfaces.close',
  SURFACES_TOGGLE: 'surfaces.toggle',
  TRUSTED_PROMPTS_REQUEST_TEST: 'trustedPrompts.requestTest',
  APP_SHOW_ABOUT: 'app.showAbout',
  APP_CHECK_FOR_UPDATES: 'app.checkForUpdates',
  APP_RESTART_AND_INSTALL_UPDATE: 'app.restartAndInstallUpdate',
  WINDOWS_NEW: 'windows.new',
  WINDOWS_OPEN_URL: 'windows.openUrl',
  WINDOWS_SET_TITLE: 'windows.setTitle',
  WINDOWS_CLOSE: 'windows.close',
  WINDOWS_MINIMIZE: 'windows.minimize',
  WINDOWS_TOGGLE_MAXIMIZE: 'windows.toggleMaximize',
  WINDOWS_TOGGLE_FULLSCREEN: 'windows.toggleFullscreen',
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
  getSettings: () => invokeShell(SHELL_API_METHODS.BROWSER_STATE_SETTINGS_GET),
  getBookmarks: () => invokeShell(SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_GET),
  addBookmark: (bookmark) => invokeShell(SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_ADD, bookmark),
  updateBookmark: (originalTarget, bookmark) =>
    invokeShell(SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_UPDATE, {
      originalTarget,
      bookmark,
    }),
  removeBookmark: (target) =>
    invokeShell(SHELL_API_METHODS.BROWSER_STATE_BOOKMARKS_REMOVE, { target }),
  getHistory: (options = {}) => invokeShell(SHELL_API_METHODS.BROWSER_STATE_HISTORY_GET, options),
  addHistory: (entry) => invokeShell(SHELL_API_METHODS.BROWSER_STATE_HISTORY_ADD, entry),
  getCachedFavicon: (url) =>
    invokeShell(SHELL_API_METHODS.BROWSER_STATE_FAVICONS_GET_CACHED, url),
  getSurfaceState: (surface) => invokeShell(SHELL_API_METHODS.SURFACES_GET_STATE, { surface }),
  openSurface: (surface) => invokeShell(SHELL_API_METHODS.SURFACES_OPEN, { surface }),
  closeSurface: (surface) => invokeShell(SHELL_API_METHODS.SURFACES_CLOSE, { surface }),
  toggleSurface: (surface) => invokeShell(SHELL_API_METHODS.SURFACES_TOGGLE, { surface }),
  requestTestTrustedPrompt: (payload) =>
    invokeShell(SHELL_API_METHODS.TRUSTED_PROMPTS_REQUEST_TEST, payload),
  setWindowTitle: (title) => invokeShell(SHELL_API_METHODS.WINDOWS_SET_TITLE, title),
  closeWindow: () => invokeShell(SHELL_API_METHODS.WINDOWS_CLOSE),
  minimizeWindow: () => invokeShell(SHELL_API_METHODS.WINDOWS_MINIMIZE),
  maximizeWindow: () => invokeShell(SHELL_API_METHODS.WINDOWS_TOGGLE_MAXIMIZE),
  toggleFullscreen: () => invokeShell(SHELL_API_METHODS.WINDOWS_TOGGLE_FULLSCREEN),
  newWindow: () => invokeShell(SHELL_API_METHODS.WINDOWS_NEW),
  openUrlInNewWindow: (url) => invokeShell(SHELL_API_METHODS.WINDOWS_OPEN_URL, url),
  showAbout: () => invokeShell(SHELL_API_METHODS.APP_SHOW_ABOUT),
  checkForUpdates: () => invokeShell(SHELL_API_METHODS.APP_CHECK_FOR_UPDATES),
  restartAndInstallUpdate: () => invokeShell(SHELL_API_METHODS.APP_RESTART_AND_INSTALL_UPDATE),
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
