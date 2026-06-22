const SHELL_API_VERSION = '0.1.0';

const SHELL_API_METHODS = Object.freeze({
  GET_INFO: 'getInfo',
  MARK_READY: 'markReady',
  RESOLVE_NAVIGATION_INPUT: 'resolveNavigationInput',
});

const SHELL_API_CAPABILITIES = Object.freeze({
  SHELL_INFO: 'shell.info',
  SHELL_READY: 'shell.ready',
  NAVIGATION_RESOLVE: 'navigation.resolve',
});

const SHELL_API_METHOD_CAPABILITIES = Object.freeze({
  [SHELL_API_METHODS.GET_INFO]: SHELL_API_CAPABILITIES.SHELL_INFO,
  [SHELL_API_METHODS.MARK_READY]: SHELL_API_CAPABILITIES.SHELL_READY,
  [SHELL_API_METHODS.RESOLVE_NAVIGATION_INPUT]: SHELL_API_CAPABILITIES.NAVIGATION_RESOLVE,
});

const SHELL_API_EVENT_CAPABILITIES = Object.freeze({});

const KNOWN_SHELL_CAPABILITIES = Object.freeze(
  [
    ...new Set([
      ...Object.values(SHELL_API_METHOD_CAPABILITIES),
      ...Object.values(SHELL_API_EVENT_CAPABILITIES),
    ]),
  ].sort()
);

function getRequiredCapabilityForMethod(method) {
  return SHELL_API_METHOD_CAPABILITIES[method] || null;
}

function isKnownShellCapability(capability) {
  return KNOWN_SHELL_CAPABILITIES.includes(capability);
}

module.exports = {
  KNOWN_SHELL_CAPABILITIES,
  SHELL_API_CAPABILITIES,
  SHELL_API_EVENT_CAPABILITIES,
  SHELL_API_METHODS,
  SHELL_API_METHOD_CAPABILITIES,
  SHELL_API_VERSION,
  getRequiredCapabilityForMethod,
  isKnownShellCapability,
};
