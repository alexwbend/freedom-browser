const originalWindow = global.window;
const originalDocument = global.document;

async function loadSettingsModule({ initialSettings, prefersDark = true } = {}) {
  jest.resetModules();

  let themeChangedHandler = null;
  const mediaQueryList = {
    matches: prefersDark,
    addEventListener: jest.fn(),
  };
  const documentElement = {
    setAttribute: jest.fn(),
    removeAttribute: jest.fn(),
  };
  const freedomShell = {
    getSettings: jest.fn().mockResolvedValue(
      initialSettings || {
        theme: 'system',
        antNodeMode: 'ultraLight',
        enableRadicleIntegration: false,
      }
    ),
    onThemeChanged: jest.fn((callback) => {
      themeChangedHandler = callback;
      return jest.fn();
    }),
  };

  global.window = {
    freedomShell,
    matchMedia: jest.fn(() => mediaQueryList),
  };
  global.document = { documentElement };

  jest.doMock('./debug.js', () => ({ pushDebug: jest.fn() }));

  const mod = await import('./settings-ui.js');
  return {
    mod,
    documentElement,
    freedomShell,
    getThemeChangedHandler: () => themeChangedHandler,
  };
}

describe('official package settings-ui', () => {
  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    jest.restoreAllMocks();
  });

  test('applies package theme changes from the shell event bridge', async () => {
    const { mod, documentElement, freedomShell, getThemeChangedHandler } =
      await loadSettingsModule({
        initialSettings: {
          theme: 'dark',
          antNodeMode: 'ultraLight',
          enableRadicleIntegration: false,
        },
      });

    await mod.initTheme();

    expect(freedomShell.onThemeChanged).toHaveBeenCalledWith(expect.any(Function));
    const onThemeChanged = getThemeChangedHandler();

    onThemeChanged({ mode: 'light', effective: 'light' });
    expect(documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');

    onThemeChanged({ mode: 'dark', effective: 'dark' });
    expect(documentElement.removeAttribute).toHaveBeenCalledWith('data-theme');
  });
});
