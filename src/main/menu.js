const log = require('./logger');
const { BrowserWindow, Menu, app, ipcMain } = require('electron');
const { isMainBrowserWindow, getMainWindows, createMainWindow } = require('./windows/mainWindow');
const { emitShellEventToPackageWebContents } = require('./shell-api');
const { SHELL_API_EVENTS } = require('../shared/shell-api-policy');
const {
  checkForUpdates,
  getInstallRelaunchMode,
  isUpdateReady,
  installUpdate,
} = require('./updater');

const windowMenuState = new WeakMap();

function getLiveMainWindows() {
  return getMainWindows().filter((win) => !win?.isDestroyed?.());
}

// Helper to get the best target window for tab operations
// Only returns main browser windows we created (not DevTools or other system windows)
function getTargetWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && isMainBrowserWindow(focused) && !focused.isDestroyed?.()) {
    return focused;
  }
  const mainWindows = getLiveMainWindows();
  return mainWindows[0] || null;
}

function openProfilesManager() {
  const win = getTargetWindow();
  if (win) {
    sendChromeCommand(
      win,
      'tab:new-with-url',
      ['freedom://settings/profiles'],
      SHELL_API_EVENTS.CHROME_NEW_TAB_WITH_URL_REQUESTED,
      { url: 'freedom://settings/profiles' }
    );
    return;
  }
  createMainWindow('freedom://settings/profiles');
}

let newTabMenuItem = null;
let closeTabMenuItem = null;
let toggleBookmarkBarMenuItem = null;
let isFullScreen = false;

function getChromeCommandWebContents(win) {
  const chromeWebContents =
    win?.__freedomShellWindow?.getChromeWebContents?.() || win?.webContents || null;
  if (!chromeWebContents || chromeWebContents.isDestroyed?.()) {
    return null;
  }
  return chromeWebContents;
}

function sendChromeCommand(win, legacyChannel, legacyArgs = [], shellEventName = null, data = {}) {
  const targetWebContents = getChromeCommandWebContents(win);
  if (!targetWebContents) {
    return false;
  }

  if (shellEventName) {
    const delivery = emitShellEventToPackageWebContents(targetWebContents, shellEventName, data);
    if (delivery.delivered || delivery.reason !== 'not-package') {
      return delivery.delivered;
    }
  }

  targetWebContents.send(legacyChannel, ...legacyArgs);
  return true;
}

function updateTabMenuItems() {
  const hasWindows = BrowserWindow.getAllWindows().length > 0;
  if (newTabMenuItem) newTabMenuItem.enabled = hasWindows;
  if (closeTabMenuItem) closeTabMenuItem.enabled = hasWindows;
}

function buildAppMenuSubmenu(updateMenuItems) {
  return [
    { role: 'about' },
    { type: 'separator' },
    ...updateMenuItems,
    { type: 'separator' },
    { role: 'services' },
    { type: 'separator' },
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' },
  ];
}

function buildFileSubmenu(isMac) {
  const submenu = [
    {
      id: 'new-tab',
      label: 'New Tab',
      accelerator: 'CmdOrCtrl+T',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(win, 'tab:new', [], SHELL_API_EVENTS.CHROME_NEW_TAB_REQUESTED);
        }
      },
    },
    {
      id: 'close-tab',
      label: 'Close Tab',
      accelerator: 'CmdOrCtrl+W',
      click: () => {
        const mainWindows = getMainWindows();
        const focusedMainWindow = mainWindows.find((win) => win.isFocused());

        if (focusedMainWindow) {
          sendChromeCommand(
            focusedMainWindow,
            'tab:close',
            [],
            SHELL_API_EVENTS.CHROME_CLOSE_TAB_REQUESTED
          );
        }
        // If no main window is focused (DevTools has focus), do nothing.
        // User can close DevTools with the X button or Cmd+Option+I
      },
    },
  ];

  if (!isMac) {
    submenu.push({
      label: 'Close Tab',
      accelerator: 'Ctrl+F4',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(win, 'tab:close', [], SHELL_API_EVENTS.CHROME_CLOSE_TAB_REQUESTED);
        }
      },
    });
  }

  submenu.push(
    {
      id: 'reopen-closed-tab',
      label: 'Reopen Closed Tab',
      accelerator: 'CmdOrCtrl+Shift+T',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(
            win,
            'tab:reopen-closed',
            [],
            SHELL_API_EVENTS.CHROME_REOPEN_CLOSED_TAB_REQUESTED
          );
        }
      },
    },
    { type: 'separator' },
    {
      label: 'New Window',
      accelerator: 'CmdOrCtrl+N',
      click: () => {
        log.info('[menu] New Window clicked');
        createMainWindow();
      },
    },
    {
      label: 'Manage Profiles...',
      click: () => {
        log.info('[menu] Manage Profiles clicked');
        openProfilesManager();
      },
    },
    { type: 'separator' },
    { role: 'close' }
  );

  if (!isMac) {
    submenu.push({ type: 'separator' }, { role: 'quit' });
  }

  return submenu;
}

function buildViewSubmenu({ isFullScreen: fullScreen, showAppDevtools }) {
  const submenu = [
    {
      id: 'reload',
      label: 'Reload This Page',
      accelerator: 'CmdOrCtrl+R',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(win, 'page:reload', [], SHELL_API_EVENTS.CHROME_RELOAD_REQUESTED);
        }
      },
    },
    {
      label: 'Force Reload This Page',
      accelerator: 'CmdOrCtrl+Shift+R',
      visible: false,
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(
            win,
            'page:hard-reload',
            [],
            SHELL_API_EVENTS.CHROME_HARD_RELOAD_REQUESTED
          );
        }
      },
    },
    { type: 'separator' },
    {
      id: 'focus-address-bar',
      label: 'Focus Address Bar',
      accelerator: 'CmdOrCtrl+L',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(win, 'menus:close', [], SHELL_API_EVENTS.CHROME_CLOSE_MENUS_REQUESTED);
          sendChromeCommand(
            win,
            'focus:address-bar',
            [],
            SHELL_API_EVENTS.CHROME_FOCUS_ADDRESS_BAR_REQUESTED
          );
        }
      },
    },
    { type: 'separator' },
    {
      id: 'fullscreen',
      label: fullScreen ? 'Exit Full Screen' : 'Enter Full Screen',
      accelerator: 'F11',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          win.setFullScreen(!win.isFullScreen());
        }
      },
    },
    { type: 'separator' },
    {
      id: 'next-tab',
      label: 'Next Tab',
      accelerator: 'Ctrl+PageDown',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(win, 'tab:next', [], SHELL_API_EVENTS.CHROME_NEXT_TAB_REQUESTED);
        }
      },
    },
    {
      id: 'prev-tab',
      label: 'Previous Tab',
      accelerator: 'Ctrl+PageUp',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(win, 'tab:prev', [], SHELL_API_EVENTS.CHROME_PREV_TAB_REQUESTED);
        }
      },
    },
    {
      id: 'move-tab-right',
      label: 'Move Tab Right',
      accelerator: 'Ctrl+Shift+PageDown',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(
            win,
            'tab:move-right',
            [],
            SHELL_API_EVENTS.CHROME_MOVE_TAB_RIGHT_REQUESTED
          );
        }
      },
    },
    {
      id: 'move-tab-left',
      label: 'Move Tab Left',
      accelerator: 'Ctrl+Shift+PageUp',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(
            win,
            'tab:move-left',
            [],
            SHELL_API_EVENTS.CHROME_MOVE_TAB_LEFT_REQUESTED
          );
        }
      },
    },
    { type: 'separator' },
    {
      id: 'toggle-bookmark-bar',
      label: 'Always Show Bookmarks Bar',
      type: 'checkbox',
      checked: false,
      accelerator: 'CmdOrCtrl+Shift+B',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(
            win,
            'bookmarks:toggle-bar',
            [],
            SHELL_API_EVENTS.CHROME_TOGGLE_BOOKMARK_BAR_REQUESTED
          );
        }
      },
    },
    { type: 'separator' },
    {
      id: 'toggle-devtools',
      label: 'Developer Tools',
      accelerator: 'CmdOrCtrl+Alt+I',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(
            win,
            'devtools:toggle',
            [],
            SHELL_API_EVENTS.CHROME_TOGGLE_DEVTOOLS_REQUESTED
          );
        }
      },
    },
  ];

  if (showAppDevtools) {
    submenu.push({
      id: 'toggle-app-devtools',
      label: 'App Developer Tools',
      accelerator: 'CmdOrCtrl+Shift+Alt+I',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          win.webContents.toggleDevTools();
        }
      },
    });
  }

  return submenu;
}

function buildHistorySubmenu(isMac) {
  return [
    {
      label: 'Show All History',
      accelerator: isMac ? 'Cmd+Y' : 'Ctrl+H',
      click: () => {
        const win = getTargetWindow();
        if (win) {
          sendChromeCommand(
            win,
            'tab:new-with-url',
            ['freedom://history'],
            SHELL_API_EVENTS.CHROME_NEW_TAB_WITH_URL_REQUESTED,
            { url: 'freedom://history' }
          );
        }
      },
    },
  ];
}

function buildEditMenuEntry(isMac) {
  if (isMac) {
    return { role: 'editMenu' };
  }

  return {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' },
    ],
  };
}

function buildSharedMenuEntries(ctx) {
  const { isMac, isFullScreen: fullScreen, isPackaged } = ctx;

  return [
    { label: 'File', submenu: buildFileSubmenu(isMac) },
    buildEditMenuEntry(isMac),
    {
      label: 'View',
      submenu: buildViewSubmenu({
        isFullScreen: fullScreen,
        showAppDevtools: !isPackaged,
      }),
    },
    { label: 'History', submenu: buildHistorySubmenu(isMac) },
  ];
}

function buildDarwinMenuTemplate(ctx) {
  return [
    { role: 'appMenu', submenu: buildAppMenuSubmenu(ctx.updateMenuItems) },
    ...buildSharedMenuEntries(ctx),
    { role: 'windowMenu' },
  ];
}

function buildWinLinuxMenuTemplate(ctx) {
  return buildSharedMenuEntries(ctx);
}

function buildApplicationMenuTemplate({
  platform = process.platform,
  updateMenuItems,
  isFullScreen: fullScreen = false,
  isPackaged = app.isPackaged,
} = {}) {
  const ctx = {
    platform,
    updateMenuItems,
    isMac: platform === 'darwin',
    isFullScreen: fullScreen,
    isPackaged,
  };

  return ctx.isMac ? buildDarwinMenuTemplate(ctx) : buildWinLinuxMenuTemplate(ctx);
}

function setupApplicationMenu() {
  const updateReady = isUpdateReady();

  const updateMenuItems = updateReady
    ? [
        {
          label: getInstallRelaunchMode().menuLabel,
          click: () => {
            installUpdate();
          },
        },
        {
          label: 'Check for Updates...',
          enabled: false,
        },
      ]
    : [
        {
          label: 'Check for Updates...',
          click: () => {
            checkForUpdates();
          },
        },
      ];

  const template = buildApplicationMenuTemplate({
    updateMenuItems,
    isFullScreen,
    isPackaged: app.isPackaged,
  });
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Close renderer menus when system menu opens
  menu.on('menu-will-show', () => {
    const windows = getMainWindows();
    windows.forEach((win) => {
      sendChromeCommand(win, 'menus:close', [], SHELL_API_EVENTS.CHROME_CLOSE_MENUS_REQUESTED);
    });
  });

  // Store references to menu items for dynamic enable/disable
  newTabMenuItem = menu.getMenuItemById('new-tab');
  closeTabMenuItem = menu.getMenuItemById('close-tab');
  toggleBookmarkBarMenuItem = menu.getMenuItemById('toggle-bookmark-bar');
  updateTabMenuItems();
}

function applyTabMenuStateToApplicationMenu(state = {}) {
  const menu = Menu.getApplicationMenu();
  if (!menu) return false;

  const { tabCount, activeIndex, hasClosedTabs } = state || {};
  const hasMultipleTabs = tabCount > 1;
  const hasTabs = tabCount > 0;

  const setEnabled = (id, enabled) => {
    const item = menu.getMenuItemById(id);
    if (item) item.enabled = enabled;
  };

  setEnabled('reload', hasTabs);
  setEnabled('next-tab', hasMultipleTabs);
  setEnabled('prev-tab', hasMultipleTabs);
  setEnabled('move-tab-right', hasMultipleTabs && activeIndex < tabCount - 1);
  setEnabled('move-tab-left', hasMultipleTabs && activeIndex > 0);
  setEnabled('reopen-closed-tab', hasClosedTabs);
  setEnabled('toggle-devtools', hasTabs);
  return true;
}

function shouldApplyWindowMenuState(window) {
  if (!window || window.isDestroyed?.()) {
    return false;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && isMainBrowserWindow(focused) && !focused.isDestroyed?.()) {
    return focused === window;
  }
  return window.isFocused?.() === true;
}

function getOrCreateWindowMenuState(window) {
  if (!window || window.isDestroyed?.()) {
    return null;
  }
  const existing = windowMenuState.get(window) || {};
  windowMenuState.set(window, existing);
  return existing;
}

function applyWindowMenuState(window) {
  if (!window || window.isDestroyed?.()) {
    return false;
  }
  const state = windowMenuState.get(window);
  if (!state) {
    return false;
  }
  let applied = false;
  if (state.tabMenuState) {
    applied = applyTabMenuStateToApplicationMenu(state.tabMenuState) || applied;
  }
  if (state.bookmarkBarToggleEnabled !== undefined) {
    applied =
      setBookmarkBarToggleEnabledOnApplicationMenu(state.bookmarkBarToggleEnabled) || applied;
  }
  if (state.bookmarkBarChecked !== undefined) {
    applied = setBookmarkBarCheckedOnApplicationMenu(state.bookmarkBarChecked) || applied;
  }
  return applied;
}

function applyFocusedWindowMenuState() {
  const focused = getTargetWindow();
  if (focused) {
    return applyWindowMenuState(focused);
  }
  updateTabMenuItems();
  return false;
}

function applyTabMenuState(state = {}, ownerWindow = null) {
  if (!ownerWindow) {
    return applyTabMenuStateToApplicationMenu(state);
  }
  const windowState = getOrCreateWindowMenuState(ownerWindow);
  if (!windowState) {
    return false;
  }
  windowState.tabMenuState = { ...state };
  if (!shouldApplyWindowMenuState(ownerWindow)) {
    return true;
  }
  return applyTabMenuStateToApplicationMenu(windowState.tabMenuState);
}

function getBookmarkBarToggleMenuItem() {
  if (toggleBookmarkBarMenuItem) {
    return toggleBookmarkBarMenuItem;
  }
  return Menu.getApplicationMenu()?.getMenuItemById('toggle-bookmark-bar') || null;
}

function setBookmarkBarToggleEnabledOnApplicationMenu(enabled) {
  const item = getBookmarkBarToggleMenuItem();
  if (!item) {
    return false;
  }
  item.enabled = Boolean(enabled);
  return true;
}

function setBookmarkBarToggleEnabled(enabled, ownerWindow = null) {
  if (!ownerWindow) {
    return setBookmarkBarToggleEnabledOnApplicationMenu(enabled);
  }
  const windowState = getOrCreateWindowMenuState(ownerWindow);
  if (!windowState) {
    return false;
  }
  windowState.bookmarkBarToggleEnabled = Boolean(enabled);
  if (!shouldApplyWindowMenuState(ownerWindow)) {
    return true;
  }
  return setBookmarkBarToggleEnabledOnApplicationMenu(windowState.bookmarkBarToggleEnabled);
}

function setBookmarkBarCheckedOnApplicationMenu(checked) {
  const item = getBookmarkBarToggleMenuItem();
  if (!item) {
    return false;
  }
  item.checked = Boolean(checked);
  return true;
}

function setBookmarkBarChecked(checked, ownerWindow = null) {
  if (!ownerWindow) {
    return setBookmarkBarCheckedOnApplicationMenu(checked);
  }
  const windowState = getOrCreateWindowMenuState(ownerWindow);
  if (!windowState) {
    return false;
  }
  windowState.bookmarkBarChecked = Boolean(checked);
  if (!shouldApplyWindowMenuState(ownerWindow)) {
    return true;
  }
  return setBookmarkBarCheckedOnApplicationMenu(windowState.bookmarkBarChecked);
}

// Receive tab state updates from the bundled renderer and apply to menu items immediately
ipcMain.on('menu:update-tab-state', (event, state) => {
  applyTabMenuState(state, event?.sender?.getOwnerBrowserWindow?.() || null);
});

// Track fullscreen state changes from any window to update menu label
app.on('browser-window-created', (_event, win) => {
  win.on('enter-full-screen', () => updateFullscreenMenuItem(true));
  win.on('leave-full-screen', () => updateFullscreenMenuItem(false));
  win.on('focus', () => applyWindowMenuState(win));
  win.on('closed', () => {
    windowMenuState.delete(win);
    applyFocusedWindowMenuState();
  });
});

// Allow renderer to enable/disable the bookmark bar toggle menu item
ipcMain.on('menu:set-bookmark-bar-toggle-enabled', (event, enabled) => {
  setBookmarkBarToggleEnabled(enabled, event?.sender?.getOwnerBrowserWindow?.() || null);
});

// Allow renderer to update the bookmark bar checked state
ipcMain.on('menu:set-bookmark-bar-checked', (event, checked) => {
  setBookmarkBarChecked(checked, event?.sender?.getOwnerBrowserWindow?.() || null);
});

function updateFullscreenMenuItem(newIsFullScreen) {
  if (isFullScreen !== newIsFullScreen) {
    isFullScreen = newIsFullScreen;
    setupApplicationMenu();
  }
}

module.exports = {
  applyTabMenuState,
  buildApplicationMenuTemplate,
  sendChromeCommand,
  setBookmarkBarChecked,
  setBookmarkBarToggleEnabled,
  setupApplicationMenu,
  updateTabMenuItems,
  updateFullscreenMenuItem,
};
