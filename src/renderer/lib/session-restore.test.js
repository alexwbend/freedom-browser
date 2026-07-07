/**
 * Session restore — renderer side.
 *
 * Covers the pure tab-strip serialization (what lands in session.json),
 * the ~1s debounced snapshot shipping, the restore-payload fetch, and the
 * placeholder-tab mechanism in tabs.js (lazy materialization on first
 * activation — the foundation for future tab hibernation).
 */

// Mock environment mirrors tabs.test.js: tabs.js and page-urls.js read
// window/document at import time.
const mockElectronAPI = {
  setWindowTitle: jest.fn(),
  updateSessionState: jest.fn(),
  getSessionToRestore: jest.fn(),
};

const createMockWebview = (tabId) => ({
  setAttribute: jest.fn(),
  addEventListener: jest.fn(),
  classList: {
    toggle: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
  },
  dataset: { tabId },
  getURL: jest.fn(() => 'about:blank'),
  remove: jest.fn(),
});

beforeAll(() => {
  global.window = {
    electronAPI: { ...mockElectronAPI, getSettings: jest.fn(() => Promise.resolve({})) },
    location: { href: 'file:///app/index.html' },
    addEventListener: jest.fn(),
    internalPages: {
      routable: {
        home: 'home.html',
        history: 'history.html',
        settings: 'settings.html',
      },
    },
  };

  global.document = {
    createElement: jest.fn((tag) => {
      if (tag === 'webview') {
        return createMockWebview(0);
      }
      return {
        className: '',
        classList: { add: jest.fn(), toggle: jest.fn() },
        dataset: {},
        appendChild: jest.fn(),
        addEventListener: jest.fn(),
        innerHTML: '',
      };
    }),
    getElementById: jest.fn(() => null),
  };

  global.URL = URL;
});

afterEach(() => {
  mockElectronAPI.updateSessionState.mockClear();
  mockElectronAPI.getSessionToRestore.mockReset();
});

describe('serializeSessionTabs', () => {
  test('serializes url/title/pinned/faviconUrl in tab order with the active index', async () => {
    const { serializeSessionTabs } = await import('./session-restore.js');

    const tabs = [
      {
        id: 1,
        url: 'https://example.com/',
        title: 'Example',
        pinned: true,
        favicon: 'data:image/png;base64,AA',
      },
      { id: 2, url: 'bzz://name.eth/', title: 'Swarm site', favicon: null },
    ];

    expect(serializeSessionTabs(tabs, 2)).toEqual({
      tabs: [
        {
          url: 'https://example.com/',
          title: 'Example',
          pinned: true,
          faviconUrl: 'data:image/png;base64,AA',
        },
        { url: 'bzz://name.eth/', title: 'Swarm site', pinned: false, faviconUrl: null },
      ],
      activeTabIndex: 1,
    });
  });

  test('normalizes internal pages (including home) to their freedom:// form', async () => {
    const { serializeSessionTabs } = await import('./session-restore.js');

    const tabs = [
      { id: 1, url: 'file:///app/pages/history.html', title: 'History' },
      { id: 2, url: 'file:///app/pages/home.html', title: 'New Tab' },
      // A still-resolving internal tab already carries the friendly form.
      { id: 3, url: 'freedom://settings/appearance', title: 'Settings' },
    ];

    expect(serializeSessionTabs(tabs, 1).tabs.map((t) => t.url)).toEqual([
      'freedom://history',
      'freedom://home',
      'freedom://settings/appearance',
    ]);
  });

  test('skips blank tabs and computes the active index against the kept list', async () => {
    const { serializeSessionTabs } = await import('./session-restore.js');

    const tabs = [
      { id: 1, url: 'about:blank', title: 'parked' },
      { id: 2, url: '', navigationState: { currentPageUrl: 'https://from-nav-state.example/' } },
      { id: 3, url: 'https://active.example/', title: 'Active' },
    ];

    const result = serializeSessionTabs(tabs, 3);
    expect(result.tabs.map((t) => t.url)).toEqual([
      'https://from-nav-state.example/',
      'https://active.example/',
    ]);
    expect(result.activeTabIndex).toBe(1);
  });

  test('drops oversized favicons and non-string titles', async () => {
    const { serializeSessionTabs } = await import('./session-restore.js');

    const tabs = [{ id: 1, url: 'https://a.example/', title: 42, favicon: 'x'.repeat(70000) }];

    expect(serializeSessionTabs(tabs, 1).tabs[0]).toEqual({
      url: 'https://a.example/',
      title: '',
      pinned: false,
      faviconUrl: null,
    });
  });

  test('handles empty input', async () => {
    const { serializeSessionTabs } = await import('./session-restore.js');

    expect(serializeSessionTabs([], null)).toEqual({ tabs: [], activeTabIndex: 0 });
    expect(serializeSessionTabs(undefined, null)).toEqual({ tabs: [], activeTabIndex: 0 });
  });
});

describe('persistSessionSoon', () => {
  test('coalesces a burst of mutations into one snapshot after ~1s', async () => {
    jest.useFakeTimers();
    try {
      const { initSessionPersistence, persistSessionSoon, SESSION_SNAPSHOT_DEBOUNCE_MS } =
        await import('./session-restore.js');

      const tabs = [{ id: 1, url: 'https://example.com/', title: 'Example' }];
      initSessionPersistence(() => ({ tabs, activeTabId: 1 }));

      persistSessionSoon();
      persistSessionSoon();
      persistSessionSoon();

      jest.advanceTimersByTime(SESSION_SNAPSHOT_DEBOUNCE_MS - 1);
      expect(mockElectronAPI.updateSessionState).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(mockElectronAPI.updateSessionState).toHaveBeenCalledTimes(1);
      expect(mockElectronAPI.updateSessionState).toHaveBeenCalledWith({
        tabs: [{ url: 'https://example.com/', title: 'Example', pinned: false, faviconUrl: null }],
        activeTabIndex: 0,
      });

      // The snapshot reflects state at send time, not schedule time.
      tabs.push({ id: 2, url: 'https://b.example/', title: 'B' });
      persistSessionSoon();
      jest.advanceTimersByTime(SESSION_SNAPSHOT_DEBOUNCE_MS);
      expect(mockElectronAPI.updateSessionState).toHaveBeenCalledTimes(2);
      expect(mockElectronAPI.updateSessionState.mock.calls[1][0].tabs).toHaveLength(2);
    } finally {
      const { initSessionPersistence } = await import('./session-restore.js');
      initSessionPersistence(null);
      jest.useRealTimers();
    }
  });

  test('is a no-op before a provider is registered', async () => {
    const { initSessionPersistence, persistSessionSoon } = await import('./session-restore.js');
    initSessionPersistence(null);

    expect(() => persistSessionSoon()).not.toThrow();
    expect(mockElectronAPI.updateSessionState).not.toHaveBeenCalled();
  });
});

describe('getSessionToRestore', () => {
  test('returns null when the window has no restore slot', async () => {
    const { getSessionToRestore } = await import('./session-restore.js');

    expect(await getSessionToRestore(new URLSearchParams(''))).toBeNull();
    expect(mockElectronAPI.getSessionToRestore).not.toHaveBeenCalled();
  });

  test('fetches the payload for the window restore slot', async () => {
    const { getSessionToRestore } = await import('./session-restore.js');
    const payload = { tabs: [{ url: 'https://example.com/' }], activeTabIndex: 0 };
    mockElectronAPI.getSessionToRestore.mockResolvedValue(payload);

    expect(await getSessionToRestore(new URLSearchParams('restoreSlot=1'))).toBe(payload);
    expect(mockElectronAPI.getSessionToRestore).toHaveBeenCalledWith(1);
  });

  test('degrades to null on empty, malformed, or failing payloads', async () => {
    const { getSessionToRestore } = await import('./session-restore.js');
    const params = new URLSearchParams('restoreSlot=0');

    mockElectronAPI.getSessionToRestore.mockResolvedValue(null);
    expect(await getSessionToRestore(params)).toBeNull();

    mockElectronAPI.getSessionToRestore.mockResolvedValue({ tabs: [] });
    expect(await getSessionToRestore(params)).toBeNull();

    mockElectronAPI.getSessionToRestore.mockRejectedValue(new Error('boom'));
    expect(await getSessionToRestore(params)).toBeNull();

    expect(await getSessionToRestore(new URLSearchParams('restoreSlot=junk'))).toBeNull();
  });
});

describe('placeholder tabs (lazy restore in tabs.js)', () => {
  test('createPlaceholderTab adds a webview-less tab that renders persisted state', async () => {
    const { initSessionPersistence } = await import('./session-restore.js');
    initSessionPersistence(null); // isolate from the debounce tests
    const { createPlaceholderTab, getTabs } = await import('./tabs.js');

    const tab = createPlaceholderTab({
      url: 'https://example.com/',
      title: 'Example',
      pinned: true,
      faviconUrl: 'data:image/png;base64,AA',
    });

    expect(tab.isPlaceholder).toBe(true);
    expect(tab.webview).toBeNull();
    expect(tab.title).toBe('Example');
    expect(tab.pinned).toBe(true);
    expect(tab.favicon).toBe('data:image/png;base64,AA');
    expect(getTabs()).toContain(tab);
    expect(createPlaceholderTab({ url: '' })).toBeNull();
  });

  test('switchTab materializes a placeholder: internal pages load their resolved URL', async () => {
    const { createPlaceholderTab, switchTab, getActiveTab } = await import('./tabs.js');

    const tab = createPlaceholderTab({ url: 'freedom://history', title: 'History' });
    expect(tab.webview).toBeNull();

    switchTab(tab.id);

    expect(getActiveTab()).toBe(tab);
    expect(tab.isPlaceholder).toBe(false);
    expect(tab.webview).toBeTruthy();
    const srcCalls = tab.webview.setAttribute.mock.calls.filter(([attr]) => attr === 'src');
    expect(srcCalls.at(-1)?.[1]).toBe('file:///app/pages/history.html');
  });

  test('materializing a dweb placeholder parks on about:blank and routes through loadTarget', async () => {
    jest.useFakeTimers();
    try {
      const { createPlaceholderTab, switchTab, setLoadTargetHandler } = await import('./tabs.js');
      const onLoadTarget = jest.fn();
      setLoadTargetHandler(onLoadTarget);

      const tab = createPlaceholderTab({ url: 'bzz://name.eth/', title: 'Swarm site' });
      switchTab(tab.id);

      const srcCalls = tab.webview.setAttribute.mock.calls.filter(([attr]) => attr === 'src');
      expect(srcCalls.at(-1)?.[1]).toBe('about:blank');

      jest.runOnlyPendingTimers();
      expect(onLoadTarget).toHaveBeenCalledWith('bzz://name.eth/');
    } finally {
      jest.useRealTimers();
    }
  });

  test('switching to an already-materialized tab does not rebuild its webview', async () => {
    const { createPlaceholderTab, switchTab, createTab } = await import('./tabs.js');

    const tab = createPlaceholderTab({ url: 'https://keep.example/', title: 'Keep' });
    switchTab(tab.id);
    const firstWebview = tab.webview;

    const other = createTab('https://other.example/');
    switchTab(other.id);
    switchTab(tab.id);

    expect(tab.webview).toBe(firstWebview);
  });

  test('closing a placeholder tab works without a webview', async () => {
    const { createPlaceholderTab, closeTab, getTabs, createTab, switchTab } =
      await import('./tabs.js');

    // Keep another tab active so closing the placeholder doesn't close the window.
    const anchor = createTab('https://anchor.example/');
    switchTab(anchor.id);
    const tab = createPlaceholderTab({ url: 'https://gone.example/', title: 'Gone' });

    expect(() => closeTab(tab.id)).not.toThrow();
    expect(getTabs().find((t) => t.id === tab.id)).toBeUndefined();
  });
});
