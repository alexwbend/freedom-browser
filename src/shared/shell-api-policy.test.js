const {
  KNOWN_SHELL_CAPABILITIES,
  SHELL_API_CAPABILITIES,
  SHELL_API_EVENT_CAPABILITIES,
  SHELL_API_METHODS,
  SHELL_API_METHOD_CAPABILITIES,
  SHELL_API_VERSION,
  getRequiredCapabilityForMethod,
  isKnownShellCapability,
} = require('./shell-api-policy');

describe('shell-api-policy', () => {
  test('defines the v0 shell API version and method registry', () => {
    expect(SHELL_API_VERSION).toBe('0.1.0');
    expect(SHELL_API_METHODS).toEqual({
      GET_INFO: 'getInfo',
      MARK_READY: 'markReady',
      RESOLVE_NAVIGATION_INPUT: 'resolveNavigationInput',
    });
    expect(Object.isFrozen(SHELL_API_METHODS)).toBe(true);
  });

  test('maps every exposed method to a known capability', () => {
    expect(SHELL_API_METHOD_CAPABILITIES).toEqual({
      getInfo: 'shell.info',
      markReady: 'shell.ready',
      resolveNavigationInput: 'navigation.resolve',
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
    });
    expect(SHELL_API_EVENT_CAPABILITIES).toEqual({});
    expect(KNOWN_SHELL_CAPABILITIES).toEqual([
      'navigation.resolve',
      'shell.info',
      'shell.ready',
    ]);
    expect(isKnownShellCapability('wallet.export')).toBe(false);
  });
});
