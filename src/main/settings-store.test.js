const fs = require('fs');
const path = require('path');
const IPC = require('../shared/ipc-channels');
const {
  createIpcMainMock,
  createTempUserDataDir,
  loadMainModule,
  removeTempUserDataDir,
} = require('../../test/helpers/main-process-test-utils');

function loadSettingsStore(options = {}) {
  return loadMainModule(require.resolve('./settings-store'), {
    ...options,
    extraMocks: {
      ...(options.extraMocks || {}),
      [require.resolve('./logger')]: () => ({
        error: jest.fn(),
      }),
    },
  });
}

describe('settings-store', () => {
  let userDataDir;

  beforeEach(() => {
    userDataDir = createTempUserDataDir();
  });

  afterEach(() => {
    removeTempUserDataDir(userDataDir);
  });

  test('loads defaults and applies the system theme when no file exists', () => {
    const { mod, nativeTheme } = loadSettingsStore({
      userDataDir,
      nativeTheme: { themeSource: 'system', shouldUseDarkColors: true },
    });

    expect(mod.loadSettings()).toEqual(
      expect.objectContaining({
        theme: 'system',
        enableRadicleIntegration: false,
        enableIdentityWallet: true,
        antNodeMode: 'ultraLight',
        startAntAtLaunch: true,
        startIpfsAtLaunch: true,
        startRadicleAtLaunch: false,
        autoUpdate: true,
        showBookmarkBar: false,
        sidebarOpen: false,
        sidebarWidth: 320,
        walletSurfaceLayoutMode: 'dock',
        blockUnverifiedEns: true,
      })
    );
    expect(nativeTheme.themeSource).toBe('system');
    expect(mod.getShellTheme()).toEqual({
      mode: 'system',
      effective: 'dark',
    });
  });

  test('merges persisted settings with defaults and applies the saved theme', () => {
    fs.writeFileSync(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({ theme: 'dark', autoUpdate: false, antNodeMode: 'light' }),
      'utf-8'
    );

    const { mod, nativeTheme } = loadSettingsStore({ userDataDir });

    expect(mod.loadSettings()).toEqual(
      expect.objectContaining({
        theme: 'dark',
        autoUpdate: false,
        antNodeMode: 'light',
        startAntAtLaunch: true,
        showBookmarkBar: false,
      })
    );
    expect(nativeTheme.themeSource).toBe('dark');
    expect(mod.getSettingsWithShellTheme()).toEqual(
      expect.objectContaining({
        theme: 'dark',
        shellTheme: {
          mode: 'dark',
          effective: 'dark',
        },
      })
    );
  });

  test('migrates bee-era keys to ant-named keys and drops the old keys', () => {
    const settingsPath = path.join(userDataDir, 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ theme: 'dark', beeNodeMode: 'light', startBeeAtLaunch: false }),
      'utf-8'
    );

    const { mod } = loadSettingsStore({ userDataDir });

    const loaded = mod.loadSettings();
    expect(loaded.antNodeMode).toBe('light');
    expect(loaded.startAntAtLaunch).toBe(false);
    expect(loaded).not.toHaveProperty('beeNodeMode');
    expect(loaded).not.toHaveProperty('startBeeAtLaunch');

    // Live file is rewritten with the new keys and no old keys.
    const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(persisted.antNodeMode).toBe('light');
    expect(persisted.startAntAtLaunch).toBe(false);
    expect(persisted).not.toHaveProperty('beeNodeMode');
    expect(persisted).not.toHaveProperty('startBeeAtLaunch');
  });

  test('does not overwrite an ant-named key already present when migrating', () => {
    fs.writeFileSync(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({ beeNodeMode: 'light', antNodeMode: 'ultraLight' }),
      'utf-8'
    );

    const { mod } = loadSettingsStore({ userDataDir });

    expect(mod.loadSettings().antNodeMode).toBe('ultraLight');
  });

  test('falls back to defaults when the settings file is invalid', () => {
    fs.writeFileSync(path.join(userDataDir, 'settings.json'), '{not-valid-json', 'utf-8');

    const { mod, nativeTheme } = loadSettingsStore({ userDataDir });

    expect(mod.loadSettings()).toEqual(
      expect.objectContaining({
        theme: 'system',
        antNodeMode: 'ultraLight',
        autoUpdate: true,
      })
    );
    expect(nativeTheme.themeSource).toBe('system');
  });

  test('saveSettings persists a merged payload and updates the theme', () => {
    const { mod, nativeTheme } = loadSettingsStore({ userDataDir });

    expect(mod.saveSettings({ theme: 'light', autoUpdate: false, antNodeMode: 'light' })).toBe(
      true
    );

    expect(
      JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf-8'))
    ).toEqual(
      expect.objectContaining({
        theme: 'light',
        autoUpdate: false,
        antNodeMode: 'light',
        startAntAtLaunch: true,
      })
    );
    expect(nativeTheme.themeSource).toBe('light');
  });

  test('saveSettings broadcasts settings:updated to all webContents', () => {
    const send = jest.fn();
    const webContents = {
      getAllWebContents: jest.fn(() => [{ send }, { send }]),
    };
    const { mod } = loadSettingsStore({ userDataDir, webContents });

    expect(mod.saveSettings({ theme: 'light' })).toBe(true);

    expect(webContents.getAllWebContents).toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      IPC.SETTINGS_UPDATED,
      expect.objectContaining({
        theme: 'light',
        shellTheme: {
          mode: 'light',
          effective: 'light',
        },
      })
    );
  });

  test('saveSettings notifies settings subscribers with derived shell theme', () => {
    const { mod } = loadSettingsStore({ userDataDir });
    const listener = jest.fn();
    const unsubscribe = mod.onSettingsUpdated(listener);

    expect(mod.saveSettings({ theme: 'dark' })).toBe(true);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: 'dark',
        shellTheme: {
          mode: 'dark',
          effective: 'dark',
        },
      })
    );

    listener.mockClear();
    unsubscribe();
    expect(mod.saveSettings({ theme: 'light' })).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  test('broadcasts system theme effective changes from nativeTheme updates', () => {
    const send = jest.fn();
    const nativeThemeListeners = {};
    const nativeTheme = {
      themeSource: 'system',
      shouldUseDarkColors: false,
      on: jest.fn((eventName, listener) => {
        nativeThemeListeners[eventName] = listener;
      }),
    };
    const webContents = {
      getAllWebContents: jest.fn(() => [{ send }]),
    };
    const { mod } = loadSettingsStore({ userDataDir, nativeTheme, webContents });

    mod.loadSettings();
    expect(nativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function));

    nativeTheme.shouldUseDarkColors = true;
    nativeThemeListeners.updated();

    expect(send).toHaveBeenCalledWith(
      IPC.SETTINGS_UPDATED,
      expect.objectContaining({
        shellTheme: {
          mode: 'system',
          effective: 'dark',
        },
      })
    );
  });

  test('saveSettings is a no-op when the merged payload is unchanged', () => {
    fs.writeFileSync(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({ theme: 'dark', autoUpdate: true }),
      'utf-8'
    );
    const send = jest.fn();
    const webContents = {
      getAllWebContents: jest.fn(() => [{ send }]),
    };
    const { mod } = loadSettingsStore({ userDataDir, webContents });
    mod.loadSettings();

    const filePath = path.join(userDataDir, 'settings.json');
    const sizeBefore = fs.statSync(filePath).size;

    expect(mod.saveSettings({ theme: 'dark' })).toBe(true);

    expect(send).not.toHaveBeenCalled();
    expect(fs.statSync(filePath).size).toBe(sizeBefore);
  });

  test('saveSettings drops keys that are not part of DEFAULT_SETTINGS', () => {
    const { mod } = loadSettingsStore({ userDataDir });

    expect(mod.saveSettings({ theme: 'light', injected: 'value', extra: 1 })).toBe(true);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf-8')
    );
    expect(persisted.theme).toBe('light');
    expect(persisted).not.toHaveProperty('injected');
    expect(persisted).not.toHaveProperty('extra');
  });

  test('savePackageSettings persists only package-safe browser UI keys', () => {
    const { mod } = loadSettingsStore({ userDataDir });

    expect(
      mod.savePackageSettings({
        theme: 'dark',
        showBookmarkBar: true,
        blockUnverifiedEns: false,
        sidebarWidth: 512.7,
        walletSurfaceLayoutMode: 'overlay',
        antNodeMode: 'light',
        enableIdentityWallet: false,
        autoUpdate: false,
      })
    ).toBe(true);

    expect(mod.loadSettings()).toEqual(
      expect.objectContaining({
        theme: 'dark',
        showBookmarkBar: true,
        blockUnverifiedEns: false,
        sidebarWidth: 512,
        walletSurfaceLayoutMode: 'dock',
        antNodeMode: 'ultraLight',
        enableIdentityWallet: true,
        autoUpdate: true,
      })
    );
  });

  test('package-hosted settings IPC reports restricted mode and filters saves', async () => {
    const ipcMain = createIpcMainMock();
    const packageEvent = { sender: { hostWebContents: { id: 10 } } };
    const { mod } = loadSettingsStore({
      userDataDir,
      ipcMain,
      extraMocks: {
        [require.resolve('./package-hosted-internal-page')]: () => ({
          isPackageHostedInternalPage: jest.fn((event) => event === packageEvent),
        }),
      },
    });

    mod.registerSettingsIpc();

    const packageSettings = ipcMain.handlers.get(IPC.SETTINGS_GET)(packageEvent);
    expect(packageSettings).toEqual(
      expect.objectContaining({
        packageHosted: true,
        packageWritableSettings: expect.arrayContaining(['theme', 'showBookmarkBar']),
        shellTheme: {
          mode: 'system',
          effective: 'light',
        },
      })
    );
    expect(packageSettings.packageWritableSettings).not.toContain('walletSurfaceLayoutMode');

    expect(
      ipcMain.handlers.get(IPC.SETTINGS_SAVE)(packageEvent, {
        theme: 'light',
        showBookmarkBar: true,
        antNodeMode: 'light',
        enableIdentityWallet: false,
      })
    ).toBe(true);

    expect(mod.loadSettings()).toEqual(
      expect.objectContaining({
        theme: 'light',
        showBookmarkBar: true,
        antNodeMode: 'ultraLight',
        enableIdentityWallet: true,
      })
    );
  });

  test('saveSettings swallows send errors from destroyed webContents', () => {
    const webContents = {
      getAllWebContents: jest.fn(() => [
        {
          send: () => {
            throw new Error('Object has been destroyed');
          },
        },
      ]),
    };
    const { mod } = loadSettingsStore({ userDataDir, webContents });

    expect(mod.saveSettings({ theme: 'dark' })).toBe(true);
  });

  test('registers IPC handlers for loading and saving settings', async () => {
    const ipcMain = createIpcMainMock();
    const { mod, nativeTheme } = loadSettingsStore({ userDataDir, ipcMain });

    mod.registerSettingsIpc();

    await expect(ipcMain.invoke(IPC.SETTINGS_GET)).resolves.toEqual(
      expect.objectContaining({
        theme: 'system',
        antNodeMode: 'ultraLight',
        shellTheme: {
          mode: 'system',
          effective: 'light',
        },
      })
    );
    await expect(ipcMain.invoke(IPC.SETTINGS_SAVE, { theme: 'dark', antNodeMode: 'light' }))
      .resolves.toBe(true);

    expect(nativeTheme.themeSource).toBe('dark');
  });
});
