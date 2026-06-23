import { isPackageChromeRuntime } from './chrome-runtime-api.js';

const getRuntimeWindow = () => (typeof window === 'undefined' ? {} : window);
const noopDisposer = () => {};
const SERVICE_NAMES = Object.freeze(['ant', 'ipfs', 'radicle']);

export const PACKAGE_SERVICE_CONTROL_DISABLED_TITLE =
  'Node lifecycle controls are shell-owned in package mode';

const DEFAULT_REGISTRY = Object.freeze({
  ipfs: Object.freeze({
    mode: 'none',
    statusMessage: null,
    tempMessage: null,
  }),
  ant: Object.freeze({
    mode: 'none',
    statusMessage: null,
    tempMessage: null,
  }),
  radicle: Object.freeze({
    mode: 'none',
    statusMessage: null,
    tempMessage: null,
  }),
});

let serviceRuntimeApi = null;

const cloneDefaultRegistry = () =>
  Object.fromEntries(SERVICE_NAMES.map((service) => [service, { ...DEFAULT_REGISTRY[service] }]));

const serviceControlUnavailable = async (service) => ({
  status: 'stopped',
  error: 'SERVICE_CONTROL_UNAVAILABLE',
  service,
  controllable: false,
});

const serviceStatusUnavailable = (service) => ({
  success: false,
  service,
  status: 'stopped',
  error: {
    code: 'SERVICE_STATUS_UNAVAILABLE',
    message: 'Service status is unavailable',
  },
  controllable: false,
});

const serviceBinaryUnavailable = (service) => ({
  success: false,
  service,
  available: false,
  error: {
    code: 'SERVICE_BINARY_STATUS_UNAVAILABLE',
    message: 'Service binary status is unavailable',
  },
  controllable: false,
});

const callFreedomShell = (methodName, fallbackValue, ...args) => {
  const method = getRuntimeWindow().freedomShell?.[methodName];
  if (typeof method !== 'function') {
    return Promise.resolve(fallbackValue);
  }
  return method(...args);
};

const subscribeFreedomShell = (methodName, callback) => {
  const method = getRuntimeWindow().freedomShell?.[methodName];
  if (typeof method !== 'function') {
    return noopDisposer;
  }
  return method(callback);
};

const createPackageServiceApi = (service) =>
  Object.freeze({
    available: true,
    canControl: false,
    start: () => serviceControlUnavailable(service),
    stop: () => serviceControlUnavailable(service),
    getStatus: () =>
      callFreedomShell('getServiceStatus', serviceStatusUnavailable(service), service),
    checkBinary: () =>
      callFreedomShell('checkServiceBinary', serviceBinaryUnavailable(service), service),
    onStatusUpdate: (callback) =>
      subscribeFreedomShell('onServiceStatusUpdated', (payload) => {
        if (payload?.service === service) {
          callback(payload);
        }
      }),
    getConnections:
      service === 'radicle'
        ? async () => ({
            success: false,
            count: 0,
            error: {
              code: 'SERVICE_CONNECTIONS_UNAVAILABLE',
              message: 'Service connection details are unavailable in package mode',
            },
          })
        : undefined,
  });

const createBundledServiceApi = (service) => {
  const runtimeWindow = getRuntimeWindow();
  const broadApi = runtimeWindow[service] || {};
  return Object.freeze({
    available: Boolean(runtimeWindow[service]),
    canControl: true,
    start: broadApi.start || (() => serviceControlUnavailable(service)),
    stop: broadApi.stop || (() => serviceControlUnavailable(service)),
    getStatus: broadApi.getStatus || (() => Promise.resolve(serviceStatusUnavailable(service))),
    checkBinary: broadApi.checkBinary || (() => Promise.resolve(serviceBinaryUnavailable(service))),
    onStatusUpdate: broadApi.onStatusUpdate || (() => noopDisposer),
    ...(service === 'radicle'
      ? {
          getConnections:
            broadApi.getConnections ||
            (async () => ({
              success: false,
              count: 0,
              error: { code: 'SERVICE_CONNECTIONS_UNAVAILABLE' },
            })),
        }
      : {}),
  });
};

const createPackageRuntimeApi = () =>
  Object.freeze({
    serviceRegistry: Object.freeze({
      getRegistry: () => callFreedomShell('getServiceRegistry', cloneDefaultRegistry()),
      onUpdate: (callback) => subscribeFreedomShell('onServiceRegistryUpdated', callback),
    }),
    ant: createPackageServiceApi('ant'),
    ipfs: createPackageServiceApi('ipfs'),
    radicle: createPackageServiceApi('radicle'),
  });

const createBundledRuntimeApi = () => {
  const runtimeWindow = getRuntimeWindow();
  return Object.freeze({
    serviceRegistry: Object.freeze({
      getRegistry:
        runtimeWindow.serviceRegistry?.getRegistry ||
        (() => Promise.resolve(cloneDefaultRegistry())),
      onUpdate: runtimeWindow.serviceRegistry?.onUpdate || (() => noopDisposer),
    }),
    ant: createBundledServiceApi('ant'),
    ipfs: createBundledServiceApi('ipfs'),
    radicle: createBundledServiceApi('radicle'),
  });
};

export const getServiceRuntimeApi = () => {
  if (!serviceRuntimeApi) {
    serviceRuntimeApi = isPackageChromeRuntime()
      ? createPackageRuntimeApi()
      : createBundledRuntimeApi();
  }
  return serviceRuntimeApi;
};

export const resetServiceRuntimeApiForTest = () => {
  serviceRuntimeApi = null;
};
