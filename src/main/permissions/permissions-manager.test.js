const IPC = require('../../shared/ipc-channels');
const {
  createTempUserDataDir,
  loadMainModule,
  removeTempUserDataDir,
} = require('../../../test/helpers/main-process-test-utils');

// Flush the promise chain grantWithOsGate rides on.
const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeFakeSession() {
  const session = {
    requestHandler: null,
    checkHandler: null,
    setPermissionRequestHandler: jest.fn((handler) => {
      session.requestHandler = handler;
    }),
    setPermissionCheckHandler: jest.fn((handler) => {
      session.checkHandler = handler;
    }),
  };
  return session;
}

let nextHostId = 1;

function makeHost() {
  const host = {
    id: nextHostId++,
    send: jest.fn(),
    destroyed: false,
    destroyedCallbacks: [],
    once: jest.fn((event, cb) => {
      if (event === 'destroyed') host.destroyedCallbacks.push(cb);
    }),
    isDestroyed: () => host.destroyed,
    destroy() {
      host.destroyed = true;
      for (const cb of host.destroyedCallbacks) cb();
    },
  };
  return host;
}

function makeWebContents(url, host) {
  return {
    getURL: () => url,
    hostWebContents: host,
  };
}

describe('permissions-manager', () => {
  let userDataDir;
  let ctx;
  let session;
  let systemPreferences;

  const load = (options = {}) => {
    systemPreferences = {
      askForMediaAccess: jest.fn(() => Promise.resolve(true)),
      ...(options.systemPreferences || {}),
    };
    ctx = loadMainModule(require.resolve('./permissions-manager'), {
      userDataDir,
      electronOverrides: { systemPreferences },
    });
    session = makeFakeSession();
    ctx.mod.installPermissionHandlers(session);
    ctx.mod.registerPermissionsIpc();
    return ctx;
  };

  // Ask for a permission; returns the callback mock.
  const request = (permission, { url = 'https://example.com/page', host, details = {} } = {}) => {
    const callback = jest.fn();
    const wc = makeWebContents(url, host);
    session.requestHandler(wc, permission, callback, { requestingUrl: url, ...details });
    return callback;
  };

  // The last prompt payload sent to a host window.
  const lastPrompt = (host) => {
    const calls = host.send.mock.calls.filter(([ch]) => ch === IPC.PERMISSIONS_PROMPT_REQUEST);
    return calls.length ? calls[calls.length - 1][1] : null;
  };

  const respond = (response) => ctx.ipcMain.invoke(IPC.PERMISSIONS_PROMPT_RESPONSE, response);

  beforeEach(() => {
    userDataDir = createTempUserDataDir();
    nextHostId = 1;
  });

  afterEach(() => {
    removeTempUserDataDir(userDataDir);
  });

  test('pointerLock and fullscreen stay auto-allowed', () => {
    load();
    const host = makeHost();
    expect(request('pointerLock', { host })).toHaveBeenCalledWith(true);
    expect(request('fullscreen', { host })).toHaveBeenCalledWith(true);
    expect(host.send).not.toHaveBeenCalled();
  });

  test('non-promptable permissions (hid, display-capture, unknown) are denied without a prompt', () => {
    load();
    const host = makeHost();
    for (const permission of ['hid', 'display-capture', 'openExternal', 'unknown']) {
      expect(request(permission, { host })).toHaveBeenCalledWith(false);
    }
    expect(host.send).not.toHaveBeenCalled();
  });

  test('requests without a usable site origin are denied', () => {
    load();
    const host = makeHost();
    const callback = jest.fn();
    session.requestHandler(
      makeWebContents('file:///pages/settings.html', host),
      'notifications',
      callback,
      { requestingUrl: 'file:///pages/settings.html' }
    );
    expect(callback).toHaveBeenCalledWith(false);
    expect(host.send).not.toHaveBeenCalled();
  });

  test('no stored decision → prompt goes to the requesting window', () => {
    load();
    const host = makeHost();
    const callback = request('notifications', { host });

    expect(callback).not.toHaveBeenCalled();
    const prompt = lastPrompt(host);
    expect(prompt).toMatchObject({
      origin: 'https://example.com',
      permission: 'notifications',
      keys: ['notifications'],
    });
    expect(typeof prompt.id).toBe('number');
  });

  test('allow + remember persists and later requests skip the prompt', async () => {
    load();
    const host = makeHost();
    const callback = request('notifications', { host });
    const prompt = lastPrompt(host);

    await respond({ id: prompt.id, decision: 'allow', remember: true });
    await flush();
    expect(callback).toHaveBeenCalledWith(true);

    // Persisted to the store…
    expect(ctx.mod.getDecisionsForOrigin('https://example.com')).toEqual({
      notifications: { decision: 'allow', remembered: true },
    });

    // …and the next request grants silently.
    host.send.mockClear();
    const second = request('notifications', { host });
    await flush();
    expect(second).toHaveBeenCalledWith(true);
    expect(host.send).not.toHaveBeenCalled();
  });

  test('deny + remember persists and later requests are denied silently', async () => {
    load();
    const host = makeHost();
    const callback = request('geolocation', { host });
    await respond({ id: lastPrompt(host).id, decision: 'deny', remember: true });
    expect(callback).toHaveBeenCalledWith(false);

    host.send.mockClear();
    const second = request('geolocation', { host });
    expect(second).toHaveBeenCalledWith(false);
    expect(host.send).not.toHaveBeenCalled();
  });

  test('unremembered decisions apply for the session only', async () => {
    load();
    const host = makeHost();
    const callback = request('notifications', { host });
    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: false });
    await flush();
    expect(callback).toHaveBeenCalledWith(true);

    // Nothing persisted…
    const storeCtx = loadMainModule(require.resolve('./permissions-store'), { userDataDir });
    expect(storeCtx.mod.getAllDecisions()).toEqual({});

    // …but a reload of the manager module (fresh session state, same
    // profile dir) must re-prompt — session decisions don't survive.
    load();
    const freshHost = makeHost();
    const again = request('notifications', { host: freshHost });
    expect(again).not.toHaveBeenCalled();
    expect(lastPrompt(freshHost)).not.toBeNull();
  });

  test('session-only allow is honored within the same run', async () => {
    load();
    const host = makeHost();
    request('notifications', { host });
    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: false });
    await flush();

    host.send.mockClear();
    const second = request('notifications', { host });
    await flush();
    expect(second).toHaveBeenCalledWith(true);
    expect(host.send).not.toHaveBeenCalled();
  });

  test('dismiss denies once and records nothing', async () => {
    load();
    const host = makeHost();
    const callback = request('notifications', { host });
    await respond({ id: lastPrompt(host).id, decision: 'dismiss' });
    expect(callback).toHaveBeenCalledWith(false);

    // The very next request prompts again.
    host.send.mockClear();
    const second = request('notifications', { host });
    expect(second).not.toHaveBeenCalled();
    expect(lastPrompt(host)).not.toBeNull();
  });

  test('one prompt at a time per window; the queue advances on response', async () => {
    load();
    const host = makeHost();
    const first = request('notifications', { host, url: 'https://one.example/page' });
    const second = request('geolocation', { host, url: 'https://two.example/page' });

    // Only the first prompt is on screen.
    expect(
      host.send.mock.calls.filter(([ch]) => ch === IPC.PERMISSIONS_PROMPT_REQUEST)
    ).toHaveLength(1);
    const prompt1 = lastPrompt(host);
    expect(prompt1.origin).toBe('https://one.example');

    await respond({ id: prompt1.id, decision: 'allow', remember: false });
    await flush();
    expect(first).toHaveBeenCalledWith(true);

    const prompt2 = lastPrompt(host);
    expect(prompt2.origin).toBe('https://two.example');
    await respond({ id: prompt2.id, decision: 'deny', remember: false });
    expect(second).toHaveBeenCalledWith(false);
  });

  test('identical origin+permission requests coalesce onto one prompt', async () => {
    load();
    const host = makeHost();
    const first = request('notifications', { host });
    const second = request('notifications', { host });

    expect(
      host.send.mock.calls.filter(([ch]) => ch === IPC.PERMISSIONS_PROMPT_REQUEST)
    ).toHaveLength(1);

    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: false });
    await flush();
    expect(first).toHaveBeenCalledWith(true);
    expect(second).toHaveBeenCalledWith(true);
  });

  test('destroying the window denies everything still pending', () => {
    load();
    const host = makeHost();
    const active = request('notifications', { host });
    const queued = request('geolocation', { host });

    host.destroy();
    expect(active).toHaveBeenCalledWith(false);
    expect(queued).toHaveBeenCalledWith(false);
  });

  test('media requests split by mediaTypes and store per-device decisions', async () => {
    load();
    const host = makeHost();

    const cameraOnly = request('media', { host, details: { mediaTypes: ['video'] } });
    expect(lastPrompt(host).keys).toEqual(['camera']);
    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: true });
    await flush();
    expect(cameraOnly).toHaveBeenCalledWith(true);

    const both = request('media', { host, details: { mediaTypes: ['video', 'audio'] } });
    // Camera is already allowed, but the mic half is undecided → prompt.
    expect(lastPrompt(host).keys).toEqual(['camera', 'microphone']);
    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: true });
    await flush();
    expect(both).toHaveBeenCalledWith(true);

    expect(ctx.mod.getDecisionsForOrigin('https://example.com')).toEqual({
      camera: { decision: 'allow', remembered: true },
      microphone: { decision: 'allow', remembered: true },
    });
  });

  test('media request with no camera/mic mediaTypes is denied', () => {
    load();
    const host = makeHost();
    const callback = request('media', { host, details: { mediaTypes: [] } });
    expect(callback).toHaveBeenCalledWith(false);
    expect(host.send).not.toHaveBeenCalled();
  });

  test('macOS: OS-level media denial fails the grant and notifies the window', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      load({
        systemPreferences: { askForMediaAccess: jest.fn(() => Promise.resolve(false)) },
      });
      const host = makeHost();
      const callback = request('media', { host, details: { mediaTypes: ['audio'] } });
      await respond({ id: lastPrompt(host).id, decision: 'allow', remember: true });
      await flush();

      expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
      expect(callback).toHaveBeenCalledWith(false);
      const osDenied = host.send.mock.calls.find(([ch]) => ch === IPC.PERMISSIONS_OS_DENIED);
      expect(osDenied[1]).toEqual({
        origin: 'https://example.com',
        permissions: ['microphone'],
      });
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  test('check handler: only recorded allows pass; media checks use mediaType', async () => {
    load();
    const host = makeHost();

    // Undecided → false (deny-by-default for synchronous checks).
    expect(
      session.checkHandler(null, 'notifications', 'https://example.com', {
        requestingUrl: 'https://example.com/page',
      })
    ).toBe(false);

    request('notifications', { host });
    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: true });
    await flush();

    expect(
      session.checkHandler(null, 'notifications', 'https://example.com', {
        requestingUrl: 'https://example.com/page',
      })
    ).toBe(true);
    expect(session.checkHandler(null, 'pointerLock', 'https://example.com', {})).toBe(true);
    expect(session.checkHandler(null, 'hid', 'https://example.com', {})).toBe(false);

    // Media check: camera allowed, mic not.
    request('media', { host, details: { mediaTypes: ['video'] } });
    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: true });
    await flush();
    const details = (mediaType) => ({ requestingUrl: 'https://example.com/x', mediaType });
    expect(session.checkHandler(null, 'media', 'https://example.com', details('video'))).toBe(true);
    expect(session.checkHandler(null, 'media', 'https://example.com', details('audio'))).toBe(
      false
    );
    // No concrete device type → both must be allowed.
    expect(session.checkHandler(null, 'media', 'https://example.com', details(undefined))).toBe(
      false
    );
  });

  test('revoke IPC clears stored and session decisions', async () => {
    load();
    const host = makeHost();

    request('notifications', { host });
    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: true });
    await flush();
    request('geolocation', { host });
    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: false });
    await flush();

    expect(await ctx.ipcMain.invoke(IPC.PERMISSIONS_GET_FOR_ORIGIN, 'https://example.com')).toEqual(
      {
        notifications: { decision: 'allow', remembered: true },
        geolocation: { decision: 'allow', remembered: false },
      }
    );

    await ctx.ipcMain.invoke(IPC.PERMISSIONS_REVOKE, 'https://example.com', 'notifications');
    expect(await ctx.ipcMain.invoke(IPC.PERMISSIONS_GET_FOR_ORIGIN, 'https://example.com')).toEqual(
      {
        geolocation: { decision: 'allow', remembered: false },
      }
    );

    await ctx.ipcMain.invoke(IPC.PERMISSIONS_REVOKE_ORIGIN, 'https://example.com');
    expect(await ctx.ipcMain.invoke(IPC.PERMISSIONS_GET_FOR_ORIGIN, 'https://example.com')).toEqual(
      {}
    );

    // Revoked session grant prompts again.
    host.send.mockClear();
    const again = request('geolocation', { host });
    expect(again).not.toHaveBeenCalled();
    expect(lastPrompt(host)).not.toBeNull();
  });

  test('revoke-all clears every origin', async () => {
    load();
    const host = makeHost();
    request('notifications', { host });
    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: true });
    await flush();

    await ctx.ipcMain.invoke(IPC.PERMISSIONS_REVOKE_ALL);
    expect(await ctx.ipcMain.invoke(IPC.PERMISSIONS_GET_ALL)).toEqual({});
  });

  test('bzz name-host and raw-hash origins stay distinct', async () => {
    load();
    const host = makeHost();
    const hash = 'a'.repeat(64);

    request('notifications', { host, url: 'bzz://myapp.eth/index.html' });
    expect(lastPrompt(host).origin).toBe('myapp.eth');
    await respond({ id: lastPrompt(host).id, decision: 'allow', remember: true });
    await flush();

    // Same site served by raw hash is a different origin → prompts.
    host.send.mockClear();
    const viaHash = request('notifications', { host, url: `bzz://${hash}/index.html` });
    expect(viaHash).not.toHaveBeenCalled();
    expect(lastPrompt(host).origin).toBe(`bzz://${hash}`);
  });
});
