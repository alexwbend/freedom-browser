const originalWindow = global.window;

async function loadModule(windowValue = {}) {
  jest.resetModules();
  global.window = windowValue;
  const chromeRuntime = await import('./chrome-runtime-api.js');
  chromeRuntime.getChromeRuntimeApi();
  return import('./service-runtime-api.js');
}

describe('service-runtime-api', () => {
  afterEach(() => {
    global.window = originalWindow;
    jest.restoreAllMocks();
  });

  test('uses bundled broad service APIs outside package mode', async () => {
    const ant = {
      checkBinary: jest.fn().mockResolvedValue({ available: true }),
      getStatus: jest.fn().mockResolvedValue({ status: 'running', error: null }),
      start: jest.fn(),
      stop: jest.fn(),
      onStatusUpdate: jest.fn(() => 'cleanup-ant'),
    };
    const serviceRegistry = {
      getRegistry: jest.fn().mockResolvedValue({
        ant: { api: 'http://127.0.0.1:11633', mode: 'bundled' },
      }),
      onUpdate: jest.fn(() => 'cleanup-registry'),
    };
    const mod = await loadModule({ ant, serviceRegistry });
    const serviceRuntime = mod.getServiceRuntimeApi();

    expect(serviceRuntime.ant.canControl).toBe(true);
    await expect(serviceRuntime.ant.checkBinary()).resolves.toEqual({ available: true });
    await expect(serviceRuntime.ant.getStatus()).resolves.toEqual({
      status: 'running',
      error: null,
    });
    expect(serviceRuntime.ant.onStatusUpdate(jest.fn())).toBe('cleanup-ant');
    await expect(serviceRuntime.serviceRegistry.getRegistry()).resolves.toEqual({
      ant: { api: 'http://127.0.0.1:11633', mode: 'bundled' },
    });
    expect(serviceRuntime.serviceRegistry.onUpdate(jest.fn())).toBe('cleanup-registry');
  });

  test('uses freedomShell read-only service APIs in package mode', async () => {
    const freedomShell = {
      getServiceRegistry: jest.fn().mockResolvedValue({
        ant: { mode: 'bundled', statusMessage: 'Node: Ant', tempMessage: null },
        ipfs: { mode: 'none', statusMessage: null, tempMessage: null },
        radicle: { mode: 'none', statusMessage: null, tempMessage: null },
      }),
      getServiceStatus: jest.fn().mockResolvedValue({
        success: true,
        service: 'ant',
        status: 'running',
        error: null,
        controllable: false,
      }),
      checkServiceBinary: jest.fn().mockResolvedValue({
        success: true,
        service: 'ant',
        available: true,
        controllable: false,
      }),
      onServiceRegistryUpdated: jest.fn(() => 'cleanup-registry'),
      onServiceStatusUpdated: jest.fn((callback) => {
        callback({ service: 'ipfs', status: 'running' });
        callback({ service: 'ant', status: 'running' });
        return 'cleanup-status';
      }),
    };
    const mod = await loadModule({ freedomShell });
    const serviceRuntime = mod.getServiceRuntimeApi();
    const statusCallback = jest.fn();

    expect(serviceRuntime.ant.canControl).toBe(false);
    await expect(serviceRuntime.ant.start()).resolves.toMatchObject({
      status: 'stopped',
      controllable: false,
    });
    await expect(serviceRuntime.ant.getStatus()).resolves.toMatchObject({
      service: 'ant',
      status: 'running',
      controllable: false,
    });
    await expect(serviceRuntime.ant.checkBinary()).resolves.toMatchObject({
      service: 'ant',
      available: true,
      controllable: false,
    });
    await expect(serviceRuntime.serviceRegistry.getRegistry()).resolves.toEqual({
      ant: { mode: 'bundled', statusMessage: 'Node: Ant', tempMessage: null },
      ipfs: { mode: 'none', statusMessage: null, tempMessage: null },
      radicle: { mode: 'none', statusMessage: null, tempMessage: null },
    });
    expect(serviceRuntime.serviceRegistry.onUpdate(jest.fn())).toBe('cleanup-registry');
    expect(serviceRuntime.ant.onStatusUpdate(statusCallback)).toBe('cleanup-status');
    expect(statusCallback).toHaveBeenCalledTimes(1);
    expect(statusCallback).toHaveBeenCalledWith({ service: 'ant', status: 'running' });
    expect(freedomShell.getServiceStatus).toHaveBeenCalledWith('ant');
    expect(freedomShell.checkServiceBinary).toHaveBeenCalledWith('ant');
  });
});
