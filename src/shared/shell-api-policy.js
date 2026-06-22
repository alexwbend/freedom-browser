const SHELL_API_METHOD_CAPABILITIES = Object.freeze({
  getInfo: 'shell.info',
  markReady: 'shell.ready',
  resolveNavigationInput: 'navigation.resolve',
});

const KNOWN_SHELL_CAPABILITIES = Object.freeze(
  [...new Set(Object.values(SHELL_API_METHOD_CAPABILITIES))].sort()
);

function getRequiredCapabilityForMethod(method) {
  return SHELL_API_METHOD_CAPABILITIES[method] || null;
}

function isKnownShellCapability(capability) {
  return KNOWN_SHELL_CAPABILITIES.includes(capability);
}

module.exports = {
  KNOWN_SHELL_CAPABILITIES,
  SHELL_API_METHOD_CAPABILITIES,
  getRequiredCapabilityForMethod,
  isKnownShellCapability,
};
