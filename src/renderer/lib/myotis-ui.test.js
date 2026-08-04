const { createDocument, createElement } = require('../../../test/helpers/fake-dom.js');

const originalWindow = global.window;
const originalDocument = global.document;

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

async function loadMyotisUi(options = {}) {
  jest.resetModules();
  const elements = {
    button: createElement('button'),
    toggle: createElement('span'),
    info: createElement('div', { classes: ['ipfs-info'] }),
    state: createElement('span'),
    peers: createElement('span'),
    block: createElement('span'),
    version: createElement('span'),
  };
  const document = createDocument({
    elementsById: {
      'myotis-toggle-btn': elements.button,
      'myotis-toggle-switch': elements.toggle,
      'myotis-info': elements.info,
      'myotis-state-text': elements.state,
      'myotis-peers-count': elements.peers,
      'myotis-finalized-block': elements.block,
      'myotis-version-text': elements.version,
    },
  });
  let statusHandler;
  const initialStatus = options.initialStatus || {
    supported: true,
    available: true,
    running: false,
    state: 'off',
  };
  const api = {
    start: jest.fn().mockResolvedValue({
      supported: true,
      available: true,
      running: true,
      state: 'syncing',
      peerCount: 3,
    }),
    stop: jest.fn().mockResolvedValue(initialStatus),
    getStatus: jest.fn().mockResolvedValue(initialStatus),
    onStatusUpdate: jest.fn((handler) => {
      statusHandler = handler;
      handler(initialStatus);
      return jest.fn();
    }),
  };
  const state = { antMenuOpen: options.antMenuOpen ?? true };
  const debug = { pushDebug: jest.fn() };
  global.window = { myotis: api };
  global.document = document;
  jest.doMock('./state.js', () => ({ state }));
  jest.doMock('./debug.js', () => debug);

  const mod = await import('./myotis-ui.js');
  return { api, debug, elements, getStatusHandler: () => statusHandler, mod, state };
}

describe('myotis-ui', () => {
  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    jest.restoreAllMocks();
  });

  test('renders readiness details and controls the embedded client', async () => {
    const ctx = await loadMyotisUi();
    ctx.mod.initMyotisUi();

    ctx.getStatusHandler()({
      supported: true,
      available: true,
      running: true,
      state: 'ready',
      peerCount: 7,
      finalizedBlockNumber: '2345',
      version: '0.1.3',
    });
    expect(ctx.elements.toggle.classList.contains('running')).toBe(true);
    expect(ctx.elements.info.classList.contains('visible')).toBe(true);
    expect(ctx.elements.state.textContent).toBe('Ready');
    expect(ctx.elements.peers.textContent).toBe('7');
    expect(ctx.elements.block.textContent).toBe('2345');
    expect(ctx.elements.version.textContent).toBe('Myotis v0.1.3');

    ctx.elements.button.dispatch('click');
    await flushMicrotasks();
    expect(ctx.api.stop).toHaveBeenCalled();
  });

  test('disables runtime controls when the profile disables Myotis', async () => {
    const ctx = await loadMyotisUi({
      initialStatus: {
        supported: true,
        available: true,
        running: false,
        state: 'disabled',
      },
    });
    ctx.mod.initMyotisUi();

    expect(ctx.elements.button.disabled).toBe(true);
    expect(ctx.elements.button.title).toBe('Disabled for this profile in Settings');
    ctx.elements.button.dispatch('click');
    await flushMicrotasks();
    expect(ctx.api.start).not.toHaveBeenCalled();
  });
});
