const originalWindow = global.window;
const originalDocument = global.document;

async function loadModule({ electronAPI, freedomShell, documentBody } = {}) {
  jest.resetModules();
  global.window = {
    electronAPI,
    freedomShell,
  };
  global.document = documentBody ? { body: documentBody } : undefined;
  return import('./chrome-runtime-api.js');
}

describe('chrome-runtime-api', () => {
  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    jest.restoreAllMocks();
  });

  test('uses the bundled electronAPI when it is available', async () => {
    const electronAPI = {
      getSettings: jest.fn(),
    };
    const mod = await loadModule({ electronAPI });

    expect(mod.isPackageChromeRuntime()).toBe(false);
    expect(mod.getChromeRuntimeApi()).toBe(electronAPI);
  });

  test('uses freedomShell-backed package defaults without exposing broad globals', async () => {
    const freedomShell = {
      getInfo: jest.fn().mockResolvedValue({ platform: 'freebsd' }),
      markReady: jest.fn().mockResolvedValue({ ok: true }),
    };
    const mod = await loadModule({ freedomShell });
    const api = mod.getChromeRuntimeApi();

    expect(mod.isPackageChromeRuntime()).toBe(true);
    await expect(api.getPlatform()).resolves.toBe('freebsd');
    await expect(api.getSettings()).resolves.toMatchObject({
      theme: 'system',
      enableIdentityWallet: false,
    });
    await expect(api.getBookmarks()).resolves.toEqual([]);
    await expect(api.getWebviewPreloadPath()).resolves.toBeNull();
    expect(global.window.electronAPI).toBeUndefined();
  });

  test('marks package chrome ready through freedomShell', async () => {
    const body = { dataset: {} };
    const freedomShell = {
      getInfo: jest.fn().mockResolvedValue({ platform: 'linux' }),
      markReady: jest.fn().mockResolvedValue({ ok: true }),
    };
    const mod = await loadModule({ freedomShell, documentBody: body });

    await expect(mod.markPackageChromeReady()).resolves.toBe(true);

    expect(freedomShell.markReady).toHaveBeenCalledTimes(1);
    expect(body.dataset.packageReady).toBe('true');
  });

  test('does not mark bundled chrome as package ready', async () => {
    const electronAPI = {
      getSettings: jest.fn(),
    };
    const freedomShell = {
      markReady: jest.fn(),
    };
    const mod = await loadModule({ electronAPI, freedomShell });

    await expect(mod.markPackageChromeReady()).resolves.toBe(false);

    expect(freedomShell.markReady).not.toHaveBeenCalled();
  });
});
