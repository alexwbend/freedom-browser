const { loadMainModule } = require('../../test/helpers/main-process-test-utils');

function loadMenuModule(platform, options = {}) {
  let capturedTemplate = null;
  const menuInstance = {
    on: jest.fn(),
    getMenuItemById: jest.fn(),
  };
  const getMainWindows =
    typeof options.getMainWindows === 'function'
      ? options.getMainWindows
      : () => options.mainWindows || [];
  const getFocusedWindow =
    typeof options.getFocusedWindow === 'function'
      ? options.getFocusedWindow
      : () => options.focusedWindow || null;

  const { app, mod } = loadMainModule(require.resolve('./menu'), {
    electronOverrides: {
      BrowserWindow: {
        getAllWindows: jest.fn(() => options.allWindows || getMainWindows()),
        getFocusedWindow: jest.fn(() => getFocusedWindow()),
      },
      Menu: {
        buildFromTemplate: jest.fn((template) => {
          capturedTemplate = template;
          return menuInstance;
        }),
        setApplicationMenu: jest.fn(),
        getApplicationMenu: jest.fn(() => menuInstance),
      },
    },
    extraMocks: {
      [require.resolve('./windows/mainWindow')]: () => ({
        isMainBrowserWindow: () => true,
        getMainWindows,
        createMainWindow: jest.fn(),
      }),
      [require.resolve('./updater')]: () => ({
        checkForUpdates: jest.fn(),
        getInstallRelaunchMode: () => ({ menuLabel: 'Install Update and Restart...' }),
        isUpdateReady: () => false,
        installUpdate: jest.fn(),
      }),
    },
  });

  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });

  try {
    mod.setupApplicationMenu();
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }

  return { app, capturedTemplate, menuInstance, mod };
}

function findTopLabel(template, label) {
  return template.find((item) => item.label === label);
}

describe('menu', () => {
  test('Windows template omits macOS-only appMenu and windowMenu', () => {
    const { capturedTemplate } = loadMenuModule('win32');

    expect(capturedTemplate.some((item) => item.role === 'appMenu')).toBe(false);
    expect(capturedTemplate.some((item) => item.role === 'windowMenu')).toBe(false);
    expect(findTopLabel(capturedTemplate, 'File')).toBeTruthy();
    expect(findTopLabel(capturedTemplate, 'Edit')).toBeTruthy();
  });

  test('Windows and Linux place Edit immediately after File', () => {
    for (const platform of ['win32', 'linux']) {
      const { capturedTemplate } = loadMenuModule(platform);
      const labels = capturedTemplate.map((item) => item.label ?? item.role);
      const fileIndex = labels.indexOf('File');
      const editIndex = labels.indexOf('Edit');
      const viewIndex = labels.indexOf('View');

      expect(fileIndex).toBeGreaterThanOrEqual(0);
      expect(editIndex).toBe(fileIndex + 1);
      expect(viewIndex).toBeGreaterThan(editIndex);
    }
  });

  test('Linux template uses explicit Edit roles for clipboard accelerators', () => {
    const { capturedTemplate } = loadMenuModule('linux');
    const edit = findTopLabel(capturedTemplate, 'Edit');

    expect(edit?.submenu?.map((item) => item.role)).toEqual(
      expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll'])
    );
    expect(capturedTemplate.some((item) => item.role === 'appMenu')).toBe(false);
    expect(capturedTemplate.some((item) => item.role === 'windowMenu')).toBe(false);
  });

  test('File menu includes profile management entry', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const { capturedTemplate } = loadMenuModule(platform);
      const file = findTopLabel(capturedTemplate, 'File');

      expect(file?.submenu?.map((item) => item.label)).toEqual(
        expect.arrayContaining(['Manage Profiles...'])
      );
    }
  });

  test('macOS template keeps appMenu and editMenu roles', () => {
    const { capturedTemplate } = loadMenuModule('darwin');

    expect(capturedTemplate.some((item) => item.role === 'appMenu')).toBe(true);
    expect(capturedTemplate.some((item) => item.role === 'editMenu')).toBe(true);
    expect(capturedTemplate.some((item) => item.role === 'windowMenu')).toBe(true);
    expect(findTopLabel(capturedTemplate, 'Edit')).toBeFalsy();
  });

  test('macOS places editMenu immediately after File', () => {
    const { capturedTemplate } = loadMenuModule('darwin');
    const labels = capturedTemplate.map((item) => item.label ?? item.role);
    const fileIndex = labels.indexOf('File');
    const editIndex = labels.indexOf('editMenu');
    const viewIndex = labels.indexOf('View');

    expect(fileIndex).toBeGreaterThanOrEqual(0);
    expect(editIndex).toBe(fileIndex + 1);
    expect(viewIndex).toBeGreaterThan(editIndex);
  });

  test('applies renderer tab and bookmark-bar state to native menu items', () => {
    const { menuInstance, mod } = loadMenuModule('linux');
    const items = new Map(
      [
        'reload',
        'next-tab',
        'prev-tab',
        'move-tab-right',
        'move-tab-left',
        'reopen-closed-tab',
        'toggle-devtools',
        'toggle-bookmark-bar',
      ].map((id) => [id, { id, enabled: true, checked: false }])
    );
    menuInstance.getMenuItemById.mockImplementation((id) => items.get(id) || null);

    expect(
      mod.applyTabMenuState({ tabCount: 2, activeIndex: 0, hasClosedTabs: true })
    ).toBe(true);

    expect(items.get('reload').enabled).toBe(true);
    expect(items.get('next-tab').enabled).toBe(true);
    expect(items.get('prev-tab').enabled).toBe(true);
    expect(items.get('move-tab-right').enabled).toBe(true);
    expect(items.get('move-tab-left').enabled).toBe(false);
    expect(items.get('reopen-closed-tab').enabled).toBe(true);
    expect(items.get('toggle-devtools').enabled).toBe(true);

    expect(mod.setBookmarkBarToggleEnabled(false)).toBe(true);
    expect(items.get('toggle-bookmark-bar').enabled).toBe(false);

    expect(mod.setBookmarkBarChecked(true)).toBe(true);
    expect(items.get('toggle-bookmark-bar').checked).toBe(true);
  });

  test('keeps package chrome menu state scoped to the focused browser window', () => {
    let focusedWindow = null;
    const createWindow = (id) => {
      const handlers = new Map();
      const window = {
        id,
        isDestroyed: jest.fn(() => false),
        isFocused: jest.fn(() => focusedWindow === window),
        on: jest.fn((event, handler) => {
          handlers.set(event, handler);
        }),
        emit(event) {
          handlers.get(event)?.();
        },
      };
      return window;
    };
    const firstWindow = createWindow(1);
    const secondWindow = createWindow(2);
    focusedWindow = firstWindow;

    const { app, menuInstance, mod } = loadMenuModule('linux', {
      allWindows: [firstWindow, secondWindow],
      getFocusedWindow: () => focusedWindow,
      getMainWindows: () => [firstWindow, secondWindow],
    });
    const items = new Map(
      [
        'reload',
        'next-tab',
        'prev-tab',
        'move-tab-right',
        'move-tab-left',
        'reopen-closed-tab',
        'toggle-devtools',
        'toggle-bookmark-bar',
      ].map((id) => [id, { id, enabled: true, checked: false }])
    );
    menuInstance.getMenuItemById.mockImplementation((id) => items.get(id) || null);

    app.emit('browser-window-created', {}, firstWindow);
    app.emit('browser-window-created', {}, secondWindow);

    expect(mod.setBookmarkBarToggleEnabled(true, firstWindow)).toBe(true);
    expect(mod.setBookmarkBarChecked(true, firstWindow)).toBe(true);
    expect(mod.applyTabMenuState({ tabCount: 2, activeIndex: 1 }, firstWindow)).toBe(true);
    expect(items.get('toggle-bookmark-bar')).toMatchObject({
      enabled: true,
      checked: true,
    });
    expect(items.get('move-tab-left').enabled).toBe(true);

    expect(mod.setBookmarkBarToggleEnabled(false, secondWindow)).toBe(true);
    expect(mod.setBookmarkBarChecked(false, secondWindow)).toBe(true);
    expect(mod.applyTabMenuState({ tabCount: 1, activeIndex: 0 }, secondWindow)).toBe(true);
    expect(items.get('toggle-bookmark-bar')).toMatchObject({
      enabled: true,
      checked: true,
    });
    expect(items.get('move-tab-left').enabled).toBe(true);

    focusedWindow = secondWindow;
    secondWindow.emit('focus');
    expect(items.get('toggle-bookmark-bar')).toMatchObject({
      enabled: false,
      checked: false,
    });
    expect(items.get('move-tab-left').enabled).toBe(false);

    focusedWindow = firstWindow;
    secondWindow.emit('closed');
    expect(items.get('toggle-bookmark-bar')).toMatchObject({
      enabled: true,
      checked: true,
    });
    expect(items.get('move-tab-left').enabled).toBe(true);
  });
});
