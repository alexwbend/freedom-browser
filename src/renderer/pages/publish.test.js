const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    if (force === true) {
      this.add(value);
      return true;
    }
    if (force === false) {
      this.remove(value);
      return false;
    }
    if (this.contains(value)) {
      this.remove(value);
      return false;
    }
    this.add(value);
    return true;
  }
}

class FakeElement {
  constructor(options = {}) {
    this.listeners = new Map();
    this.classList = new FakeClassList(options.classes || []);
    this.dataset = {};
    this.disabled = false;
    this.value = '';
    this._textContent = '';
    this.innerHTML = '';
  }

  set textContent(value) {
    this._textContent = value == null ? '' : String(value);
  }

  get textContent() {
    return this._textContent;
  }

  addEventListener(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  async fire(event) {
    for (const handler of this.listeners.get(event) || []) {
      await handler({ type: event, target: this, preventDefault: jest.fn() });
    }
  }
}

function loadPublishScript() {
  return fs.readFileSync(path.join(__dirname, 'scripts/publish.js'), 'utf8');
}

async function flushPromises() {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

async function runPublishPage(options = {}) {
  const elements = {
    'publish-status-banner': new FakeElement({ classes: ['hidden'] }),
    'trusted-swarm-publish-action': new FakeElement({ classes: ['hidden'] }),
    'open-trusted-swarm-publish-surface': new FakeElement(),
    'publish-actions': new FakeElement(),
    'publish-file-btn': new FakeElement(),
    'publish-folder-btn': new FakeElement(),
    'publish-text-btn': new FakeElement(),
    'publish-text-input': new FakeElement({ classes: ['hidden'] }),
    'publish-text-area': new FakeElement(),
    'publish-text-submit': new FakeElement(),
    'publish-text-cancel': new FakeElement(),
    'publish-progress': new FakeElement({ classes: ['hidden'] }),
    'publish-progress-text': new FakeElement(),
    'publish-progress-fill': { style: {} },
    'publish-result': new FakeElement({ classes: ['hidden'] }),
    'publish-result-url': new FakeElement(),
    'publish-result-ref': new FakeElement(),
    'publish-copy-url': new FakeElement(),
    'publish-copy-ref': new FakeElement(),
    'publish-open-url': new FakeElement(),
    'publish-another': new FakeElement(),
    'publish-error': new FakeElement({ classes: ['hidden'] }),
    'publish-error-text': new FakeElement(),
    'publish-error-retry': new FakeElement(),
    'publish-history-list': new FakeElement(),
    'publish-history-clear': new FakeElement(),
  };
  const body = { dataset: {} };
  const swarm = {
    getPublishHistory: jest.fn().mockResolvedValue(
      options.getPublishHistoryResult || { success: true, entries: [] }
    ),
    clearPublishHistory: jest.fn().mockResolvedValue({ success: true }),
    getStamps: jest.fn().mockResolvedValue({ success: true, stamps: [{ usable: true }] }),
    publishData: jest.fn().mockResolvedValue({
      success: true,
      reference: 'abc123',
      bzzUrl: 'bzz://abc123',
    }),
    pickFileForPublish: jest.fn(),
    pickDirectoryForPublish: jest.fn(),
    publishFilePath: jest.fn(),
    publishDirectoryPath: jest.fn(),
  };
  const freedomAPI = {
    swarm,
    copyText: jest.fn(),
    openInNewTab: jest.fn(),
    openTrustedSwarmPublishSurface: jest.fn().mockResolvedValue({
      success: true,
      surface: { ok: true, surface: 'swarmPublish' },
    }),
  };
  const context = {
    window: {
      freedomAPI,
      addEventListener: jest.fn(),
    },
    document: {
      body,
      getElementById: jest.fn((id) => elements[id] || null),
      createElement: jest.fn(() => new FakeElement()),
    },
    clearTimeout: jest.fn(),
    setTimeout: jest.fn(),
    Date,
    Promise,
  };

  vm.runInNewContext(loadPublishScript(), context, { filename: 'publish.js' });
  await flushPromises();

  return {
    ...context,
    elements,
    freedomAPI,
    swarm,
  };
}

describe('publish internal page', () => {
  test('shows trusted publish window action when package mode disables raw publishing', async () => {
    const ctx = await runPublishPage({
      getPublishHistoryResult: {
        success: false,
        error: {
          code: 'SWARM_PUBLISH_UNAVAILABLE',
          message: 'Swarm publishing is shell-owned and unavailable in package mode',
        },
      },
    });

    expect(ctx.document.body.dataset.swarmPublishUnavailable).toBe('true');
    expect(ctx.elements['publish-status-banner'].textContent).toBe(
      'Swarm publishing is shell-owned and unavailable in package mode'
    );
    expect(ctx.elements['publish-file-btn'].disabled).toBe(true);
    expect(ctx.elements['publish-folder-btn'].disabled).toBe(true);
    expect(ctx.elements['publish-text-btn'].disabled).toBe(true);
    expect(ctx.elements['publish-history-clear'].disabled).toBe(true);
    expect(ctx.elements['trusted-swarm-publish-action'].classList.contains('hidden')).toBe(false);

    await ctx.elements['open-trusted-swarm-publish-surface'].fire('click');
    expect(ctx.freedomAPI.openTrustedSwarmPublishSurface).toHaveBeenCalledTimes(1);
  });
});
