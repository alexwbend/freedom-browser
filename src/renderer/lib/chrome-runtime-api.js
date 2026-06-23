const getRuntimeWindow = () => (typeof window === 'undefined' ? {} : window);
const noop = () => {};
const noopDisposer = () => {};
const asyncNull = async () => null;
const asyncFalse = async () => false;
const asyncEmptyArray = async () => [];
const asyncSuccess = async () => ({ success: true });
const asyncProfileMutationUnavailable = async () => ({
  success: false,
  error: {
    code: 'PROFILE_PACKAGE_MUTATION_UNAVAILABLE',
    message: 'Profile creation and switching are shell-owned in package mode',
  },
});

const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  antNodeMode: 'ultraLight',
  enableRadicleIntegration: false,
  blockUnverifiedEns: true,
  showBookmarkBar: false,
  enableIdentityWallet: false,
});

let packageRuntimeApi = null;
let packageInfoPromise = null;

export const isPackageChromeRuntime = () => {
  const runtimeWindow = getRuntimeWindow();
  return !runtimeWindow.electronAPI && !!runtimeWindow.freedomShell;
};

const getPackageInfo = async () => {
  const runtimeWindow = getRuntimeWindow();
  if (!packageInfoPromise) {
    packageInfoPromise = runtimeWindow.freedomShell?.getInfo?.().catch(() => null);
  }
  return packageInfoPromise;
};

const callFreedomShell = (methodName, fallbackValue, ...args) => {
  const method = getRuntimeWindow().freedomShell?.[methodName];
  if (typeof method !== 'function') {
    return Promise.resolve(fallbackValue);
  }
  return method(...args);
};

const subscribeFreedomShell = (methodName, callback) => {
  const method = getRuntimeWindow().freedomShell?.[methodName];
  if (typeof method !== 'function') {
    return noopDisposer;
  }
  return method(callback);
};

const createPackageRuntimeApi = () =>
  Object.freeze({
    setBzzBase: asyncSuccess,
    clearBzzBase: asyncSuccess,
    setRadBase: asyncSuccess,
    clearRadBase: asyncSuccess,
    setWindowTitle: (title) => callFreedomShell('setWindowTitle', null, title),
    closeWindow: () => callFreedomShell('closeWindow', null),
    minimizeWindow: () => callFreedomShell('minimizeWindow', null),
    maximizeWindow: () => callFreedomShell('maximizeWindow', null),
    toggleFullscreen: () => callFreedomShell('toggleFullscreen', null),
    newWindow: () => callFreedomShell('newWindow', null),
    openUrlInNewWindow: (url) => callFreedomShell('openUrlInNewWindow', null, url),
    showAbout: () => callFreedomShell('showAbout', null),
    checkForUpdates: () => callFreedomShell('checkForUpdates', null),
    restartAndInstallUpdate: () => callFreedomShell('restartAndInstallUpdate', null),
    getPlatform: async () => {
      const info = await getPackageInfo();
      return info?.platform || 'linux';
    },
    getActiveProfile: () => callFreedomShell('getActiveProfile', null),
    listProfiles: () =>
      callFreedomShell('listProfiles', {
        success: false,
        profiles: [],
        error: {
          code: 'PROFILE_READ_UNAVAILABLE',
          message: 'Profile list unavailable',
        },
      }),
    createProfile: asyncProfileMutationUnavailable,
    openProfile: asyncProfileMutationUnavailable,
    resolveExternalNodeCandidates: noop,
    onExternalNodeCandidates: () => noopDisposer,
    onProfileUpdated: (callback) => subscribeFreedomShell('onProfileUpdated', callback),
    onCloseMenus: (callback) => subscribeFreedomShell('onCloseMenusRequested', callback),
    onOpenPublishSetup: () => noopDisposer,
    onUpdateNotification: () => noopDisposer,
    onNewTab: (callback) => subscribeFreedomShell('onNewTabRequested', callback),
    onCloseTab: (callback) => subscribeFreedomShell('onCloseTabRequested', callback),
    onNewTabWithUrl: (callback) =>
      subscribeFreedomShell('onNewTabWithUrlRequested', callback),
    onNavigateToUrl: (callback) =>
      subscribeFreedomShell('onNavigateToUrlRequested', callback),
    onLoadUrl: (callback) => subscribeFreedomShell('onLoadUrlRequested', callback),
    onToggleDevTools: (callback) =>
      subscribeFreedomShell('onToggleDevToolsRequested', callback),
    onCloseDevTools: (callback) =>
      subscribeFreedomShell('onCloseDevToolsRequested', callback),
    onCloseAllDevTools: (callback) =>
      subscribeFreedomShell('onCloseAllDevToolsRequested', callback),
    onFocusAddressBar: (callback) =>
      subscribeFreedomShell('onFocusAddressBarRequested', callback),
    onReload: (callback) => subscribeFreedomShell('onReloadRequested', callback),
    onHardReload: (callback) => subscribeFreedomShell('onHardReloadRequested', callback),
    onNextTab: (callback) => subscribeFreedomShell('onNextTabRequested', callback),
    onPrevTab: (callback) => subscribeFreedomShell('onPrevTabRequested', callback),
    onMoveTabLeft: (callback) => subscribeFreedomShell('onMoveTabLeftRequested', callback),
    onMoveTabRight: (callback) => subscribeFreedomShell('onMoveTabRightRequested', callback),
    onReopenClosedTab: (callback) =>
      subscribeFreedomShell('onReopenClosedTabRequested', callback),
    onToggleBookmarkBar: (callback) =>
      subscribeFreedomShell('onToggleBookmarkBarRequested', callback),
    onToggleBookmarksBar: () => noopDisposer,
    updateTabMenuState: (state) => callFreedomShell('updateTabMenuState', null, state),
    setBookmarkBarToggleEnabled: (enabled) =>
      callFreedomShell('setBookmarkBarToggleEnabled', null, enabled),
    setBookmarkBarChecked: (checked) =>
      callFreedomShell('setBookmarkBarChecked', null, checked),
    getSettings: () => callFreedomShell('getSettings', { ...DEFAULT_SETTINGS }),
    saveSettings: (settings) => callFreedomShell('saveSettings', false, settings),
    getBookmarks: () => callFreedomShell('getBookmarks', []),
    addBookmark: (bookmark) => callFreedomShell('addBookmark', false, bookmark),
    updateBookmark: (originalTarget, bookmark) =>
      callFreedomShell('updateBookmark', false, originalTarget, bookmark),
    removeBookmark: (target) => callFreedomShell('removeBookmark', false, target),
    resolveEns: (name) => getRuntimeWindow().freedomShell?.resolveEns?.(name),
    resolveEnsAddress: asyncNull,
    resolveEnsReverse: asyncNull,
    invalidateEnsContent: (name) =>
      getRuntimeWindow().freedomShell?.invalidateEnsContent?.(name),
    getHistory: (options) => callFreedomShell('getHistory', [], options),
    addHistory: (entry) => callFreedomShell('addHistory', false, entry),
    removeHistory: asyncFalse,
    clearHistory: asyncFalse,
    x402GetDetails: asyncNull,
    x402Approve: asyncFalse,
    x402Reject: asyncFalse,
    x402ResumeUnlock: asyncFalse,
    x402RefreshBalances: asyncFalse,
    x402Cancel: asyncFalse,
    x402GetReceipts: asyncEmptyArray,
    x402GetAllPermissions: asyncEmptyArray,
    x402RevokePermission: asyncFalse,
    x402RevokeAllForOrigin: asyncFalse,
    x402UpdatePermission: asyncFalse,
    onX402ApprovalNeeded: () => noopDisposer,
    onX402ApprovalResult: () => noopDisposer,
    onX402UnlockNeeded: () => noopDisposer,
    onX402CapConsumed: () => noopDisposer,
    onX402BalancesUpdated: () => noopDisposer,
    getWebviewPreloadPath: asyncNull,
    saveImage: asyncFalse,
    copyText: asyncFalse,
    readClipboardText: async () => ({ success: false, text: '' }),
    copyImageFromUrl: asyncFalse,
    getFavicon: asyncNull,
    getCachedFavicon: (url) => callFreedomShell('getCachedFavicon', null, url),
    fetchFavicon: asyncNull,
    fetchFaviconWithKey: asyncNull,
  });

export const getChromeRuntimeApi = () => {
  const runtimeWindow = getRuntimeWindow();
  if (runtimeWindow.electronAPI) {
    return runtimeWindow.electronAPI;
  }
  if (!packageRuntimeApi) {
    packageRuntimeApi = createPackageRuntimeApi();
  }
  return packageRuntimeApi;
};

export const markPackageChromeReady = async () => {
  if (!isPackageChromeRuntime()) {
    return false;
  }
  await getRuntimeWindow().freedomShell.markReady();
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.packageReady = 'true';
  }
  return true;
};
