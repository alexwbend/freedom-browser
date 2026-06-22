const getRuntimeWindow = () => (typeof window === 'undefined' ? {} : window);
const noop = () => {};
const noopDisposer = () => {};
const asyncNull = async () => null;
const asyncFalse = async () => false;
const asyncEmptyArray = async () => [];
const asyncSuccess = async () => ({ success: true });

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

const createPackageRuntimeApi = () =>
  Object.freeze({
    setBzzBase: asyncSuccess,
    clearBzzBase: asyncSuccess,
    setRadBase: asyncSuccess,
    clearRadBase: asyncSuccess,
    setWindowTitle: noop,
    closeWindow: noop,
    minimizeWindow: noop,
    maximizeWindow: noop,
    toggleFullscreen: noop,
    newWindow: noop,
    openUrlInNewWindow: noop,
    showAbout: noop,
    checkForUpdates: noop,
    restartAndInstallUpdate: noop,
    getPlatform: async () => {
      const info = await getPackageInfo();
      return info?.platform || 'linux';
    },
    getActiveProfile: asyncNull,
    listProfiles: asyncEmptyArray,
    createProfile: asyncNull,
    openProfile: asyncFalse,
    resolveExternalNodeCandidates: noop,
    onExternalNodeCandidates: () => noopDisposer,
    onProfileUpdated: () => noopDisposer,
    onCloseMenus: () => noopDisposer,
    onOpenPublishSetup: () => noopDisposer,
    onUpdateNotification: () => noopDisposer,
    onNewTab: () => noopDisposer,
    onCloseTab: () => noopDisposer,
    onNewTabWithUrl: () => noopDisposer,
    onNavigateToUrl: () => noopDisposer,
    onLoadUrl: () => noopDisposer,
    onToggleDevTools: () => noopDisposer,
    onCloseDevTools: () => noopDisposer,
    onCloseAllDevTools: () => noopDisposer,
    onFocusAddressBar: () => noopDisposer,
    onReload: () => noopDisposer,
    onHardReload: () => noopDisposer,
    onNextTab: () => noopDisposer,
    onPrevTab: () => noopDisposer,
    onMoveTabLeft: () => noopDisposer,
    onMoveTabRight: () => noopDisposer,
    onReopenClosedTab: () => noopDisposer,
    onToggleBookmarksBar: () => noopDisposer,
    updateTabMenuState: noop,
    setBookmarkBarToggleEnabled: noop,
    setBookmarkBarChecked: noop,
    getSettings: async () => ({ ...DEFAULT_SETTINGS }),
    saveSettings: asyncFalse,
    getBookmarks: asyncEmptyArray,
    addBookmark: asyncFalse,
    updateBookmark: asyncFalse,
    removeBookmark: asyncFalse,
    resolveEnsAddress: asyncNull,
    resolveEnsReverse: asyncNull,
    getHistory: asyncEmptyArray,
    addHistory: asyncFalse,
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
    getCachedFavicon: asyncNull,
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
