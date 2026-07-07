const { createDocument, createElement } = require('../../../test/helpers/fake-dom.js');

const originalWindow = global.window;
const originalDocument = global.document;

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createFakeWebview = () => {
  const webview = createElement('webview');
  webview.findInPage = jest.fn();
  webview.stopFindInPage = jest.fn();
  webview.executeJavaScript = jest.fn().mockResolvedValue('');
  webview.focus = jest.fn();
  return webview;
};

const loadFindBarModule = async ({ webview = createFakeWebview(), initOptions } = {}) => {
  jest.resetModules();

  const findBar = createElement('div');
  findBar.hidden = true;
  const input = createElement('input');
  input.focus = jest.fn();
  input.select = jest.fn();
  const count = createElement('span');
  const prevBtn = createElement('button');
  const nextBtn = createElement('button');
  const closeBtn = createElement('button');

  global.document = createDocument({
    elementsById: {
      'find-bar': findBar,
      'find-bar-input': input,
      'find-bar-count': count,
      'find-bar-prev': prevBtn,
      'find-bar-next': nextBtn,
      'find-bar-close': closeBtn,
    },
  });

  const windowHandlers = {};
  const electronHandlers = {};
  global.window = {
    addEventListener: jest.fn((event, handler) => {
      windowHandlers[event] = handler;
    }),
    electronAPI: {
      onOpenFindBar: jest.fn((callback) => {
        electronHandlers.openFindBar = callback;
      }),
    },
  };

  const mod = await import('./find-bar.js');
  mod.initFindBar(initOptions ?? { getActiveWebview: () => webview });

  return {
    mod,
    webview,
    findBar,
    input,
    count,
    prevBtn,
    nextBtn,
    closeBtn,
    windowHandlers,
    electronHandlers,
  };
};

// Type into the find input and let the find-as-you-type debounce fire.
const typeQuery = async (ctx, query) => {
  ctx.input.value = query;
  ctx.input.dispatch('input');
  const { FIND_DEBOUNCE_MS } = ctx.mod;
  jest.advanceTimersByTime(FIND_DEBOUNCE_MS);
  await flushMicrotasks();
};

const emitFoundInPage = (ctx, result) => {
  ctx.webview.dispatch('found-in-page', { result });
};

describe('find-bar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.window = originalWindow;
    global.document = originalDocument;
  });

  test('openFindBar shows the bar, focuses and selects the input', async () => {
    const ctx = await loadFindBarModule();

    expect(ctx.mod.isFindBarOpen()).toBe(false);
    ctx.mod.openFindBar();
    await flushMicrotasks();

    expect(ctx.mod.isFindBarOpen()).toBe(true);
    expect(ctx.findBar.hidden).toBe(false);
    expect(ctx.input.focus).toHaveBeenCalled();
    expect(ctx.input.select).toHaveBeenCalled();
  });

  test('opens via the Cmd/Ctrl+F window fallback and the menu IPC hook', async () => {
    const ctx = await loadFindBarModule();

    const keydown = ctx.windowHandlers.keydown;
    const preventDefault = jest.fn();
    keydown({ metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, key: 'f', preventDefault });
    await flushMicrotasks();

    expect(preventDefault).toHaveBeenCalled();
    expect(ctx.mod.isFindBarOpen()).toBe(true);

    ctx.mod.closeFindBar();
    expect(ctx.mod.isFindBarOpen()).toBe(false);

    ctx.electronHandlers.openFindBar();
    await flushMicrotasks();
    expect(ctx.mod.isFindBarOpen()).toBe(true);
  });

  test('Cmd+Shift+F does not open the bar', async () => {
    const ctx = await loadFindBarModule();

    ctx.windowHandlers.keydown({
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      key: 'f',
      preventDefault: jest.fn(),
    });

    expect(ctx.mod.isFindBarOpen()).toBe(false);
  });

  test('typing runs a debounced findInPage against the active webview', async () => {
    const ctx = await loadFindBarModule();
    ctx.mod.openFindBar();
    await flushMicrotasks();

    ctx.input.value = 'need';
    ctx.input.dispatch('input');
    expect(ctx.webview.findInPage).not.toHaveBeenCalled();

    jest.advanceTimersByTime(ctx.mod.FIND_DEBOUNCE_MS);
    expect(ctx.webview.findInPage).toHaveBeenCalledTimes(1);
    expect(ctx.webview.findInPage).toHaveBeenCalledWith('need');
  });

  test('found-in-page results drive the "active/total" counter', async () => {
    const ctx = await loadFindBarModule();
    ctx.mod.openFindBar();
    await flushMicrotasks();
    await typeQuery(ctx, 'needle');

    emitFoundInPage(ctx, { activeMatchOrdinal: 3, matches: 17, finalUpdate: true });

    expect(ctx.count.textContent).toBe('3/17');
    expect(ctx.prevBtn.disabled).toBe(false);
    expect(ctx.nextBtn.disabled).toBe(false);
    expect(ctx.input.classList.contains('find-bar-input--no-matches')).toBe(false);
  });

  test('zero matches shows 0/0, tints the input, and disables prev/next', async () => {
    const ctx = await loadFindBarModule();
    ctx.mod.openFindBar();
    await flushMicrotasks();
    await typeQuery(ctx, 'zzz-not-there');

    emitFoundInPage(ctx, { activeMatchOrdinal: 0, matches: 0, finalUpdate: true });

    expect(ctx.count.textContent).toBe('0/0');
    expect(ctx.input.classList.contains('find-bar-input--no-matches')).toBe(true);
    expect(ctx.prevBtn.disabled).toBe(true);
    expect(ctx.nextBtn.disabled).toBe(true);
  });

  test('Enter advances forward, Shift+Enter goes backward', async () => {
    const ctx = await loadFindBarModule();
    ctx.mod.openFindBar();
    await flushMicrotasks();
    await typeQuery(ctx, 'needle');
    ctx.webview.findInPage.mockClear();

    ctx.input.dispatch('keydown', { key: 'Enter', shiftKey: false, preventDefault: jest.fn() });
    expect(ctx.webview.findInPage).toHaveBeenLastCalledWith('needle', {
      forward: true,
      findNext: true,
    });

    ctx.input.dispatch('keydown', { key: 'Enter', shiftKey: true, preventDefault: jest.fn() });
    expect(ctx.webview.findInPage).toHaveBeenLastCalledWith('needle', {
      forward: false,
      findNext: true,
    });
  });

  test('prev/next buttons advance the match', async () => {
    const ctx = await loadFindBarModule();
    ctx.mod.openFindBar();
    await flushMicrotasks();
    await typeQuery(ctx, 'needle');
    ctx.webview.findInPage.mockClear();

    ctx.nextBtn.dispatch('click');
    expect(ctx.webview.findInPage).toHaveBeenLastCalledWith('needle', {
      forward: true,
      findNext: true,
    });

    ctx.prevBtn.dispatch('click');
    expect(ctx.webview.findInPage).toHaveBeenLastCalledWith('needle', {
      forward: false,
      findNext: true,
    });
  });

  test('Escape closes the bar and clears highlights via stopFindInPage', async () => {
    const ctx = await loadFindBarModule();
    ctx.mod.openFindBar();
    await flushMicrotasks();
    await typeQuery(ctx, 'needle');

    const stopPropagation = jest.fn();
    ctx.input.dispatch('keydown', {
      key: 'Escape',
      preventDefault: jest.fn(),
      stopPropagation,
    });

    expect(stopPropagation).toHaveBeenCalled();
    expect(ctx.mod.isFindBarOpen()).toBe(false);
    expect(ctx.webview.stopFindInPage).toHaveBeenCalledWith('clearSelection');
    expect(ctx.count.textContent).toBe('');
  });

  test('closeFindBar stops the session on the searched webview even after the active tab changed', async () => {
    const firstWebview = createFakeWebview();
    const secondWebview = createFakeWebview();
    let active = firstWebview;
    const ctx = await loadFindBarModule({
      webview: firstWebview,
      initOptions: { getActiveWebview: () => active },
    });

    ctx.mod.openFindBar();
    await flushMicrotasks();
    await typeQuery(ctx, 'needle');

    // Simulate a tab switch: the active webview changes, then tabs.js
    // closes the bar. Highlights must be cleared on the *searched* webview,
    // and focus must NOT be stolen from the incoming tab.
    active = secondWebview;
    ctx.mod.closeFindBar();

    expect(firstWebview.stopFindInPage).toHaveBeenCalledWith('clearSelection');
    expect(secondWebview.stopFindInPage).not.toHaveBeenCalled();
    expect(firstWebview.focus).not.toHaveBeenCalled();
    expect(secondWebview.focus).not.toHaveBeenCalled();
    expect(ctx.mod.isFindBarOpen()).toBe(false);
  });

  test('closing while the searched tab is still active returns focus to the page', async () => {
    const ctx = await loadFindBarModule();
    ctx.mod.openFindBar();
    await flushMicrotasks();
    await typeQuery(ctx, 'needle');

    ctx.mod.closeFindBar();

    expect(ctx.webview.focus).toHaveBeenCalled();
  });

  test('navigation resets results but keeps the bar open; Enter re-runs a full search', async () => {
    const ctx = await loadFindBarModule();
    ctx.mod.openFindBar();
    await flushMicrotasks();
    await typeQuery(ctx, 'needle');
    emitFoundInPage(ctx, { activeMatchOrdinal: 2, matches: 5, finalUpdate: true });
    expect(ctx.count.textContent).toBe('2/5');

    ctx.mod.notifyFindBarNavigated();

    expect(ctx.mod.isFindBarOpen()).toBe(true);
    expect(ctx.count.textContent).toBe('');
    expect(ctx.input.value).toBe('needle');
    // Chromium already dropped the highlights on navigation — no extra
    // stopFindInPage call that could race the new document.
    expect(ctx.webview.stopFindInPage).not.toHaveBeenCalled();

    ctx.webview.findInPage.mockClear();
    ctx.input.dispatch('keydown', { key: 'Enter', shiftKey: false, preventDefault: jest.fn() });
    // Fresh search (no findNext options) because the session was reset.
    expect(ctx.webview.findInPage).toHaveBeenCalledWith('needle');
  });

  test('notifyFindBarNavigated is a no-op while the bar is closed', async () => {
    const ctx = await loadFindBarModule();

    expect(() => ctx.mod.notifyFindBarNavigated()).not.toThrow();
    expect(ctx.count.textContent).toBe('');
  });

  test('clearing the query ends the session and blanks the counter', async () => {
    const ctx = await loadFindBarModule();
    ctx.mod.openFindBar();
    await flushMicrotasks();
    await typeQuery(ctx, 'needle');
    emitFoundInPage(ctx, { activeMatchOrdinal: 1, matches: 4, finalUpdate: true });

    await typeQuery(ctx, '');

    expect(ctx.webview.stopFindInPage).toHaveBeenCalledWith('clearSelection');
    expect(ctx.count.textContent).toBe('');
    expect(ctx.prevBtn.disabled).toBe(true);
    expect(ctx.nextBtn.disabled).toBe(true);
  });

  test('opening with a page text selection prefills and searches it', async () => {
    const webview = createFakeWebview();
    webview.executeJavaScript.mockResolvedValue('  selected   phrase \n');
    const ctx = await loadFindBarModule({ webview });

    ctx.mod.openFindBar();
    await flushMicrotasks();

    expect(ctx.input.value).toBe('selected phrase');
    expect(webview.findInPage).toHaveBeenCalledWith('selected phrase');
  });

  test('re-opening without a page selection keeps the previous query', async () => {
    const ctx = await loadFindBarModule();
    ctx.mod.openFindBar();
    await flushMicrotasks();
    await typeQuery(ctx, 'needle');

    ctx.mod.closeFindBar();
    ctx.mod.openFindBar();
    await flushMicrotasks();

    expect(ctx.input.value).toBe('needle');
    expect(ctx.input.select).toHaveBeenCalled();
  });

  test('handles missing DOM elements and a missing webview safely', async () => {
    jest.resetModules();
    global.document = createDocument({ elementsById: {} });
    global.window = { addEventListener: jest.fn(), electronAPI: {} };
    const mod = await import('./find-bar.js');

    expect(() => {
      mod.initFindBar({ getActiveWebview: () => null });
      mod.openFindBar();
      mod.closeFindBar();
      mod.notifyFindBarNavigated();
    }).not.toThrow();
    expect(mod.isFindBarOpen()).toBe(false);
  });
});
