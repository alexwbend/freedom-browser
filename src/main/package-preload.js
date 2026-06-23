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
  BROWSER_STATE_SETTINGS_SAVE: 'browserState.settings.save',
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
  CHROME_UI_UPDATE_TAB_MENU_STATE: 'chrome.ui.updateTabMenuState',
  CHROME_UI_SET_BOOKMARK_BAR_TOGGLE_ENABLED: 'chrome.ui.setBookmarkBarToggleEnabled',
  CHROME_UI_SET_BOOKMARK_BAR_CHECKED: 'chrome.ui.setBookmarkBarChecked',
});
const SHELL_API_EVENTS = Object.freeze({
  TABS_COMMAND_RESULT: 'tabs.commandResult',
  TABS_SNAPSHOT_CHANGED: 'tabs.snapshotChanged',
  CHROME_CLOSE_MENUS_REQUESTED: 'chrome.commands.closeMenus',
  CHROME_FOCUS_ADDRESS_BAR_REQUESTED: 'chrome.commands.focusAddressBar',
  CHROME_TOGGLE_DEVTOOLS_REQUESTED: 'chrome.commands.toggleDevTools',
  CHROME_CLOSE_DEVTOOLS_REQUESTED: 'chrome.commands.closeDevTools',
  CHROME_CLOSE_ALL_DEVTOOLS_REQUESTED: 'chrome.commands.closeAllDevTools',
  CHROME_NEW_TAB_REQUESTED: 'chrome.commands.newTab',
  CHROME_CLOSE_TAB_REQUESTED: 'chrome.commands.closeTab',
  CHROME_NEW_TAB_WITH_URL_REQUESTED: 'chrome.commands.newTabWithUrl',
  CHROME_NAVIGATE_TO_URL_REQUESTED: 'chrome.commands.navigateToUrl',
  CHROME_LOAD_URL_REQUESTED: 'chrome.commands.loadUrl',
  CHROME_RELOAD_REQUESTED: 'chrome.commands.reload',
  CHROME_HARD_RELOAD_REQUESTED: 'chrome.commands.hardReload',
  CHROME_NEXT_TAB_REQUESTED: 'chrome.commands.nextTab',
  CHROME_PREV_TAB_REQUESTED: 'chrome.commands.prevTab',
  CHROME_MOVE_TAB_LEFT_REQUESTED: 'chrome.commands.moveTabLeft',
  CHROME_MOVE_TAB_RIGHT_REQUESTED: 'chrome.commands.moveTabRight',
  CHROME_REOPEN_CLOSED_TAB_REQUESTED: 'chrome.commands.reopenClosedTab',
  CHROME_TOGGLE_BOOKMARK_BAR_REQUESTED: 'chrome.commands.toggleBookmarkBar',
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
const onShellCommand = (eventName, callback) =>
  onShellEvent(eventName, (data = {}) => callback(data));
const onShellCommandWithUrl = (eventName, callback) =>
  onShellCommand(eventName, ({ url, targetName } = {}) => callback(url, targetName));

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
  saveSettings: (settings) => invokeShell(SHELL_API_METHODS.BROWSER_STATE_SETTINGS_SAVE, settings),
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
  updateTabMenuState: (state) =>
    invokeShell(SHELL_API_METHODS.CHROME_UI_UPDATE_TAB_MENU_STATE, state),
  setBookmarkBarToggleEnabled: (enabled) =>
    invokeShell(SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_TOGGLE_ENABLED, enabled),
  setBookmarkBarChecked: (checked) =>
    invokeShell(SHELL_API_METHODS.CHROME_UI_SET_BOOKMARK_BAR_CHECKED, checked),
  onTabCommandResult: (callback) => onShellEvent(SHELL_API_EVENTS.TABS_COMMAND_RESULT, callback),
  onTabSnapshotChanged: (callback) =>
    onShellEvent(SHELL_API_EVENTS.TABS_SNAPSHOT_CHANGED, callback),
  onCloseMenusRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_CLOSE_MENUS_REQUESTED, callback),
  onFocusAddressBarRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_FOCUS_ADDRESS_BAR_REQUESTED, callback),
  onToggleDevToolsRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_TOGGLE_DEVTOOLS_REQUESTED, callback),
  onCloseDevToolsRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_CLOSE_DEVTOOLS_REQUESTED, callback),
  onCloseAllDevToolsRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_CLOSE_ALL_DEVTOOLS_REQUESTED, callback),
  onNewTabRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_NEW_TAB_REQUESTED, callback),
  onCloseTabRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_CLOSE_TAB_REQUESTED, callback),
  onNewTabWithUrlRequested: (callback) =>
    onShellCommandWithUrl(SHELL_API_EVENTS.CHROME_NEW_TAB_WITH_URL_REQUESTED, callback),
  onNavigateToUrlRequested: (callback) =>
    onShellCommandWithUrl(SHELL_API_EVENTS.CHROME_NAVIGATE_TO_URL_REQUESTED, callback),
  onLoadUrlRequested: (callback) =>
    onShellCommandWithUrl(SHELL_API_EVENTS.CHROME_LOAD_URL_REQUESTED, callback),
  onReloadRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_RELOAD_REQUESTED, callback),
  onHardReloadRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_HARD_RELOAD_REQUESTED, callback),
  onNextTabRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_NEXT_TAB_REQUESTED, callback),
  onPrevTabRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_PREV_TAB_REQUESTED, callback),
  onMoveTabLeftRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_MOVE_TAB_LEFT_REQUESTED, callback),
  onMoveTabRightRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_MOVE_TAB_RIGHT_REQUESTED, callback),
  onReopenClosedTabRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_REOPEN_CLOSED_TAB_REQUESTED, callback),
  onToggleBookmarkBarRequested: (callback) =>
    onShellCommand(SHELL_API_EVENTS.CHROME_TOGGLE_BOOKMARK_BAR_REQUESTED, callback),
});

contextBridge.exposeInMainWorld('freedomShell', freedomShell);

module.exports = {
  SHELL_API_EVENTS,
  SHELL_EVENT,
  SHELL_API_METHODS,
  SHELL_REQUEST,
};
