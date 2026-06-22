const { createShellTabRegistry } = require('./shell-tabs');

describe('shell-tabs', () => {
  test('starts with one active home tab snapshot', () => {
    const registry = createShellTabRegistry({ homeUrl: 'freedom://home' });

    expect(registry.getSnapshot()).toEqual({
      version: 1,
      activeTabId: 1,
      tabs: [
        {
          id: 1,
          url: 'freedom://home',
          title: 'New Tab',
          isActive: true,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
        },
      ],
    });
  });

  test('creates, navigates, activates, homes, reloads, and closes tabs', () => {
    const registry = createShellTabRegistry({ homeUrl: 'freedom://home' });

    const created = registry.createTab({ url: 'https://example.com', title: 'Example' });
    expect(created).toMatchObject({
      ok: true,
      commandId: 'tab-command-1',
      command: 'tabs.create',
      tabId: 2,
      snapshotChanged: true,
      snapshot: {
        activeTabId: 2,
      },
    });
    expect(created.snapshot.tabs).toHaveLength(2);

    const navigated = registry.navigateTab({ tabId: 2, url: 'https://example.org/path' });
    expect(navigated).toMatchObject({
      ok: true,
      commandId: 'tab-command-2',
      command: 'tabs.navigate',
      tabId: 2,
      url: 'https://example.org/path',
      snapshotChanged: true,
      snapshot: {
        tabs: expect.arrayContaining([
          expect.objectContaining({ id: 2, url: 'https://example.org/path' }),
        ]),
      },
    });

    expect(registry.activateTab({ tabId: 1 })).toMatchObject({
      ok: true,
      command: 'tabs.activate',
      tabId: 1,
      snapshot: {
        activeTabId: 1,
      },
    });

    expect(registry.goHome({ tabId: 2 })).toMatchObject({
      ok: true,
      command: 'tabs.goHome',
      tabId: 2,
      url: 'freedom://home',
    });
    expect(registry.reloadTab({ tabId: 2 })).toMatchObject({
      ok: true,
      command: 'tabs.reload',
      tabId: 2,
      url: 'freedom://home',
      snapshotChanged: false,
    });
    expect(registry.closeTab({ tabId: 2 })).toMatchObject({
      ok: true,
      command: 'tabs.close',
      tabId: 2,
      snapshot: {
        activeTabId: 1,
        tabs: [expect.objectContaining({ id: 1 })],
      },
    });
  });

  test('fails invalid commands without mutating snapshot', () => {
    const registry = createShellTabRegistry({ homeUrl: 'freedom://home' });
    const initialSnapshot = registry.getSnapshot();

    expect(registry.createTab('bad')).toMatchObject({
      ok: false,
      error: {
        code: 'TAB_COMMAND_OPTIONS_INVALID',
      },
      snapshotChanged: false,
      snapshot: initialSnapshot,
    });
    expect(registry.navigateTab({ tabId: 1, url: {} })).toMatchObject({
      ok: false,
      error: {
        code: 'TAB_URL_INVALID',
      },
      snapshotChanged: false,
      snapshot: initialSnapshot,
    });
    expect(registry.activateTab({ tabId: 99 })).toMatchObject({
      ok: false,
      error: {
        code: 'TAB_NOT_FOUND',
        tabId: 99,
      },
      snapshotChanged: false,
      snapshot: initialSnapshot,
    });
    expect(registry.closeTab({ tabId: 1 })).toMatchObject({
      ok: false,
      error: {
        code: 'TAB_CLOSE_LAST_UNSUPPORTED',
      },
      snapshotChanged: false,
      snapshot: initialSnapshot,
    });
  });
});
