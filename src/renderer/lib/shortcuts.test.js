/**
 * Equivalence guard for the ESM mirror (src/renderer/lib/shortcuts.js) vs
 * the canonical CommonJS module (src/shared/shortcuts.js), plus tests for
 * the renderer-only live-binding state.
 */

const shared = require('../../shared/shortcuts.js');

const PLATFORMS = ['darwin', 'win32', 'linux'];

const loadMirror = async () => {
  jest.resetModules();
  return import('./shortcuts.js');
};

const keyEvent = (overrides = {}) => ({
  key: 'a',
  code: 'KeyA',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...overrides,
});

describe('shared ↔ renderer mirror equivalence', () => {
  test('registries are identical', async () => {
    const mirror = await loadMirror();
    expect(mirror.SHORTCUTS).toEqual(shared.SHORTCUTS);
  });

  test('parseAccelerator agrees across registry defaults and aliases', async () => {
    const mirror = await loadMirror();
    for (const entry of shared.SHORTCUTS) {
      for (const platform of PLATFORMS) {
        const accelerators = [
          shared.getDefaultAccelerator(entry, platform),
          ...shared.getAliasAccelerators(entry, platform),
        ];
        for (const accelerator of accelerators) {
          expect(mirror.parseAccelerator(accelerator, platform)).toEqual(
            shared.parseAccelerator(accelerator, platform)
          );
        }
      }
    }
  });

  test('event matching agrees across a battery of events', async () => {
    const mirror = await loadMirror();
    const events = [
      keyEvent({ key: 't', code: 'KeyT', metaKey: true }),
      keyEvent({ key: 't', code: 'KeyT', ctrlKey: true }),
      keyEvent({ key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true }),
      keyEvent({ key: 'W', code: 'KeyW', metaKey: true, shiftKey: true }),
      keyEvent({ key: 'w', code: 'KeyW', metaKey: true }),
      keyEvent({ key: 'Tab', code: 'Tab', ctrlKey: true }),
      keyEvent({ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true }),
      keyEvent({ key: '}', code: 'BracketRight', metaKey: true, shiftKey: true }),
      keyEvent({ key: '[', code: 'BracketLeft', metaKey: true, shiftKey: true }),
      keyEvent({ key: 'F11', code: 'F11' }),
      keyEvent({ key: 'F12', code: 'F12' }),
      keyEvent({ key: 'F4', code: 'F4', ctrlKey: true }),
      keyEvent({ key: 'PageDown', code: 'PageDown', ctrlKey: true }),
      keyEvent({ key: 'PageUp', code: 'PageUp', ctrlKey: true, shiftKey: true }),
      keyEvent({ key: 'i', code: 'KeyI', metaKey: true, altKey: true }),
      keyEvent({ key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true }),
      keyEvent({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }),
      { key: 'f', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
    ];

    for (const entry of shared.SHORTCUTS) {
      for (const platform of PLATFORMS) {
        const accelerators = [
          shared.getDefaultAccelerator(entry, platform),
          ...shared.getAliasAccelerators(entry, platform),
        ];
        for (const accelerator of accelerators) {
          for (const event of events) {
            expect(mirror.eventMatchesAccelerator(event, accelerator, platform)).toBe(
              shared.eventMatchesAccelerator(event, accelerator, platform)
            );
          }
        }
      }
    }
  });

  test('default and alias lookups agree', async () => {
    const mirror = await loadMirror();
    for (const entry of shared.SHORTCUTS) {
      for (const platform of PLATFORMS) {
        expect(mirror.getDefaultAccelerator(entry.id, platform)).toBe(
          shared.getDefaultAccelerator(entry.id, platform)
        );
        expect(mirror.getAliasAccelerators(entry.id, platform)).toEqual(
          shared.getAliasAccelerators(entry.id, platform)
        );
      }
    }
  });
});

describe('renderer live bindings', () => {
  const originalWindow = global.window;

  afterEach(() => {
    global.window = originalWindow;
  });

  test('matchesShortcut uses the platform default when no override exists', async () => {
    const mirror = await loadMirror();
    mirror.configureShortcuts({ platform: 'darwin', overrides: {} });

    expect(
      mirror.matchesShortcut(keyEvent({ key: 't', code: 'KeyT', metaKey: true }), 'tab.new')
    ).toBe(true);
    expect(
      mirror.matchesShortcut(keyEvent({ key: 't', code: 'KeyT', ctrlKey: true }), 'tab.new')
    ).toBe(false);

    mirror.configureShortcuts({ platform: 'linux' });
    expect(
      mirror.matchesShortcut(keyEvent({ key: 't', code: 'KeyT', ctrlKey: true }), 'tab.new')
    ).toBe(true);
  });

  test('an override replaces the primary binding but keeps fixed aliases', async () => {
    const mirror = await loadMirror();
    mirror.configureShortcuts({
      platform: 'linux',
      overrides: { 'tab.next': 'Ctrl+Shift+U' },
    });

    // New binding works, old primary does not…
    expect(
      mirror.matchesShortcut(
        keyEvent({ key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true }),
        'tab.next'
      )
    ).toBe(true);
    expect(
      mirror.matchesShortcut(
        keyEvent({ key: 'PageDown', code: 'PageDown', ctrlKey: true }),
        'tab.next'
      )
    ).toBe(false);
    // …while the fixed Ctrl+Tab alias stays active.
    expect(
      mirror.matchesShortcut(keyEvent({ key: 'Tab', code: 'Tab', ctrlKey: true }), 'tab.next')
    ).toBe(true);
  });

  test('getEffectiveAccelerator resolves override ?? default', async () => {
    const mirror = await loadMirror();
    mirror.configureShortcuts({ platform: 'linux', overrides: { 'tab.new': 'Ctrl+Shift+U' } });

    expect(mirror.getEffectiveAccelerator('tab.new')).toBe('Ctrl+Shift+U');
    expect(mirror.getEffectiveAccelerator('tab.close')).toBe('CmdOrCtrl+W');
  });

  test('initShortcuts loads settings and applies live settings:updated payloads', async () => {
    const listeners = {};
    global.window = {
      electronAPI: {
        getSettings: jest.fn().mockResolvedValue({
          shortcutOverrides: { 'tab.new': 'Ctrl+Shift+U' },
        }),
      },
      addEventListener: jest.fn((name, handler) => {
        listeners[name] = handler;
      }),
    };

    const mirror = await loadMirror();
    mirror.configureShortcuts({ platform: 'linux' });
    mirror.initShortcuts();
    await Promise.resolve();
    await Promise.resolve();

    expect(mirror.getEffectiveAccelerator('tab.new')).toBe('Ctrl+Shift+U');

    // Live update: override removed again.
    listeners['settings:updated']({ detail: { shortcutOverrides: {} } });
    expect(mirror.getEffectiveAccelerator('tab.new')).toBe('CmdOrCtrl+T');

    // Malformed payloads reset to defaults instead of throwing.
    listeners['settings:updated']({ detail: { shortcutOverrides: null } });
    expect(mirror.getEffectiveAccelerator('tab.new')).toBe('CmdOrCtrl+T');
  });
});
