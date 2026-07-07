// Tab strip upgrades — audio indicator + mute, open-next-to-active
// insertion, MRU Ctrl+Tab cycling, and context-menu completeness (close
// left, copy URL, reopen closed). Uses the same fake-DOM module harness as
// tabs-ui.test.js, extended with the audio webview surface and the new
// context-menu actions.

const { createDocument, createElement } = require('../../../test/helpers/fake-dom.js');

const originalWindow = global.window;
const originalDocument = global.document;

const HOME_URL = 'freedom://home';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createElectronApi = (options = {}) => {
  const handlers = {};
  const register = (name) =>
    jest.fn((callback) => {
      handlers[name] = callback;
    });

  return {
    handlers,
    api: {
      setWindowTitle: jest.fn(),
      updateTabMenuState: jest.fn(),
      closeWindow: jest.fn(),
      copyText: jest.fn().mockResolvedValue(true),
      getSettings: jest.fn().mockResolvedValue(options.settings || {}),
      getWebviewPreloadPath: jest.fn().mockResolvedValue('/tmp/webview-preload.js'),
      getCachedFavicon: jest.fn().mockResolvedValue('data:image/png;base64,favicon'),
      onNewTab: register('newTab'),
      onCloseTab: register('closeTab'),
      onNewTabWithUrl: register('newTabWithUrl'),
      onNavigateToUrl: register('navigateToUrl'),
      onLoadUrl: register('loadUrl'),
      onToggleDevTools: register('toggleDevTools'),
      onCloseDevTools: register('closeDevTools'),
      onCloseAllDevTools: register('closeAllDevTools'),
      onFocusAddressBar: register('focusAddressBar'),
      onReload: register('reload'),
      onHardReload: register('hardReload'),
      onNextTab: register('nextTab'),
      onPrevTab: register('prevTab'),
      onMoveTabLeft: register('moveTabLeft'),
      onMoveTabRight: register('moveTabRight'),
      onReopenClosedTab: register('reopenClosedTab'),
    },
  };
};

const createWebview = (createdWebviews) => {
  const webview = createElement('webview');
  const addEventListener = webview.addEventListener.bind(webview);
  const removeEventListener = webview.removeEventListener.bind(webview);

  webview.addEventListener = jest.fn((event, handler) => {
    addEventListener(event, handler);
  });
  webview.removeEventListener = jest.fn((event, handler) => {
    removeEventListener(event, handler);
  });
  webview._devToolsOpen = false;
  webview._audioMuted = false;
  webview._audible = false;
  webview.getURL = jest.fn(() => webview.src || 'about:blank');
  webview.setAudioMuted = jest.fn((muted) => {
    webview._audioMuted = muted;
  });
  webview.isAudioMuted = jest.fn(() => webview._audioMuted);
  webview.isCurrentlyAudible = jest.fn(() => webview._audible);
  webview.openDevTools = jest.fn(() => {
    webview._devToolsOpen = true;
  });
  webview.closeDevTools = jest.fn(() => {
    webview._devToolsOpen = false;
  });
  webview.isDevToolsOpened = jest.fn(() => webview._devToolsOpen);
  createdWebviews.push(webview);
  return webview;
};

const CONTEXT_MENU_ACTIONS = [
  'close',
  'close-others',
  'close-right',
  'close-left',
  'pin',
  'mute',
  'copy-url',
  'reopen-closed',
];

const buildTabContextMenu = () => {
  const tabContextMenu = createElement('div', { classes: ['hidden'] });
  const actions = {};

  CONTEXT_MENU_ACTIONS.forEach((action) => {
    const button = createElement('button');
    button.dataset.action = action;
    tabContextMenu.appendChild(button);
    actions[action] = button;
  });

  return { tabContextMenu, actions };
};

const loadTabsModule = async (options = {}) => {
  jest.resetModules();

  const createdWebviews = [];
  const { api: electronAPI, handlers: electronHandlers } = createElectronApi(options);
  const tabBar = createElement('div');
  const newTabBtn = createElement('button');
  const webviewContainer = createElement('div');
  const bzzWebview = createElement('webview');
  const addressInput = createElement('input');
  const mruSwitcher = createElement('div', { classes: ['hidden'] });
  const mruList = createElement('div');
  mruSwitcher.appendChild(mruList);
  const { tabContextMenu, actions } = buildTabContextMenu();
  const document = createDocument({
    elementsById: {
      'tab-bar': tabBar,
      'new-tab-btn': newTabBtn,
      'webview-container': webviewContainer,
      'tab-context-menu': tabContextMenu,
      'bzz-webview': bzzWebview,
      'address-input': addressInput,
      'tab-mru-switcher': mruSwitcher,
      'tab-mru-list': mruList,
    },
    createElementOverride: (tagName) => {
      if (tagName === 'webview') {
        return createWebview(createdWebviews);
      }
      return createElement(tagName);
    },
  });
  const windowHandlers = {};

  addressInput.focus = jest.fn();
  addressInput.select = jest.fn();

  global.window = {
    electronAPI,
    innerWidth: 800,
    innerHeight: 600,
    location: {
      href: 'file:///app/index.html',
      search: options.search || '',
    },
    addEventListener: jest.fn((event, handler) => {
      windowHandlers[event] = handler;
    }),
  };

  global.document = document;

  jest.doMock('./debug.js', () => ({ pushDebug: jest.fn() }));
  jest.doMock('./menus.js', () => ({ closeMenus: jest.fn() }));
  jest.doMock('./bookmarks-ui.js', () => ({ hideBookmarkContextMenu: jest.fn() }));
  jest.doMock('./menu-backdrop.js', () => ({
    showMenuBackdrop: jest.fn(),
    hideMenuBackdrop: jest.fn(),
  }));
  jest.doMock('./page-context-menu.js', () => ({ setupWebviewContextMenu: jest.fn() }));
  jest.doMock('./link-status.js', () => ({
    clearLinkStatus: jest.fn(),
    clearHoverStatus: jest.fn(),
    showLinkStatus: jest.fn(),
    setLinkStatusSide: jest.fn(),
  }));
  jest.doMock('./page-urls.js', () => ({
    homeUrl: options.homeUrl || HOME_URL,
    getInternalPageName: (url) =>
      typeof url === 'string' && url.includes('/pages/history.html') ? 'history' : null,
    internalPages: {},
  }));

  const mod = await import('./tabs.js');

  return {
    mod,
    electronAPI,
    electronHandlers,
    createdWebviews,
    elements: {
      tabBar,
      newTabBtn,
      webviewContainer,
      tabContextMenu,
      bzzWebview,
      addressInput,
      mruSwitcher,
      mruList,
      actions,
    },
    windowHandlers,
    documentHandlers: document.handlers,
  };
};

const findTabElement = (tabBar, tabId) =>
  tabBar.children.find((child) => child.dataset.tabId === tabId) || null;

const openContextMenu = (tabEl) => {
  tabEl.dispatch('contextmenu', {
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    clientX: 100,
    clientY: 100,
  });
};

describe('tab audio indicator + mute', () => {
  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('getTabAudioState reducer: muted wins over audible', async () => {
    const { mod } = await loadTabsModule();
    expect(mod.getTabAudioState(null)).toBe(null);
    expect(mod.getTabAudioState({})).toBe(null);
    expect(mod.getTabAudioState({ isAudible: true })).toBe('audible');
    expect(mod.getTabAudioState({ isMuted: true })).toBe('muted');
    expect(mod.getTabAudioState({ isMuted: true, isAudible: true })).toBe('muted');
  });

  test('media events drive the audible flag and the strip indicator', async () => {
    jest.useFakeTimers();
    const { mod, elements } = await loadTabsModule();
    await mod.initTabs();

    const tab = mod.getActiveTab();
    const tabEl = findTabElement(elements.tabBar, tab.id);
    expect(tabEl.dataset.audioState).toBeUndefined();

    tab.webview._audible = true;
    tab.webview.dispatch('media-started-playing');
    expect(tab.isAudible).toBe(true);
    expect(tabEl.dataset.audioState).toBe('audible');

    tab.webview._audible = false;
    tab.webview.dispatch('media-paused');
    expect(tab.isAudible).toBe(false);
    expect(tabEl.dataset.audioState).toBeUndefined();
  });

  test('falls back to the media event when isCurrentlyAudible is unavailable', async () => {
    jest.useFakeTimers();
    const { mod } = await loadTabsModule();
    await mod.initTabs();

    const tab = mod.getActiveTab();
    delete tab.webview.isCurrentlyAudible;

    tab.webview.dispatch('media-started-playing');
    expect(tab.isAudible).toBe(true);
    tab.webview.dispatch('media-paused');
    expect(tab.isAudible).toBe(false);
  });

  test('delayed re-sample converges the indicator on the real audible state', async () => {
    jest.useFakeTimers();
    const { mod } = await loadTabsModule();
    await mod.initTabs();

    const tab = mod.getActiveTab();
    // Media starts but audio is not audible yet (fade-in): the event edge
    // samples false, the recheck later flips it to true.
    tab.webview._audible = false;
    tab.webview.dispatch('media-started-playing');
    // isCurrentlyAudible() returned false, overriding the event fallback.
    expect(tab.isAudible).toBe(false);

    tab.webview._audible = true;
    jest.runOnlyPendingTimers();
    expect(tab.isAudible).toBe(true);
    // The recheck must not reschedule itself into a standing poll.
    expect(jest.getTimerCount()).toBe(0);
  });

  test('toggleMuteTab applies webContents mute and shows the muted indicator', async () => {
    jest.useFakeTimers();
    const { mod, elements } = await loadTabsModule();
    await mod.initTabs();

    const tab = mod.getActiveTab();
    const tabEl = findTabElement(elements.tabBar, tab.id);

    // Muted wins over audible.
    tab.webview._audible = true;
    tab.webview.dispatch('media-started-playing');
    mod.toggleMuteTab(tab.id);
    expect(tab.isMuted).toBe(true);
    expect(tab.webview.setAudioMuted).toHaveBeenCalledWith(true);
    expect(tabEl.dataset.audioState).toBe('muted');

    mod.toggleMuteTab(tab.id);
    expect(tab.isMuted).toBe(false);
    expect(tab.webview.setAudioMuted).toHaveBeenLastCalledWith(false);
    expect(tabEl.dataset.audioState).toBe('audible');
  });

  test('clicking the tab audio button toggles mute without switching tabs', async () => {
    const { mod, elements } = await loadTabsModule();
    await mod.initTabs();

    const first = mod.getActiveTab();
    mod.createTab('https://second.example');
    const firstEl = findTabElement(elements.tabBar, first.id);
    const audioBtn = firstEl.querySelector('.tab-audio');
    expect(audioBtn).toBeTruthy();

    const stopPropagation = jest.fn();
    audioBtn.dispatch('click', { stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
    expect(first.isMuted).toBe(true);
    // The click must not activate the (background) first tab.
    expect(mod.getActiveTab().id).not.toBe(first.id);
  });

  test('context menu offers Mute Tab / Unmute Tab', async () => {
    const { mod, elements } = await loadTabsModule();
    await mod.initTabs();

    const tab = mod.getActiveTab();
    const tabEl = findTabElement(elements.tabBar, tab.id);

    openContextMenu(tabEl);
    expect(elements.actions.mute.textContent).toBe('Mute Tab');
    elements.tabContextMenu.dispatch('click', { target: elements.actions.mute });
    expect(tab.isMuted).toBe(true);

    openContextMenu(tabEl);
    expect(elements.actions.mute.textContent).toBe('Unmute Tab');
    elements.tabContextMenu.dispatch('click', { target: elements.actions.mute });
    expect(tab.isMuted).toBe(false);
  });

  test('placeholder tabs: mute is materialize-safe', async () => {
    const { mod } = await loadTabsModule();
    await mod.initTabs();

    const placeholder = mod.createPlaceholderTab({
      url: 'https://restored.example/',
      title: 'Restored',
    });
    expect(placeholder.webview).toBe(null);

    // Toggling mute on a placeholder must not throw and must stick.
    mod.toggleMuteTab(placeholder.id);
    expect(placeholder.isMuted).toBe(true);

    // Materialize on activation; dom-ready applies the deferred mute.
    mod.switchTab(placeholder.id);
    await flushMicrotasks();
    expect(placeholder.webview).toBeTruthy();
    placeholder.webview.dispatch('dom-ready');
    expect(placeholder.webview.setAudioMuted).toHaveBeenCalledWith(true);
  });
});

describe('open new tabs next to the active tab', () => {
  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    jest.restoreAllMocks();
  });

  describe('computeNewTabInsertIndex (pure)', () => {
    let computeNewTabInsertIndex;
    beforeAll(async () => {
      ({
        mod: { computeNewTabInsertIndex },
      } = await loadTabsModule());
    });

    const tab = (id, extra = {}) => ({ id, ...extra });

    test('appends at the end when the setting is off', () => {
      const tabs = [tab(1), tab(2), tab(3)];
      expect(computeNewTabInsertIndex(tabs, 1, false)).toBe(3);
    });

    test('appends at the end when the active tab is unknown', () => {
      const tabs = [tab(1), tab(2)];
      expect(computeNewTabInsertIndex(tabs, 99, true)).toBe(2);
      expect(computeNewTabInsertIndex(tabs, null, true)).toBe(2);
    });

    test('inserts right of the active tab', () => {
      const tabs = [tab(1), tab(2), tab(3)];
      expect(computeNewTabInsertIndex(tabs, 1, true)).toBe(1);
      expect(computeNewTabInsertIndex(tabs, 2, true)).toBe(2);
      expect(computeNewTabInsertIndex(tabs, 3, true)).toBe(3);
    });

    test('groups after the active tab existing children', () => {
      const tabs = [tab(1), tab(10, { openerTabId: 1 }), tab(11, { openerTabId: 1 }), tab(2)];
      expect(computeNewTabInsertIndex(tabs, 1, true)).toBe(3);
      // Children of a different opener are not skipped.
      expect(computeNewTabInsertIndex(tabs, 2, true)).toBe(4);
    });

    test('never splits the pinned block', () => {
      const tabs = [tab(1, { pinned: true }), tab(2, { pinned: true }), tab(3)];
      expect(computeNewTabInsertIndex(tabs, 1, true)).toBe(2);
    });
  });

  test('new tabs open right of the active tab by default', async () => {
    const { mod } = await loadTabsModule();
    await mod.initTabs();

    const tabA = mod.getActiveTab();
    const tabB = mod.createTab('https://b.example/');
    // Switch back to A and open another tab: it must land between A and B.
    mod.switchTab(tabA.id);
    const tabC = mod.createTab('https://c.example/');

    expect(mod.getTabs().map((t) => t.id)).toEqual([tabA.id, tabC.id, tabB.id]);
    expect(mod.getActiveTab().id).toBe(tabC.id);
  });

  test('link-opened child tabs group after their opener in open order', async () => {
    const { mod } = await loadTabsModule();
    await mod.initTabs();

    const opener = mod.getActiveTab();
    const trailing = mod.createTab('https://trailing.example/');
    mod.switchTab(opener.id);

    const child1 = mod.openInNewTabWithTarget('https://child-1.example/', null);
    mod.switchTab(opener.id);
    const child2 = mod.openInNewTabWithTarget('https://child-2.example/', null);

    expect(mod.getTabs().map((t) => t.id)).toEqual([opener.id, child1.id, child2.id, trailing.id]);
  });

  test('setting off restores append-at-end (settings:updated round trip)', async () => {
    const { mod, windowHandlers } = await loadTabsModule();
    await mod.initTabs();

    windowHandlers['settings:updated']({ detail: { openNewTabNextToActive: false } });

    const tabA = mod.getActiveTab();
    const tabB = mod.createTab('https://b.example/');
    mod.switchTab(tabA.id);
    const tabC = mod.createTab('https://c.example/');

    expect(mod.getTabs().map((t) => t.id)).toEqual([tabA.id, tabB.id, tabC.id]);
  });

  test('honors the persisted setting at init', async () => {
    const { mod } = await loadTabsModule({ settings: { openNewTabNextToActive: false } });
    await mod.initTabs();

    const tabA = mod.getActiveTab();
    const tabB = mod.createTab('https://b.example/');
    mod.switchTab(tabA.id);
    const tabC = mod.createTab('https://c.example/');

    expect(mod.getTabs().map((t) => t.id)).toEqual([tabA.id, tabB.id, tabC.id]);
  });

  test('placeholder restore order is untouched; a new tab lands next to the materialized active tab', async () => {
    const { mod } = await loadTabsModule();
    await mod.initTabs();

    // Restored session: three placeholders appended in persisted order.
    const p1 = mod.createPlaceholderTab({ url: 'https://one.example/', title: 'One' });
    const p2 = mod.createPlaceholderTab({ url: 'https://two.example/', title: 'Two' });
    const p3 = mod.createPlaceholderTab({ url: 'https://three.example/', title: 'Three' });
    const home = mod.getTabs()[0];
    expect(mod.getTabs().map((t) => t.id)).toEqual([home.id, p1.id, p2.id, p3.id]);

    // Activate the middle placeholder (materializes) and open a new tab.
    mod.switchTab(p2.id);
    const fresh = mod.createTab('https://fresh.example/');
    expect(mod.getTabs().map((t) => t.id)).toEqual([home.id, p1.id, p2.id, fresh.id, p3.id]);
  });
});

describe('MRU Ctrl+Tab cycling', () => {
  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    jest.restoreAllMocks();
  });

  const ctrlTab = (windowHandlers, { shift = false } = {}) => {
    windowHandlers.keydown({
      ctrlKey: true,
      metaKey: false,
      shiftKey: shift,
      key: 'Tab',
      preventDefault: jest.fn(),
    });
  };

  const releaseCtrl = (windowHandlers) => {
    windowHandlers.keyup({ key: 'Control' });
  };

  const selectedRow = (mruList) =>
    mruList.children.find((row) => row.classList.contains('selected')) || null;

  // Three tabs, most recently used order [C, B, A] (A = initial home tab).
  const setupThreeTabs = async (settings = { mruTabSwitching: true }) => {
    const harness = await loadTabsModule({ settings });
    await harness.mod.initTabs();
    const tabA = harness.mod.getActiveTab();
    const tabB = harness.mod.createTab('https://b.example/');
    const tabC = harness.mod.createTab('https://c.example/');
    return { ...harness, tabA, tabB, tabC };
  };

  test('disabled: Ctrl+Tab stays sequential and shows no switcher', async () => {
    const { mod, elements, windowHandlers, tabA, tabB, tabC } = await setupThreeTabs({
      mruTabSwitching: false,
    });

    // Strip order [A, B, C] (each new tab was active when the next opened),
    // active C. Sequential next wraps to A.
    expect(mod.getActiveTab().id).toBe(tabC.id);
    ctrlTab(windowHandlers);
    expect(mod.getActiveTab().id).toBe(tabA.id);
    expect(elements.mruSwitcher.classList.contains('hidden')).toBe(true);

    ctrlTab(windowHandlers, { shift: true });
    expect(mod.getActiveTab().id).toBe(tabC.id);
    void tabB;
  });

  test('enabled: Ctrl+Tab opens the switcher on the previous tab; releasing Ctrl commits', async () => {
    const { mod, elements, windowHandlers, tabB, tabC } = await setupThreeTabs();

    expect(mod.getActiveTab().id).toBe(tabC.id);
    ctrlTab(windowHandlers);
    // Overlay is visible, tab not switched yet (held-Ctrl preview).
    expect(elements.mruSwitcher.classList.contains('hidden')).toBe(false);
    expect(mod.getActiveTab().id).toBe(tabC.id);
    // Selection sits on the most recently used other tab: B.
    expect(selectedRow(elements.mruList)?.dataset.tabId).toBe(String(tabB.id));

    releaseCtrl(windowHandlers);
    expect(elements.mruSwitcher.classList.contains('hidden')).toBe(true);
    expect(mod.getActiveTab().id).toBe(tabB.id);
  });

  test('repeated Ctrl+Tab while held cycles further; Shift cycles backwards', async () => {
    const { mod, elements, windowHandlers, tabA, tabC } = await setupThreeTabs();

    ctrlTab(windowHandlers);
    ctrlTab(windowHandlers);
    // MRU order [C, B, A] -> two steps from C lands on A.
    expect(selectedRow(elements.mruList)?.dataset.tabId).toBe(String(tabA.id));

    // One step back returns to B, another back to C (wrap behavior).
    ctrlTab(windowHandlers, { shift: true });
    ctrlTab(windowHandlers, { shift: true });
    expect(selectedRow(elements.mruList)?.dataset.tabId).toBe(String(tabC.id));

    releaseCtrl(windowHandlers);
    // Committing the current tab is a no-op switch.
    expect(mod.getActiveTab().id).toBe(tabC.id);
  });

  test('Escape cancels the switch without committing', async () => {
    const { mod, elements, windowHandlers, tabC } = await setupThreeTabs();

    ctrlTab(windowHandlers);
    windowHandlers.keydown({ key: 'Escape', ctrlKey: true, preventDefault: jest.fn() });
    expect(elements.mruSwitcher.classList.contains('hidden')).toBe(true);

    // The later Ctrl release must not commit anything.
    releaseCtrl(windowHandlers);
    expect(mod.getActiveTab().id).toBe(tabC.id);
  });

  test('window blur mid-hold commits the selection', async () => {
    const { mod, windowHandlers, tabB } = await setupThreeTabs();

    ctrlTab(windowHandlers);
    windowHandlers.blur();
    expect(mod.getActiveTab().id).toBe(tabB.id);
  });

  test('MRU order updates on activation and prunes closed tabs', async () => {
    const { mod, elements, windowHandlers, tabA, tabB, tabC } = await setupThreeTabs();

    // Re-activate A: MRU becomes [A, C, B].
    mod.switchTab(tabA.id);
    ctrlTab(windowHandlers);
    expect(selectedRow(elements.mruList)?.dataset.tabId).toBe(String(tabC.id));
    releaseCtrl(windowHandlers);
    expect(mod.getActiveTab().id).toBe(tabC.id);

    // Close B; MRU [C, A] — switcher must not offer the closed tab.
    mod.closeTab(tabB.id);
    ctrlTab(windowHandlers);
    const ids = elements.mruList.children.map((row) => row.dataset.tabId);
    expect(ids).toEqual([String(tabC.id), String(tabA.id)]);
    releaseCtrl(windowHandlers);
    expect(mod.getActiveTab().id).toBe(tabA.id);
  });

  test('never-activated placeholders participate and materialize on commit', async () => {
    const { mod, elements, windowHandlers } = await setupThreeTabs();

    const placeholder = mod.createPlaceholderTab({
      url: 'https://restored.example/',
      title: 'Restored',
    });
    expect(placeholder.webview).toBe(null);

    // Placeholder was never activated, so it trails the MRU list (last row).
    ctrlTab(windowHandlers);
    const rows = elements.mruList.children;
    expect(rows[rows.length - 1].dataset.tabId).toBe(String(placeholder.id));

    // Cycle onto it (3 known tabs first, so 3 steps total from index 0).
    ctrlTab(windowHandlers);
    ctrlTab(windowHandlers);
    expect(selectedRow(elements.mruList)?.dataset.tabId).toBe(String(placeholder.id));

    releaseCtrl(windowHandlers);
    expect(mod.getActiveTab().id).toBe(placeholder.id);
    expect(placeholder.webview).toBeTruthy();
    expect(placeholder.isPlaceholder).toBe(false);
  });

  test('single tab: Ctrl+Tab is a no-op (no overlay)', async () => {
    const { mod, elements, windowHandlers } = await loadTabsModule({
      settings: { mruTabSwitching: true },
    }).then(async (harness) => {
      await harness.mod.initTabs();
      return harness;
    });

    ctrlTab(windowHandlers);
    expect(elements.mruSwitcher.classList.contains('hidden')).toBe(true);
    releaseCtrl(windowHandlers);
    expect(mod.getTabs()).toHaveLength(1);
  });
});
