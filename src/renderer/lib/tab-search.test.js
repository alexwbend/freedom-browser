// Tab search popover behavior — open/filter/keyboard-activate, backdrop
// integration, and placeholder listing. tabs.js is mocked so the popover is
// exercised against a controlled tab list (fake-dom, same harness style as
// tabs-ui.test.js).

const { createDocument, createElement } = require('../../../test/helpers/fake-dom.js');

const originalWindow = global.window;
const originalDocument = global.document;

const loadTabSearchModule = async ({ tabs, activeTabId } = {}) => {
  jest.resetModules();

  const tabsState = {
    tabs: tabs || [],
    activeTabId: activeTabId ?? null,
  };

  const tabsMocks = {
    getTabs: jest.fn(() => tabsState.tabs),
    getActiveTab: jest.fn(() => tabsState.tabs.find((t) => t.id === tabsState.activeTabId) || null),
    switchTab: jest.fn((tabId) => {
      tabsState.activeTabId = tabId;
    }),
    getTabAudioState: jest.fn((tab) => (tab.isMuted ? 'muted' : tab.isAudible ? 'audible' : null)),
  };
  const menusMocks = { closeMenus: jest.fn() };
  const backdropMocks = {
    showMenuBackdrop: jest.fn(),
    hideMenuBackdrop: jest.fn(),
  };

  const popover = createElement('div', { classes: ['tab-search', 'hidden'] });
  const input = createElement('input');
  input.focus = jest.fn();
  const list = createElement('div');
  popover.appendChild(input);
  popover.appendChild(list);

  const document = createDocument({
    elementsById: {
      'tab-search': popover,
      'tab-search-input': input,
      'tab-search-list': list,
    },
  });

  const windowHandlers = {};
  const electronHandlers = {};
  global.window = {
    electronAPI: {
      onTabSearch: jest.fn((callback) => {
        electronHandlers.tabSearch = callback;
      }),
    },
    addEventListener: jest.fn((event, handler) => {
      windowHandlers[event] = handler;
    }),
  };
  global.document = document;

  jest.doMock('./tabs.js', () => tabsMocks);
  jest.doMock('./menus.js', () => menusMocks);
  jest.doMock('./menu-backdrop.js', () => backdropMocks);
  jest.doMock('./debug.js', () => ({ pushDebug: jest.fn() }));

  const mod = await import('./tab-search.js');

  return {
    mod,
    tabsMocks,
    menusMocks,
    backdropMocks,
    elements: { popover, input, list },
    windowHandlers,
    electronHandlers,
    tabsState,
  };
};

const sampleTabs = () => [
  { id: 1, title: 'Pinned Docs', url: 'https://docs.example/', pinned: true },
  { id: 2, title: 'New Tab', url: 'freedom://home' },
  { id: 3, title: 'GitHub', url: 'https://github.com/', isAudible: true },
  {
    id: 4,
    title: 'Restored Placeholder',
    url: 'https://restored.example/',
    isPlaceholder: true,
    webview: null,
  },
];

const rowsOf = (list) => list.children.filter((el) => el.dataset.test === 'tab-search-item');

describe('tab search popover', () => {
  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    jest.restoreAllMocks();
  });

  test('opens listing pinned tabs first (placeholders included), current window order', async () => {
    const { mod, elements, backdropMocks, menusMocks } = await loadTabSearchModule({
      tabs: sampleTabs(),
      activeTabId: 2,
    });
    const onOpening = jest.fn();
    mod.initTabSearch({ onOpening });

    mod.showTabSearch();
    expect(mod.isTabSearchOpen()).toBe(true);
    expect(elements.popover.classList.contains('hidden')).toBe(false);
    expect(menusMocks.closeMenus).toHaveBeenCalled();
    expect(onOpening).toHaveBeenCalled();
    expect(backdropMocks.showMenuBackdrop).toHaveBeenCalled();
    expect(elements.input.focus).toHaveBeenCalled();

    const rows = rowsOf(elements.list);
    expect(rows.map((row) => row.dataset.tabId)).toEqual(['1', '2', '3', '4']);
    // Placeholder listed by persisted title/URL.
    const placeholderRow = rows[3];
    expect(placeholderRow.querySelector('.tab-search-item-title').textContent).toBe(
      'Restored Placeholder'
    );
    // Audible tab gets an audio badge; others don't.
    expect(rows[2].querySelector('.tab-search-item-audio')).toBeTruthy();
    expect(rows[0].querySelector('.tab-search-item-audio')).toBe(null);
  });

  test('typing fuzzy-filters and Enter activates the selected tab', async () => {
    const { mod, elements, tabsMocks } = await loadTabSearchModule({
      tabs: sampleTabs(),
      activeTabId: 2,
    });
    mod.initTabSearch();
    mod.showTabSearch();

    elements.input.value = 'github';
    elements.input.dispatch('input');
    let rows = rowsOf(elements.list);
    expect(rows.map((row) => row.dataset.tabId)).toEqual(['3']);

    elements.input.dispatch('keydown', { key: 'Enter', preventDefault: jest.fn() });
    expect(tabsMocks.switchTab).toHaveBeenCalledWith(3);
    expect(mod.isTabSearchOpen()).toBe(false);
  });

  test('arrow keys move the selection with wrap-around', async () => {
    const { mod, elements, tabsMocks } = await loadTabSearchModule({
      tabs: sampleTabs(),
      activeTabId: 2,
    });
    mod.initTabSearch();
    mod.showTabSearch();

    const prevent = jest.fn();
    elements.input.dispatch('keydown', { key: 'ArrowDown', preventDefault: prevent });
    elements.input.dispatch('keydown', { key: 'ArrowDown', preventDefault: prevent });
    let rows = rowsOf(elements.list);
    expect(rows[2].classList.contains('selected')).toBe(true);

    elements.input.dispatch('keydown', { key: 'ArrowUp', preventDefault: prevent });
    elements.input.dispatch('keydown', { key: 'ArrowUp', preventDefault: prevent });
    elements.input.dispatch('keydown', { key: 'ArrowUp', preventDefault: prevent });
    rows = rowsOf(elements.list);
    // 0 -> wraps to the last row.
    expect(rows[3].classList.contains('selected')).toBe(true);

    elements.input.dispatch('keydown', { key: 'Enter', preventDefault: prevent });
    expect(tabsMocks.switchTab).toHaveBeenCalledWith(4);
  });

  test('Escape and window blur close the popover and hide the backdrop', async () => {
    const { mod, elements, backdropMocks, windowHandlers } = await loadTabSearchModule({
      tabs: sampleTabs(),
      activeTabId: 2,
    });
    mod.initTabSearch();

    mod.showTabSearch();
    elements.input.dispatch('keydown', { key: 'Escape', preventDefault: jest.fn() });
    expect(mod.isTabSearchOpen()).toBe(false);
    expect(backdropMocks.hideMenuBackdrop).toHaveBeenCalledTimes(1);

    mod.showTabSearch();
    windowHandlers.blur();
    expect(mod.isTabSearchOpen()).toBe(false);
    expect(backdropMocks.hideMenuBackdrop).toHaveBeenCalledTimes(2);
  });

  test('clicking a row activates that tab', async () => {
    const { mod, elements, tabsMocks } = await loadTabSearchModule({
      tabs: sampleTabs(),
      activeTabId: 2,
    });
    mod.initTabSearch();
    mod.showTabSearch();

    const rows = rowsOf(elements.list);
    rows[0].dispatch('click');
    expect(tabsMocks.switchTab).toHaveBeenCalledWith(1);
    expect(mod.isTabSearchOpen()).toBe(false);
  });

  test('keyboard shortcut and menu IPC both toggle the popover', async () => {
    const { mod, windowHandlers, electronHandlers } = await loadTabSearchModule({
      tabs: sampleTabs(),
      activeTabId: 2,
    });
    mod.initTabSearch();

    // Renderer fallback: Cmd/Ctrl+Shift+A.
    windowHandlers.keydown({
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      key: 'A',
      preventDefault: jest.fn(),
    });
    expect(mod.isTabSearchOpen()).toBe(true);
    windowHandlers.keydown({
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      key: 'a',
      preventDefault: jest.fn(),
    });
    expect(mod.isTabSearchOpen()).toBe(false);

    // Main-menu accelerator round trip (View -> Search Tabs).
    electronHandlers.tabSearch();
    expect(mod.isTabSearchOpen()).toBe(true);
    electronHandlers.tabSearch();
    expect(mod.isTabSearchOpen()).toBe(false);
  });

  test('shows an empty state when nothing matches', async () => {
    const { mod, elements } = await loadTabSearchModule({
      tabs: sampleTabs(),
      activeTabId: 2,
    });
    mod.initTabSearch();
    mod.showTabSearch();

    elements.input.value = 'zzzz-no-match';
    elements.input.dispatch('input');
    expect(rowsOf(elements.list)).toEqual([]);
    const empty = elements.list.children.find((el) => el.classList.contains('tab-search-empty'));
    expect(empty).toBeTruthy();

    // Enter with no matches is a no-op close, not a crash.
    elements.input.dispatch('keydown', { key: 'Enter', preventDefault: jest.fn() });
    expect(mod.isTabSearchOpen()).toBe(false);
  });
});
