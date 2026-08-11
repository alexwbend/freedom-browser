const originalWindow = global.window;
const originalDocument = global.document;

class FakeClassList {
  constructor() {
    this.classes = new Set();
  }

  add(...names) {
    for (const name of names) this.classes.add(name);
  }

  remove(...names) {
    for (const name of names) this.classes.delete(name);
  }

  contains(name) {
    return this.classes.has(name);
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.classes.has(name) : !!force;
    if (shouldAdd) this.classes.add(name);
    else this.classes.delete(name);
    return shouldAdd;
  }
}

class FakeElement {
  constructor() {
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
  }

  addEventListener(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  async fire(event, detail = {}) {
    for (const handler of this.listeners.get(event) || []) {
      await handler({ type: event, target: this, ...detail });
    }
  }
}

const elementIds = [
  'sidebar-swarm-connect',
  'swarm-connect-back',
  'swarm-connect-site',
  'swarm-connect-reject',
  'swarm-connect-approve',
  'swarm-connection-banner',
  'swarm-connection-site',
  'swarm-connection-disconnect',
  'swarm-auto-approve-badge',
  'swarm-connection-manage',
  'sidebar-swarm-publish-approve',
  'swarm-publish-back',
  'swarm-publish-site',
  'swarm-publish-type',
  'swarm-publish-size',
  'swarm-publish-name-row',
  'swarm-publish-name',
  'swarm-publish-paths-row',
  'swarm-publish-paths',
  'swarm-publish-reject',
  'swarm-publish-confirm',
  'swarm-publish-auto-approve',
  'sidebar-swarm-messaging-approve',
  'swarm-messaging-back',
  'swarm-messaging-title',
  'swarm-messaging-site',
  'swarm-messaging-wants',
  'swarm-messaging-topic-row',
  'swarm-messaging-topic',
  'swarm-messaging-size-row',
  'swarm-messaging-size',
  'swarm-messaging-warning',
  'swarm-messaging-auto-approve-label',
  'swarm-messaging-auto-approve',
  'swarm-messaging-reject',
  'swarm-messaging-confirm',
  'sidebar-swarm-feed-approve',
  'swarm-feed-back',
  'swarm-feed-title',
  'swarm-feed-site',
  'swarm-feed-wants',
  'swarm-feed-detail-label',
  'swarm-feed-name',
  'swarm-feed-identity-choice',
  'swarm-feed-identity-selector',
  'swarm-feed-reject',
  'swarm-feed-approve',
  'swarm-feed-auto-approve',
  'swarm-feed-auto-approve-label',
  'swarm-feed-warning',
  'swarm-feed-unlock',
  'swarm-feed-touchid-btn',
  'swarm-feed-password-link',
  'swarm-feed-password-section',
  'swarm-feed-password-input',
  'swarm-feed-password-submit',
  'address-input',
];

function createDocument() {
  const elements = {};
  for (const id of elementIds) {
    elements[id] = new FakeElement();
    elements[id].classList.add('hidden');
  }
  return {
    elements,
    getElementById: jest.fn((id) => elements[id] || null),
    addEventListener: jest.fn(),
  };
}

async function loadSwarmConnect() {
  jest.resetModules();

  const document = createDocument();
  const identityView = new FakeElement();
  const openSidebarPanel = jest.fn();

  // Real screen-hider wiring: hideAllSubscreens() runs every registered
  // hider, which is what made concurrent prompts clobber each other.
  const screenHiders = [];
  const hideAllSubscreens = jest.fn(() => screenHiders.forEach((fn) => fn()));

  global.document = document;
  global.window = {
    swarmPermissions: {
      getPermission: jest.fn().mockResolvedValue(null),
      setAutoApprove: jest.fn().mockResolvedValue({ success: true }),
      grantPermission: jest.fn().mockResolvedValue({ success: true }),
    },
    swarmProvider: {
      execute: jest.fn().mockResolvedValue({ result: {} }),
    },
  };

  jest.doMock('./wallet-state.js', () => ({
    walletState: { identityView },
    registerScreenHider: (fn) => screenHiders.push(fn),
    hideAllSubscreens,
  }));
  jest.doMock('../sidebar.js', () => ({
    open: openSidebarPanel,
    isVisible: jest.fn(() => false),
  }));
  jest.doMock('../dapp-provider.js', () => ({
    getPermissionKey: jest.fn((url) => url),
    getActiveWebview: jest.fn(() => null),
  }));
  jest.doMock('./permission-manage.js', () => ({ showSwarmPermissions: jest.fn() }));
  jest.doMock('./publisher-identity-selector.js', () => ({
    BEE_WALLET_IDENTITY_ID: 'bee-wallet',
    getActivePublisherIdentity: jest.fn(() => null),
    renderPublisherIdentitySelector: jest.fn(),
  }));

  const mod = await import('./swarm-connect.js');
  mod.initSwarmConnect();

  return {
    mod,
    elements: document.elements,
    hideAllSubscreens,
    openSidebarPanel,
  };
}

// Track settlement without leaving unhandled rejections around.
function trackedPrompt(show) {
  const state = { resolved: false, rejected: null };
  const promise = new Promise((resolve, reject) => {
    show(
      (value) => {
        state.resolved = true;
        resolve(value);
      },
      (err) => {
        state.rejected = err;
        reject(err);
      }
    );
  });
  promise.catch(() => {});
  state.promise = promise;
  return state;
}

describe('swarm approval prompts queue concurrent requests', () => {
  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    jest.restoreAllMocks();
  });

  test('a second messaging request waits its turn instead of clobbering the first', async () => {
    const ctx = await loadSwarmConnect();
    const screen = ctx.elements['sidebar-swarm-messaging-approve'];

    const first = trackedPrompt((resolve, reject) =>
      ctx.mod.showSwarmMessagingApproval('https://a.example', { topic: 'alpha' }, resolve, reject, {
        method: 'swarm_subscribe',
        grantMode: true,
      })
    );
    const second = trackedPrompt((resolve, reject) =>
      ctx.mod.showSwarmMessagingApproval('https://a.example', { topic: 'beta' }, resolve, reject, {
        method: 'swarm_subscribe',
        grantMode: false,
      })
    );

    // Only the first request is on screen; the second is queued, not rejected.
    expect(screen.classList.contains('hidden')).toBe(false);
    expect(ctx.elements['swarm-messaging-topic'].textContent).toBe('alpha');
    expect(ctx.elements['swarm-messaging-title'].textContent).toBe('Messaging Access');
    expect(first.rejected).toBe(null);
    expect(second.rejected).toBe(null);
    expect(second.resolved).toBe(false);

    // Allow settles the first request only, then shows the queued one.
    await ctx.elements['swarm-messaging-confirm'].fire('click');
    await first.promise;
    expect(first.resolved).toBe(true);
    expect(second.resolved).toBe(false);
    expect(second.rejected).toBe(null);
    expect(screen.classList.contains('hidden')).toBe(false);
    expect(ctx.elements['swarm-messaging-topic'].textContent).toBe('beta');
    expect(ctx.elements['swarm-messaging-title'].textContent).toBe('Confirm Message');

    // Allow settles the second request and leaves the screen closed.
    await ctx.elements['swarm-messaging-confirm'].fire('click');
    await second.promise;
    expect(second.resolved).toBe(true);
    expect(screen.classList.contains('hidden')).toBe(true);
  });

  test('cancelling a messaging prompt rejects only that request and shows the next', async () => {
    const ctx = await loadSwarmConnect();

    const first = trackedPrompt((resolve, reject) =>
      ctx.mod.showSwarmMessagingApproval('https://a.example', { topic: 'alpha' }, resolve, reject, {
        method: 'swarm_sendPss',
      })
    );
    const second = trackedPrompt((resolve, reject) =>
      ctx.mod.showSwarmMessagingApproval('https://a.example', { topic: 'beta' }, resolve, reject, {
        method: 'swarm_sendPss',
      })
    );

    await ctx.elements['swarm-messaging-reject'].fire('click');

    expect(first.rejected).toEqual({ code: 4001, message: 'User rejected the request' });
    expect(second.rejected).toBe(null);
    expect(ctx.elements['sidebar-swarm-messaging-approve'].classList.contains('hidden')).toBe(false);
    expect(ctx.elements['swarm-messaging-topic'].textContent).toBe('beta');

    await ctx.elements['swarm-messaging-confirm'].fire('click');
    await second.promise;
    expect(second.resolved).toBe(true);
  });

  test('dismissing the messaging screen rejects the queued requests too', async () => {
    const ctx = await loadSwarmConnect();

    const first = trackedPrompt((resolve, reject) =>
      ctx.mod.showSwarmMessagingApproval('https://a.example', {}, resolve, reject, {
        method: 'swarm_sendPss',
      })
    );
    const second = trackedPrompt((resolve, reject) =>
      ctx.mod.showSwarmMessagingApproval('https://a.example', {}, resolve, reject, {
        method: 'swarm_sendPss',
      })
    );

    // Another screen taking over the sidebar fires every screen hider.
    ctx.hideAllSubscreens();

    expect(first.rejected).toEqual({ code: 4001, message: 'User dismissed prompt' });
    expect(second.rejected).toEqual({ code: 4001, message: 'User dismissed prompt' });
    expect(ctx.elements['sidebar-swarm-messaging-approve'].classList.contains('hidden')).toBe(true);
  });

  test('concurrent publish requests queue as well', async () => {
    const ctx = await loadSwarmConnect();

    const first = trackedPrompt((resolve, reject) =>
      ctx.mod.showSwarmPublishApproval(
        'https://a.example',
        { contentType: 'text/plain', data: 'one', name: 'first.txt' },
        resolve,
        reject,
        'swarm_publishData'
      )
    );
    const second = trackedPrompt((resolve, reject) =>
      ctx.mod.showSwarmPublishApproval(
        'https://a.example',
        { contentType: 'text/plain', data: 'two', name: 'second.txt' },
        resolve,
        reject,
        'swarm_publishData'
      )
    );

    expect(ctx.elements['swarm-publish-name'].textContent).toBe('first.txt');
    expect(second.rejected).toBe(null);

    await ctx.elements['swarm-publish-confirm'].fire('click');
    await first.promise;
    expect(first.resolved).toBe(true);
    expect(ctx.elements['sidebar-swarm-publish-approve'].classList.contains('hidden')).toBe(false);
    expect(ctx.elements['swarm-publish-name'].textContent).toBe('second.txt');

    await ctx.elements['swarm-publish-confirm'].fire('click');
    await second.promise;
    expect(second.resolved).toBe(true);
  });

  test('concurrent connect requests queue as well', async () => {
    const ctx = await loadSwarmConnect();

    const first = trackedPrompt((resolve, reject) =>
      ctx.mod.showSwarmConnect('https://a.example', 'https://a.example', resolve, reject, null)
    );
    const second = trackedPrompt((resolve, reject) =>
      ctx.mod.showSwarmConnect('https://b.example', 'https://b.example', resolve, reject, null)
    );

    expect(ctx.elements['swarm-connect-site'].textContent).toBe('https://a.example');
    expect(second.rejected).toBe(null);

    await ctx.elements['swarm-connect-approve'].fire('click');
    await first.promise;
    expect(first.resolved).toBe(true);
    expect(ctx.elements['sidebar-swarm-connect'].classList.contains('hidden')).toBe(false);
    expect(ctx.elements['swarm-connect-site'].textContent).toBe('https://b.example');

    await ctx.elements['swarm-connect-reject'].fire('click');
    expect(second.rejected).toEqual({ code: 4001, message: 'User rejected Swarm access' });
  });
});
