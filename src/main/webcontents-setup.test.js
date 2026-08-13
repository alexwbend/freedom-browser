const {
  loadMainModule,
} = require('../../test/helpers/main-process-test-utils');

function createContentsMock(options = {}) {
  const listeners = new Map();
  const onceListeners = new Map();
  let currentUrl = options.url || 'https://example.com';

  const contents = {
    id: options.id || 7,
    getType: jest.fn(() => options.type || 'webview'),
    getURL: jest.fn(() => currentUrl),
    setURL(url) {
      currentUrl = url;
    },
    on: jest.fn((event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(handler);
    }),
    once: jest.fn((event, handler) => {
      if (!onceListeners.has(event)) {
        onceListeners.set(event, []);
      }
      onceListeners.get(event).push(handler);
    }),
    emit(event, ...args) {
      for (const handler of listeners.get(event) || []) {
        handler(...args);
      }

      const oneTimeHandlers = onceListeners.get(event) || [];
      onceListeners.delete(event);
      oneTimeHandlers.forEach((handler) => handler(...args));
    },
    insertCSS: jest.fn(() => Promise.resolve()),
    setWindowOpenHandler: jest.fn((handler) => {
      contents.windowOpenHandler = handler;
    }),
    windowOpenHandler: null,
  };

  return contents;
}

function loadWebContentsSetupModule(options = {}) {
  const log = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const BrowserWindow = options.BrowserWindow || {
    getAllWindows: jest.fn(() => options.windows || []),
  };
  const { app, mod } = loadMainModule(require.resolve('./webcontents-setup'), {
    BrowserWindow,
    extraMocks: {
      [require.resolve('./logger')]: () => log,
      [require.resolve('./private/private-windows')]: () => ({
        isPrivateWebContents: options.isPrivateWebContents || (() => false),
      }),
    },
  });
  const state = require('./state');

  state.activeBzzBases.clear();
  state.activeRadBases.clear();

  return {
    app,
    BrowserWindow,
    log,
    mod,
    state,
  };
}

describe('webcontents-setup', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('injects light defaults for external webviews and clears active protocol bases on destroy', async () => {
    const ctx = loadWebContentsSetupModule();
    const contents = createContentsMock({
      id: 14,
      type: 'webview',
      url: 'https://example.com/articles/1',
    });

    ctx.state.activeBzzBases.set(contents.id, new URL('http://127.0.0.1:1633/bzz/hash/'));
    ctx.state.activeRadBases.set(contents.id, new URL('http://127.0.0.1:8780/api/v1/repos/rid/'));

    ctx.mod.registerWebContentsHandlers();
    ctx.app.emit('web-contents-created', {}, contents);

    contents.emit('dom-ready');
    expect(contents.insertCSS).toHaveBeenCalledWith(
      'html, body { background-color: #fff; color: #000; color-scheme: light; }',
      {
        cssOrigin: 'user',
      }
    );

    contents.emit('destroyed');
    expect(ctx.state.activeBzzBases.has(contents.id)).toBe(false);
    expect(ctx.state.activeRadBases.has(contents.id)).toBe(false);
  });

  test('skips css injection for internal file pages and intercepts external window opens', () => {
    const parentWindow = {
      webContents: {
        id: 1,
        send: jest.fn(),
      },
    };
    const ctx = loadWebContentsSetupModule({
      windows: [parentWindow],
    });
    const contents = createContentsMock({
      id: 22,
      type: 'webview',
      url: 'file:///app/pages/home.html',
    });

    ctx.mod.registerWebContentsHandlers();
    ctx.app.emit('web-contents-created', {}, contents);

    contents.emit('dom-ready');
    expect(contents.insertCSS).not.toHaveBeenCalled();

    const namedResult = contents.windowOpenHandler({
      url: 'https://github.com/openai/project',
      frameName: 'named-tab',
    });
    expect(namedResult).toEqual({ action: 'deny' });
    expect(parentWindow.webContents.send).toHaveBeenCalledWith(
      'tab:new-with-url',
      'https://github.com/openai/project',
      'named-tab'
    );

    const blankResult = contents.windowOpenHandler({
      url: 'https://example.com',
      frameName: '_blank',
    });
    expect(blankResult).toEqual({ action: 'deny' });
    expect(parentWindow.webContents.send).toHaveBeenLastCalledWith(
      'tab:new-with-url',
      'https://example.com',
      null
    );
    expect(ctx.log.info).toHaveBeenCalledWith(
      expect.stringContaining('intercepted new window request')
    );
  });

  test('intercepts custom protocol navigation and logs renderer lifecycle failures', () => {
    const parentWindow = {
      webContents: {
        id: 2,
        send: jest.fn(),
      },
    };
    const ctx = loadWebContentsSetupModule({
      windows: [parentWindow],
    });
    const contents = createContentsMock({
      id: 33,
      type: 'webview',
      url: 'https://example.com',
    });
    const event = {
      preventDefault: jest.fn(),
    };

    ctx.mod.registerWebContentsHandlers();
    ctx.app.emit('web-contents-created', {}, contents);

    contents.emit('will-navigate', event, 'bzz://0123456789abcdef');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(parentWindow.webContents.send).toHaveBeenCalledWith(
      'navigate-to-url',
      'bzz://0123456789abcdef'
    );
    expect(ctx.log.info).toHaveBeenCalledWith(
      expect.stringContaining('intercepted custom protocol navigation')
    );

    const ethEvent = {
      preventDefault: jest.fn(),
    };
    contents.emit('will-navigate', ethEvent, 'ethereum:vitalik.eth@1?value=1e16');
    expect(ethEvent.preventDefault).toHaveBeenCalled();
    expect(parentWindow.webContents.send).toHaveBeenCalledWith(
      'navigate-to-url',
      'ethereum:vitalik.eth@1?value=1e16'
    );

    const httpEvent = {
      preventDefault: jest.fn(),
    };
    contents.emit('will-navigate', httpEvent, 'https://example.com/next');
    expect(httpEvent.preventDefault).not.toHaveBeenCalled();

    const crashDetails = { reason: 'crashed' };
    contents.emit('render-process-gone', {}, crashDetails);
    contents.emit('crashed');
    contents.emit('unresponsive');
    contents.emit('responsive');

    expect(ctx.log.error).toHaveBeenCalledWith(
      '[webcontents:33:webview] render-process-gone',
      crashDetails
    );
    expect(ctx.log.error).toHaveBeenCalledWith('[webcontents:33:webview] crashed event (legacy)');
    expect(ctx.log.warn).toHaveBeenCalledWith('[webcontents:33:webview] became unresponsive');
    expect(ctx.log.warn).toHaveBeenCalledWith('[webcontents:33:webview] responsive again');
  });

  // PRIVATE MODE GUARD (navigation logging): log.info is written to the
  // persistent <userData>/logs/main.log, which outlives the private window.
  // Neither an intercepted custom-protocol URL nor a new-window target may
  // record where a private tab went — `rad:`/`ethereum:` URIs in particular
  // have no origin for sanitizeUrlForLog to strip them back to.
  test('private-window navigations log no URL at all', () => {
    const parentWindow = { webContents: { id: 2, send: jest.fn() } };
    const ctx = loadWebContentsSetupModule({
      windows: [parentWindow],
      isPrivateWebContents: (contents) => contents?.id === 44,
    });
    const contents = createContentsMock({ id: 44, type: 'webview' });

    ctx.mod.registerWebContentsHandlers();
    ctx.app.emit('web-contents-created', {}, contents);

    contents.emit('will-navigate', { preventDefault: jest.fn() }, 'rad:zSECRETRIDXYZZY');
    contents.windowOpenHandler({ url: 'https://secret.example/path', frameName: '' });

    // The events are still traced (diagnosability), just not their targets.
    const lines = ctx.log.info.mock.calls.map((call) => call.join(' '));
    expect(lines.some((line) => line.includes('intercepted custom protocol navigation'))).toBe(
      true
    );
    expect(lines.some((line) => line.includes('intercepted new window request'))).toBe(true);
    const joined = lines.join('\n');
    expect(joined).not.toContain('zSECRETRIDXYZZY');
    expect(joined).not.toContain('secret.example');
    // The navigation itself still works.
    expect(parentWindow.webContents.send).toHaveBeenCalledWith(
      'navigate-to-url',
      'rad:zSECRETRIDXYZZY'
    );
  });

  test('registers global process failure handlers on the app', () => {
    const ctx = loadWebContentsSetupModule();

    ctx.mod.registerWebContentsHandlers();

    ctx.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' });
    ctx.app.emit('render-process-gone', {}, { id: 99, reason: 'oom' });

    expect(ctx.log.error).toHaveBeenCalledWith('[child-process-gone]', {
      type: 'GPU',
      reason: 'crashed',
    });
    expect(ctx.log.error).toHaveBeenCalledWith('[render-process-gone-global]', {
      id: 99,
      reason: 'oom',
    });
  });
});
