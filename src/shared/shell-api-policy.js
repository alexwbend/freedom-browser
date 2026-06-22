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

function parseShellApiVersion(version) {
  if (typeof version !== 'string') return null;
  const match = version.match(/^(\d+)\.(\d+)\.(\d+|x)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === 'x' ? 'x' : Number(match[3]),
  };
}

function compareShellApiVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] === right[key]) continue;
    return left[key] > right[key] ? 1 : -1;
  }
  return 0;
}

function isShellApiVersionCompatible(
  { minShellApi, maxShellApi },
  shellApiVersion = SHELL_API_VERSION
) {
  const current = parseShellApiVersion(shellApiVersion);
  const min = parseShellApiVersion(minShellApi);
  const max = parseShellApiVersion(maxShellApi);
  if (!current || !min || !max) return false;
  if (compareShellApiVersions(current, min) < 0) return false;
  if (max.patch === 'x') {
    return current.major === max.major && current.minor === max.minor;
  }
  return compareShellApiVersions(current, max) <= 0;
}

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
  compareShellApiVersions,
  getRequiredCapabilityForMethod,
  isKnownShellCapability,
  isShellApiVersionCompatible,
  parseShellApiVersion,
};
