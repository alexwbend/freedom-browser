const {
  KNOWN_SHELL_CAPABILITIES,
  SHELL_API_CAPABILITIES,
  SHELL_API_EVENTS,
  SHELL_API_EVENT_CAPABILITIES,
  SHELL_API_METHODS,
  SHELL_API_METHOD_CAPABILITIES,
  SHELL_API_VERSION,
  compareShellApiVersions,
  getRequiredCapabilityForEvent,
  getRequiredCapabilityForMethod,
  isKnownShellCapability,
  isShellApiVersionCompatible,
  parseShellApiVersion,
} = require('./shell-api-policy');

describe('shell-api-policy', () => {
  test('defines the v0 shell API version and method registry', () => {
    expect(SHELL_API_VERSION).toBe('0.1.0');
    expect(SHELL_API_METHODS).toEqual({
      GET_INFO: 'getInfo',
      MARK_READY: 'markReady',
      RESOLVE_NAVIGATION_INPUT: 'resolveNavigationInput',
      TABS_GET_SNAPSHOT: 'tabs.getSnapshot',
      TABS_CREATE: 'tabs.create',
      TABS_CLOSE: 'tabs.close',
      TABS_ACTIVATE: 'tabs.activate',
      TABS_NAVIGATE: 'tabs.navigate',
      TABS_RELOAD: 'tabs.reload',
      TABS_GO_HOME: 'tabs.goHome',
    });
    expect(Object.isFrozen(SHELL_API_METHODS)).toBe(true);
  });

  test('maps every exposed method to a known capability', () => {
    expect(SHELL_API_METHOD_CAPABILITIES).toEqual({
      getInfo: 'shell.info',
      markReady: 'shell.ready',
      resolveNavigationInput: 'navigation.resolve',
      'tabs.getSnapshot': 'tabs.read',
      'tabs.create': 'tabs.write',
      'tabs.close': 'tabs.write',
      'tabs.activate': 'tabs.write',
      'tabs.navigate': 'tabs.write',
      'tabs.reload': 'tabs.write',
      'tabs.goHome': 'tabs.write',
    });

    for (const method of Object.values(SHELL_API_METHODS)) {
      const capability = getRequiredCapabilityForMethod(method);
      expect(capability).toBeTruthy();
      expect(isKnownShellCapability(capability)).toBe(true);
    }
  });

  test('defines known method and event capability registries', () => {
    expect(SHELL_API_CAPABILITIES).toEqual({
      SHELL_INFO: 'shell.info',
      SHELL_READY: 'shell.ready',
      NAVIGATION_RESOLVE: 'navigation.resolve',
      TABS_READ: 'tabs.read',
      TABS_WRITE: 'tabs.write',
    });
    expect(SHELL_API_EVENTS).toEqual({});
    expect(SHELL_API_EVENT_CAPABILITIES).toEqual({});
    expect(KNOWN_SHELL_CAPABILITIES).toEqual([
      'navigation.resolve',
      'shell.info',
      'shell.ready',
      'tabs.read',
      'tabs.write',
    ]);
    expect(isKnownShellCapability('wallet.export')).toBe(false);
  });

  test('maps every event capability to a declared event and known capability', () => {
    for (const [eventName, capability] of Object.entries(SHELL_API_EVENT_CAPABILITIES)) {
      expect(Object.values(SHELL_API_EVENTS)).toContain(eventName);
      expect(getRequiredCapabilityForEvent(eventName)).toBe(capability);
      expect(isKnownShellCapability(capability)).toBe(true);
    }

    expect(getRequiredCapabilityForEvent('tabs.changed')).toBeNull();
  });

  test('parses and compares shell API compatibility ranges', () => {
    expect(parseShellApiVersion('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(parseShellApiVersion('0.1.x')).toEqual({ major: 0, minor: 1, patch: 'x' });
    expect(parseShellApiVersion('nope')).toBeNull();

    expect(
      compareShellApiVersions(
        { major: 0, minor: 1, patch: 1 },
        { major: 0, minor: 1, patch: 0 }
      )
    ).toBe(1);

    expect(
      isShellApiVersionCompatible({
        minShellApi: '0.1.0',
        maxShellApi: '0.1.x',
      })
    ).toBe(true);
    expect(
      isShellApiVersionCompatible({
        minShellApi: '0.2.0',
        maxShellApi: '0.2.x',
      })
    ).toBe(false);
    expect(
      isShellApiVersionCompatible({
        minShellApi: '0.1.0',
        maxShellApi: '0.1.0',
      })
    ).toBe(true);
    expect(
      isShellApiVersionCompatible({
        minShellApi: '0.1.0',
        maxShellApi: 'invalid',
      })
    ).toBe(false);
  });
});
