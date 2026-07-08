const fs = require('fs');
const { loadMainModule } = require('../../test/helpers/main-process-test-utils');
const { SHORTCUTS, getDefaultAccelerator, getAliasAccelerators } = require('../shared/shortcuts');

function loadMenuModule(platform, options = {}) {
  let capturedTemplate = null;
  const menuInstance = {
    on: jest.fn(),
    getMenuItemById: jest.fn(),
  };
  const openOrFocusProfile = options.openOrFocusProfile || jest.fn();

  const { mod, dialog } = loadMainModule(require.resolve('./menu'), {
    electronOverrides: {
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
        getMainWindows: () => [],
        createMainWindow: jest.fn(),
      }),
      [require.resolve('./updater')]: () => ({
        checkForUpdates: jest.fn(),
        getInstallRelaunchMode: () => ({ menuLabel: 'Install Update and Restart...' }),
        isUpdateReady: () => false,
        installUpdate: jest.fn(),
      }),
      [require.resolve('./profile-resolver')]: () => ({
        getActiveProfile: () => ({ id: 'alpha', source: 'catalog', isActive: true }),
        listProfilesForActiveApp: () => [
          { id: 'alpha', displayName: 'Alpha', isActive: true },
          { id: 'beta', displayName: 'Beta' },
        ],
      }),
      [require.resolve('./profile-launcher')]: () => ({
        openOrFocusProfile,
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

  return { capturedTemplate, mod, dialog, openOrFocusProfile };
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

  test('Profiles menu lists profiles plus create/manage actions', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const { capturedTemplate } = loadMenuModule(platform);
      const profiles = findTopLabel(capturedTemplate, 'Profiles');

      expect(profiles).toBeTruthy();
      const labels = profiles.submenu.map((item) => item.label ?? item.type);
      expect(labels).toEqual(
        expect.arrayContaining(['Alpha', 'Beta', 'Create Profile...', 'Manage Profiles...'])
      );

      // Current profile is a checked + disabled checkbox; the other is a plain
      // selectable item (NOT a checkbox — macOS auto-checks checkbox items on
      // click, which would leave a phantom checkmark after switching).
      const alpha = profiles.submenu.find((item) => item.label === 'Alpha');
      const beta = profiles.submenu.find((item) => item.label === 'Beta');
      expect(alpha.type).toBe('checkbox');
      expect(alpha.checked).toBe(true);
      expect(alpha.enabled).toBe(false);
      expect(beta.type).not.toBe('checkbox');
      expect(beta.checked).toBeFalsy();
      expect(beta.enabled).not.toBe(false);
      expect(typeof beta.click).toBe('function');
    }
  });

  test('surfaces a dialog when a native-menu profile switch does not complete', async () => {
    // openOrFocusProfile resolves with { error } (it doesn't throw) when the
    // target profile is running but never acked the focus request — the native
    // menu must not swallow that.
    const openOrFocusProfile = jest.fn().mockResolvedValue({
      focused: false,
      error: 'The running profile did not respond',
    });
    const { capturedTemplate, dialog } = loadMenuModule('darwin', { openOrFocusProfile });

    const profiles = findTopLabel(capturedTemplate, 'Profiles');
    const beta = profiles.submenu.find((item) => item.label === 'Beta');

    await beta.click();

    expect(openOrFocusProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'alpha' }),
      'beta'
    );
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      'Could not switch profile',
      'The running profile did not respond'
    );
  });

  test('File menu no longer includes the profile management entry', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const { capturedTemplate } = loadMenuModule(platform);
      const file = findTopLabel(capturedTemplate, 'File');

      expect(file?.submenu?.map((item) => item.label)).not.toContain('Manage Profiles...');
    }
  });

  test('File menu offers Downloads with the Chromium-standard accelerator', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const { capturedTemplate } = loadMenuModule(platform);
      const file = findTopLabel(capturedTemplate, 'File');
      const downloads = file?.submenu?.find((item) => item.id === 'downloads');

      expect(downloads).toEqual(
        expect.objectContaining({
          label: 'Downloads',
          accelerator: 'CmdOrCtrl+Shift+J',
        })
      );
    }
  });

  test('Profiles menu sits between History and the Window menu on macOS', () => {
    const { capturedTemplate } = loadMenuModule('darwin');
    const labels = capturedTemplate.map((item) => item.label ?? item.role);
    const historyIndex = labels.indexOf('History');
    const profilesIndex = labels.indexOf('Profiles');
    const windowIndex = labels.indexOf('windowMenu');

    expect(profilesIndex).toBe(historyIndex + 1);
    expect(windowIndex).toBeGreaterThan(profilesIndex);
  });

  test('macOS template keeps appMenu and editMenu roles', () => {
    const { capturedTemplate } = loadMenuModule('darwin');

    expect(capturedTemplate.some((item) => item.role === 'appMenu')).toBe(true);
    expect(capturedTemplate.some((item) => item.role === 'editMenu')).toBe(true);
    expect(capturedTemplate.some((item) => item.role === 'windowMenu')).toBe(true);
    expect(findTopLabel(capturedTemplate, 'Edit')).toBeFalsy();
  });

  test('Edit menu carries Find in Page with CmdOrCtrl+F on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const { capturedTemplate } = loadMenuModule(platform);
      const edit = capturedTemplate.find(
        (item) => item.label === 'Edit' || item.role === 'editMenu'
      );
      const find = edit?.submenu?.find((item) => item.id === 'find-in-page');

      expect(find).toBeTruthy();
      expect(find.accelerator).toBe('CmdOrCtrl+F');
      expect(typeof find.click).toBe('function');
    }
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
});

describe('menu ↔ shortcut registry', () => {
  // Collect every explicit accelerator in a built menu template.
  function collectAccelerators(items, found = []) {
    for (const item of items || []) {
      if (item.accelerator !== undefined) {
        found.push(item.accelerator);
      }
      if (Array.isArray(item.submenu)) {
        collectAccelerators(item.submenu, found);
      }
    }
    return found;
  }

  test('menu.js carries no accelerator literals — everything resolves through the registry', () => {
    const source = fs.readFileSync(require.resolve('./menu'), 'utf-8');
    // Any accelerator assigned from a string (or template/ternary) literal
    // means a shortcut bypassed src/shared/shortcuts.js. Add the shortcut
    // to the registry and use acc()/aliasAcc() instead.
    const literalAccelerator = /accelerator:\s*(['"`]|isMac)/;
    expect(source).not.toMatch(literalAccelerator);
    expect(source).toMatch(/require\('\.\.\/shared\/shortcuts'\)/);
  });

  test('every template accelerator is a registry default or fixed alias', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const registryAccelerators = new Set();
      for (const entry of SHORTCUTS) {
        registryAccelerators.add(getDefaultAccelerator(entry, platform));
        for (const alias of getAliasAccelerators(entry, platform)) {
          registryAccelerators.add(alias);
        }
      }

      const { capturedTemplate } = loadMenuModule(platform);
      const used = collectAccelerators(capturedTemplate);
      expect(used.length).toBeGreaterThan(0);
      for (const accelerator of used) {
        expect(registryAccelerators).toContain(accelerator);
      }
    }
  });

  test('menu-context registry entries all surface in the menu template', () => {
    // Renderer-only shortcuts (context: 'renderer') have no menu item; every
    // other entry's default accelerator must appear in the built template on
    // a platform where the entry applies.
    const { capturedTemplate } = loadMenuModule('linux');
    const used = new Set(collectAccelerators(capturedTemplate));

    for (const entry of SHORTCUTS) {
      if (entry.context === 'renderer') continue;
      expect(used).toContain(getDefaultAccelerator(entry, 'linux'));
    }
  });
});
