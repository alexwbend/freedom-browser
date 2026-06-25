const getRuntimeWindow = () => (typeof window === 'undefined' ? {} : window);
const noopDisposer = () => {};
const asyncNull = async () => null;
const asyncProfileMutationUnavailable = async () => ({
  success: false,
  error: {
    code: 'PROFILE_PACKAGE_MUTATION_UNAVAILABLE',
    message: 'Profile creation and switching are shell-owned in package mode',
  },
});
const asyncServiceBaseUnavailable = async () =>
  unavailableResult(
    'SERVICE_BASE_UNAVAILABLE',
    'Service endpoint base updates are shell-owned in package mode'
  );
const asyncExternalNodePromptUnavailable = async () =>
  unavailableResult(
    'EXTERNAL_NODE_PROMPT_UNAVAILABLE',
    'External node candidate decisions are shell-owned in package mode'
  );
const asyncEnsWalletResolutionUnavailable = async () => ({
  success: false,
  reason: 'PACKAGE_UNAVAILABLE',
  code: 'ENS_WALLET_RESOLUTION_UNAVAILABLE',
  error: 'ENS address and reverse lookups are shell-owned in package mode',
});
const asyncX402Unavailable = async () =>
  unavailableResult(
    'X402_PACKAGE_API_UNAVAILABLE',
    'x402 approval and permission APIs are shell-owned in package mode'
  );
const unavailableResult = (code, message) => ({
  success: false,
  error: { code, message },
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
  return !!getRuntimeWindow().freedomShell;
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
    setBzzBase: asyncServiceBaseUnavailable,
    clearBzzBase: asyncServiceBaseUnavailable,
    setRadBase: asyncServiceBaseUnavailable,
    clearRadBase: asyncServiceBaseUnavailable,
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
    onUpdateNotification: (callback) =>
      subscribeFreedomShell('onUpdateNotification', callback),
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
    resolveExternalNodeCandidates: asyncExternalNodePromptUnavailable,
    onExternalNodeCandidates: () => noopDisposer,
    onProfileUpdated: (callback) => subscribeFreedomShell('onProfileUpdated', callback),
    onCloseMenus: (callback) => subscribeFreedomShell('onCloseMenusRequested', callback),
    onOpenPublishSetup: () => noopDisposer,
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
    resolveEnsAddress: asyncEnsWalletResolutionUnavailable,
    resolveEnsReverse: asyncEnsWalletResolutionUnavailable,
    invalidateEnsContent: (name) =>
      getRuntimeWindow().freedomShell?.invalidateEnsContent?.(name),
    getHistory: (options) => callFreedomShell('getHistory', [], options),
    addHistory: (entry) => callFreedomShell('addHistory', false, entry),
    removeHistory: (id) => callFreedomShell('removeHistory', false, id),
    clearHistory: () => callFreedomShell('clearHistory', false),
    x402GetDetails: asyncX402Unavailable,
    x402Approve: asyncX402Unavailable,
    x402Reject: asyncX402Unavailable,
    x402ResumeUnlock: asyncX402Unavailable,
    x402RefreshBalances: asyncX402Unavailable,
    x402Cancel: asyncX402Unavailable,
    x402GetReceipts: asyncX402Unavailable,
    x402GetAllPermissions: asyncX402Unavailable,
    x402RevokePermission: asyncX402Unavailable,
    x402RevokeAllForOrigin: asyncX402Unavailable,
    x402UpdatePermission: asyncX402Unavailable,
    onX402ApprovalNeeded: () => noopDisposer,
    onX402ApprovalResult: () => noopDisposer,
    onX402UnlockNeeded: () => noopDisposer,
    onX402CapConsumed: () => noopDisposer,
    onX402BalancesUpdated: () => noopDisposer,
    getWebviewPreloadPath: asyncNull,
    saveImage: (imageUrl) =>
      callFreedomShell(
        'saveImage',
        unavailableResult('IMAGE_SAVE_UNAVAILABLE', 'Image save is unavailable'),
        imageUrl
      ),
    copyText: (text) =>
      callFreedomShell(
        'copyText',
        unavailableResult('CLIPBOARD_WRITE_UNAVAILABLE', 'Clipboard write is unavailable'),
        text
      ),
    readClipboardText: async () => ({ success: false, text: '' }),
    copyImageFromUrl: (imageUrl) =>
      callFreedomShell(
        'copyImageFromUrl',
        unavailableResult('IMAGE_COPY_UNAVAILABLE', 'Image copy is unavailable'),
        imageUrl
      ),
    getSurfaceState: (surface) =>
      callFreedomShell(
        'getSurfaceState',
        unavailableResult('SURFACE_CONTROL_UNAVAILABLE', 'Surface control is unavailable'),
        surface
      ),
    openSurface: (surface) =>
      callFreedomShell(
        'openSurface',
        unavailableResult('SURFACE_CONTROL_UNAVAILABLE', 'Surface control is unavailable'),
        surface
      ),
    closeSurface: (surface) =>
      callFreedomShell(
        'closeSurface',
        unavailableResult('SURFACE_CONTROL_UNAVAILABLE', 'Surface control is unavailable'),
        surface
      ),
    toggleSurface: (surface) =>
      callFreedomShell(
        'toggleSurface',
        unavailableResult('SURFACE_CONTROL_UNAVAILABLE', 'Surface control is unavailable'),
        surface
      ),
    onSurfaceStateChanged: (callback) =>
      subscribeFreedomShell('onSurfaceStateChanged', callback),
    getFavicon: (url) => callFreedomShell('getFavicon', null, url),
    getCachedFavicon: (url) => callFreedomShell('getCachedFavicon', null, url),
    fetchFavicon: (url) => callFreedomShell('fetchFavicon', null, url),
    fetchFaviconWithKey: (fetchUrl, cacheKey) =>
      callFreedomShell('fetchFaviconWithKey', null, fetchUrl, cacheKey),
  });

export const getChromeRuntimeApi = () => {
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
