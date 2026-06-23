const {
  KNOWN_SHELL_CAPABILITIES,
  SHELL_API_CAPABILITIES,
  SHELL_API_EVENTS,
  SHELL_API_EVENT_CAPABILITIES,
  SHELL_API_METHODS,
  SHELL_API_METHOD_CAPABILITIES,
  SHELL_API_VERSION,
  compareShellApiVersions,
  getRequiredCapabilityForEvent,
  getRequiredCapabilityForMethod,
  isKnownShellCapability,
  isShellApiVersionCompatible,
  parseShellApiVersion,
} = require('./shell-api-policy');

describe('shell-api-policy', () => {
  test('defines the v0 shell API version and method registry', () => {
    expect(SHELL_API_VERSION).toBe('0.1.0');
    expect(SHELL_API_METHODS).toEqual({
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
      BROWSER_STATE_PROFILES_GET_ACTIVE: 'browserState.profiles.getActive',
      BROWSER_STATE_PROFILES_LIST: 'browserState.profiles.list',
      SERVICES_GET_REGISTRY: 'services.getRegistry',
      SERVICES_GET_STATUS: 'services.getStatus',
      SERVICES_CHECK_BINARY: 'services.checkBinary',
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
      CLIPBOARD_COPY_TEXT: 'clipboard.copyText',
      CLIPBOARD_COPY_IMAGE_FROM_URL: 'clipboard.copyImageFromUrl',
      DOWNLOADS_SAVE_IMAGE: 'downloads.saveImage',
    });
    expect(Object.isFrozen(SHELL_API_METHODS)).toBe(true);
  });

  test('maps every exposed method to a known capability', () => {
    expect(SHELL_API_METHOD_CAPABILITIES).toEqual({
      getInfo: 'shell.info',
      markReady: 'shell.ready',
      resolveNavigationInput: 'navigation.resolve',
      'navigation.resolveEns': 'navigation.resolve',
      'navigation.invalidateEnsContent': 'navigation.resolve',
      'tabs.getSnapshot': 'tabs.read',
      'tabs.create': 'tabs.write',
      'tabs.close': 'tabs.write',
      'tabs.activate': 'tabs.write',
      'tabs.navigate': 'tabs.write',
      'tabs.reload': 'tabs.write',
      'tabs.goHome': 'tabs.write',
      'browserState.settings.get': 'browserState.settings.read',
      'browserState.settings.save': 'browserState.settings.write',
      'browserState.bookmarks.get': 'browserState.bookmarks.read',
      'browserState.bookmarks.add': 'browserState.bookmarks.write',
      'browserState.bookmarks.update': 'browserState.bookmarks.write',
      'browserState.bookmarks.remove': 'browserState.bookmarks.write',
      'browserState.history.get': 'browserState.history.read',
      'browserState.history.add': 'browserState.history.write',
      'browserState.favicons.getCached': 'browserState.favicons.read',
      'browserState.profiles.getActive': 'browserState.profiles.read',
      'browserState.profiles.list': 'browserState.profiles.read',
      'services.getRegistry': 'services.read',
      'services.getStatus': 'services.read',
      'services.checkBinary': 'services.read',
      'surfaces.getState': 'surfaces.wallet.control',
      'surfaces.open': 'surfaces.wallet.control',
      'surfaces.close': 'surfaces.wallet.control',
      'surfaces.toggle': 'surfaces.wallet.control',
      'trustedPrompts.requestTest': 'trustedPrompts.test',
      'app.showAbout': 'app.about',
      'app.checkForUpdates': 'app.updates',
      'app.restartAndInstallUpdate': 'app.updates',
      'windows.new': 'windows.open',
      'windows.openUrl': 'windows.open',
      'windows.setTitle': 'windows.control',
      'windows.close': 'windows.control',
      'windows.minimize': 'windows.control',
      'windows.toggleMaximize': 'windows.control',
      'windows.toggleFullscreen': 'windows.control',
      'chrome.ui.updateTabMenuState': 'chrome.ui.commands',
      'chrome.ui.setBookmarkBarToggleEnabled': 'chrome.ui.commands',
      'chrome.ui.setBookmarkBarChecked': 'chrome.ui.commands',
      'clipboard.copyText': 'clipboard.write',
      'clipboard.copyImageFromUrl': 'clipboard.write',
      'downloads.saveImage': 'downloads.saveImage',
    });

    for (const method of Object.values(SHELL_API_METHODS)) {
      const capability = getRequiredCapabilityForMethod(method);
      expect(capability).toBeTruthy();
      expect(isKnownShellCapability(capability)).toBe(true);
    }
  });

  test('defines known method and event capability registries', () => {
    expect(SHELL_API_CAPABILITIES).toEqual({
      SHELL_INFO: 'shell.info',
      SHELL_READY: 'shell.ready',
      NAVIGATION_RESOLVE: 'navigation.resolve',
      TABS_READ: 'tabs.read',
      TABS_WRITE: 'tabs.write',
      BROWSER_STATE_SETTINGS_READ: 'browserState.settings.read',
      BROWSER_STATE_SETTINGS_WRITE: 'browserState.settings.write',
      BROWSER_STATE_BOOKMARKS_READ: 'browserState.bookmarks.read',
      BROWSER_STATE_BOOKMARKS_WRITE: 'browserState.bookmarks.write',
      BROWSER_STATE_HISTORY_READ: 'browserState.history.read',
      BROWSER_STATE_HISTORY_WRITE: 'browserState.history.write',
      BROWSER_STATE_FAVICONS_READ: 'browserState.favicons.read',
      BROWSER_STATE_PROFILES_READ: 'browserState.profiles.read',
      SERVICES_READ: 'services.read',
      SURFACES_WALLET_CONTROL: 'surfaces.wallet.control',
      TRUSTED_PROMPTS_TEST: 'trustedPrompts.test',
      APP_ABOUT: 'app.about',
      APP_UPDATES: 'app.updates',
      WINDOWS_OPEN: 'windows.open',
      WINDOWS_CONTROL: 'windows.control',
      CHROME_UI_COMMANDS: 'chrome.ui.commands',
      CLIPBOARD_WRITE: 'clipboard.write',
      DOWNLOADS_SAVE_IMAGE: 'downloads.saveImage',
    });
    expect(SHELL_API_EVENTS).toEqual({
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
      BROWSER_STATE_PROFILE_UPDATED: 'browserState.profiles.updated',
      SERVICES_REGISTRY_UPDATED: 'services.registryUpdated',
      SERVICES_STATUS_UPDATED: 'services.statusUpdated',
    });
    expect(SHELL_API_EVENT_CAPABILITIES).toEqual({
      'tabs.commandResult': 'tabs.write',
      'tabs.snapshotChanged': 'tabs.read',
      'chrome.commands.closeMenus': 'chrome.ui.commands',
      'chrome.commands.focusAddressBar': 'chrome.ui.commands',
      'chrome.commands.toggleDevTools': 'chrome.ui.commands',
      'chrome.commands.closeDevTools': 'chrome.ui.commands',
      'chrome.commands.closeAllDevTools': 'chrome.ui.commands',
      'chrome.commands.newTab': 'chrome.ui.commands',
      'chrome.commands.closeTab': 'chrome.ui.commands',
      'chrome.commands.newTabWithUrl': 'chrome.ui.commands',
      'chrome.commands.navigateToUrl': 'chrome.ui.commands',
      'chrome.commands.loadUrl': 'chrome.ui.commands',
      'chrome.commands.reload': 'chrome.ui.commands',
      'chrome.commands.hardReload': 'chrome.ui.commands',
      'chrome.commands.nextTab': 'chrome.ui.commands',
      'chrome.commands.prevTab': 'chrome.ui.commands',
      'chrome.commands.moveTabLeft': 'chrome.ui.commands',
      'chrome.commands.moveTabRight': 'chrome.ui.commands',
      'chrome.commands.reopenClosedTab': 'chrome.ui.commands',
      'chrome.commands.toggleBookmarkBar': 'chrome.ui.commands',
      'browserState.profiles.updated': 'browserState.profiles.read',
      'services.registryUpdated': 'services.read',
      'services.statusUpdated': 'services.read',
    });
    expect(KNOWN_SHELL_CAPABILITIES).toEqual([
      'app.about',
      'app.updates',
      'browserState.bookmarks.read',
      'browserState.bookmarks.write',
      'browserState.favicons.read',
      'browserState.history.read',
      'browserState.history.write',
      'browserState.profiles.read',
      'browserState.settings.read',
      'browserState.settings.write',
      'chrome.ui.commands',
      'clipboard.write',
      'downloads.saveImage',
      'navigation.resolve',
      'services.read',
      'shell.info',
      'shell.ready',
      'surfaces.wallet.control',
      'tabs.read',
      'tabs.write',
      'trustedPrompts.test',
      'windows.control',
      'windows.open',
    ]);
    expect(isKnownShellCapability('wallet.export')).toBe(false);
  });

  test('maps every event capability to a declared event and known capability', () => {
    for (const [eventName, capability] of Object.entries(SHELL_API_EVENT_CAPABILITIES)) {
      expect(Object.values(SHELL_API_EVENTS)).toContain(eventName);
      expect(getRequiredCapabilityForEvent(eventName)).toBe(capability);
      expect(isKnownShellCapability(capability)).toBe(true);
    }

    expect(getRequiredCapabilityForEvent('tabs.changed')).toBeNull();
  });

  test('parses and compares shell API compatibility ranges', () => {
    expect(parseShellApiVersion('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(parseShellApiVersion('0.1.x')).toEqual({ major: 0, minor: 1, patch: 'x' });
    expect(parseShellApiVersion('nope')).toBeNull();

    expect(
      compareShellApiVersions(
        { major: 0, minor: 1, patch: 1 },
        { major: 0, minor: 1, patch: 0 }
      )
    ).toBe(1);

    expect(
      isShellApiVersionCompatible({
        minShellApi: '0.1.0',
        maxShellApi: '0.1.x',
      })
    ).toBe(true);
    expect(
      isShellApiVersionCompatible({
        minShellApi: '0.2.0',
        maxShellApi: '0.2.x',
      })
    ).toBe(false);
    expect(
      isShellApiVersionCompatible({
        minShellApi: '0.1.0',
        maxShellApi: '0.1.0',
      })
    ).toBe(true);
    expect(
      isShellApiVersionCompatible({
        minShellApi: '0.1.0',
        maxShellApi: 'invalid',
      })
    ).toBe(false);
  });
});
