const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, 'webview-preload-freedom-inject.js'),
  'utf-8'
);

// The injection source runs in a page realm referencing the `window` and
// `navigator` globals. Compile it once and re-run per test against fakes so we
// can assert the navigator.freedom shape and its delegation to the underlying
// window.ethereum / window.swarm providers.
const installFreedom = new Function('window', 'navigator', SOURCE);

function makeError(code, message) {
  const err = new Error(message || 'err');
  err.code = code;
  return err;
}

// Build a fake page-realm `window` with a minimal message bus. The dweb facet
// posts a FREEDOM_DWEB_REQUEST and awaits a FREEDOM_DWEB_RESPONSE; in the real
// browser the sandboxed webview preload fulfils that by invoking `ens:resolve`
// in main. Here, an optional `ensResolver(name)` stands in for that bridge.
function createInstance({ ethereum, swarm, ensResolver } = {}) {
  const navigator = {};
  const messageListeners = [];
  const window = {
    addEventListener(type, handler) {
      if (type === 'message') messageListeners.push(handler);
    },
    removeEventListener(type, handler) {
      if (type !== 'message') return;
      const i = messageListeners.indexOf(handler);
      if (i > -1) messageListeners.splice(i, 1);
    },
    postMessage(data) {
      // Deliver asynchronously to mirror the real message queue.
      Promise.resolve().then(() => {
        for (const handler of messageListeners.slice()) handler({ source: window, data });
      });
      // Simulate the webview preload's dweb bridge.
      if (data && data.type === 'FREEDOM_DWEB_REQUEST') {
        Promise.resolve()
          .then(() =>
            ensResolver ? ensResolver(data.name) : { type: 'not_found', reason: 'NO_FIXTURE' }
          )
          .then(
            (result) =>
              window.postMessage({ type: 'FREEDOM_DWEB_RESPONSE', id: data.id, result }),
            (err) =>
              window.postMessage({
                type: 'FREEDOM_DWEB_RESPONSE',
                id: data.id,
                error: { message: err.message },
              })
          );
      }
    },
  };
  window.self = window;
  if (ethereum !== null) window.ethereum = ethereum;
  if (swarm !== null) window.swarm = swarm;

  installFreedom(window, navigator);
  return { navigator, window, freedom: navigator.freedom };
}

function defaultEthereum(overrides = {}) {
  return {
    request: jest.fn(async () => []),
    on: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
    ...overrides,
  };
}

function defaultSwarm(overrides = {}) {
  return {
    requestAccess: jest.fn(async () => ({ connected: true })),
    getCapabilities: jest.fn(async () => ({ canPublish: true, reason: null })),
    publishData: jest.fn(async () => ({ reference: 'abc123', bzzUrl: 'bzz://abc123' })),
    ...overrides,
  };
}

describe('webview-preload-freedom-inject', () => {
  describe('installation', () => {
    test('installs navigator.freedom with the expected surface', () => {
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm: defaultSwarm() });
      expect(freedom).toBeDefined();
      expect(freedom.version).toBe('0.3');
      expect(typeof freedom.capabilities).toBe('function');
      expect(typeof freedom.wallet.request).toBe('function');
      expect(typeof freedom.storage.upload).toBe('function');
      expect(typeof freedom.storage.swarm.upload).toBe('function');
      expect(typeof freedom.storage.ipfs.add).toBe('function');
      expect(typeof freedom.dweb.resolve).toBe('function');
      expect(typeof freedom.permissions.query).toBe('function');
      expect(typeof freedom.permissions.request).toBe('function');
    });

    test('does not overwrite an existing navigator.freedom', () => {
      const navigator = { freedom: { sentinel: true } };
      const window = { ethereum: defaultEthereum(), swarm: defaultSwarm() };
      installFreedom(window, navigator);
      expect(navigator.freedom.sentinel).toBe(true);
    });
  });

  describe('wallet', () => {
    test('delegates request to window.ethereum', async () => {
      const ethereum = defaultEthereum({ request: jest.fn(async () => ['0xabc']) });
      const { freedom } = createInstance({ ethereum, swarm: defaultSwarm() });
      const accounts = await freedom.wallet.request({ method: 'eth_requestAccounts' });
      expect(accounts).toEqual(['0xabc']);
      expect(ethereum.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    });

    test('maps the disabled-gate error (4900) to NotAllowedError', async () => {
      const ethereum = defaultEthereum({
        request: jest.fn(async () => {
          throw makeError(4900, 'Disconnected');
        }),
      });
      const { freedom } = createInstance({ ethereum, swarm: defaultSwarm() });
      await expect(freedom.wallet.request({ method: 'eth_accounts' })).rejects.toMatchObject({
        name: 'NotAllowedError',
      });
    });

    test('maps user rejection (4001) to AbortError', async () => {
      const ethereum = defaultEthereum({
        request: jest.fn(async () => {
          throw makeError(4001, 'User rejected');
        }),
      });
      const { freedom } = createInstance({ ethereum, swarm: defaultSwarm() });
      await expect(freedom.wallet.request({ method: 'personal_sign' })).rejects.toMatchObject({
        name: 'AbortError',
      });
    });
  });

  describe('storage.upload', () => {
    test('publishes a string to swarm and normalizes the result', async () => {
      const swarm = defaultSwarm();
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm });
      const result = await freedom.storage.upload({ data: '<h1>hi</h1>', network: 'swarm' });

      expect(swarm.requestAccess).toHaveBeenCalledTimes(1);
      expect(swarm.publishData).toHaveBeenCalledWith({
        data: '<h1>hi</h1>',
        contentType: 'text/plain',
        name: undefined,
      });
      expect(result).toEqual({
        network: 'swarm',
        hash: 'abc123',
        url: 'bzz://abc123',
        raw: { reference: 'abc123', bzzUrl: 'bzz://abc123' },
      });
    });

    test('honors an explicit contentType and filename', async () => {
      const swarm = defaultSwarm();
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm });
      await freedom.storage.upload({
        data: 'body',
        network: 'swarm',
        contentType: 'text/html',
        filename: 'index.html',
      });
      expect(swarm.publishData).toHaveBeenCalledWith({
        data: 'body',
        contentType: 'text/html',
        name: 'index.html',
      });
    });

    test('rejects ipfs writes with NotSupportedError (Phase 1)', async () => {
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm: defaultSwarm() });
      await expect(
        freedom.storage.upload({ data: 'x', network: 'ipfs' })
      ).rejects.toMatchObject({ name: 'NotSupportedError' });
    });

    test('rejects missing data and bad network with TypeError', async () => {
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm: defaultSwarm() });
      await expect(freedom.storage.upload({ network: 'swarm' })).rejects.toBeInstanceOf(TypeError);
      await expect(freedom.storage.upload({ data: 'x', network: 'foo' })).rejects.toBeInstanceOf(
        TypeError
      );
    });

    test('rejects an already-aborted signal with AbortError', async () => {
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm: defaultSwarm() });
      await expect(
        freedom.storage.upload({ data: 'x', network: 'swarm', signal: { aborted: true } })
      ).rejects.toMatchObject({ name: 'AbortError' });
    });

    test('storage.swarm.upload forwards to the unified upload', async () => {
      const swarm = defaultSwarm();
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm });
      const result = await freedom.storage.swarm.upload({ data: 'hi' });
      expect(result.network).toBe('swarm');
      expect(swarm.publishData).toHaveBeenCalled();
    });
  });

  describe('capabilities()', () => {
    test('reports the gate as disabled when swarm rejects with 4900', async () => {
      const swarm = defaultSwarm({
        getCapabilities: jest.fn(async () => {
          throw makeError(4900, 'Swarm provider is not available');
        }),
      });
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm });
      const caps = await freedom.capabilities();
      expect(caps.wallet.available).toBe(false);
      expect(caps.wallet.reason).toBe('identity-wallet-disabled');
      expect(caps.storage.swarm.available).toBe(false);
      expect(caps.storage.swarm.reason).toBe('identity-wallet-disabled');
    });

    test('reports swarm available when canPublish is true', async () => {
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm: defaultSwarm() });
      const caps = await freedom.capabilities();
      expect(caps.wallet.available).toBe(true);
      expect(caps.storage.swarm.available).toBe(true);
      expect(caps.storage.ipfs.available).toBe(false);
      expect(caps.storage.ipfs.reason).toBe('write-not-supported');
      expect(caps.dweb.available).toBe(true);
      expect(caps.dweb.protocols).toEqual(['bzz', 'ipfs', 'ipns', 'ens']);
    });

    test('treats not-connected as available-on-grant', async () => {
      const swarm = defaultSwarm({
        getCapabilities: jest.fn(async () => ({ canPublish: false, reason: 'not-connected' })),
      });
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm });
      const caps = await freedom.capabilities();
      expect(caps.storage.swarm.available).toBe(true);
    });

    test('surfaces a node-readiness reason when swarm cannot publish', async () => {
      const swarm = defaultSwarm({
        getCapabilities: jest.fn(async () => ({ canPublish: false, reason: 'no-postage-stamp' })),
      });
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm });
      const caps = await freedom.capabilities();
      expect(caps.storage.swarm.available).toBe(false);
      expect(caps.storage.swarm.reason).toBe('no-postage-stamp');
    });
  });

  describe('dweb.resolve', () => {
    test('maps a resolved ENS contenthash to { protocol, hash, url }', async () => {
      const ensResolver = jest.fn(async () => ({
        type: 'ok',
        name: 'mysite.eth',
        codec: 'swarm-ns',
        protocol: 'bzz',
        decoded: 'deadbeef',
        uri: 'bzz://deadbeef',
      }));
      const { freedom } = createInstance({
        ethereum: defaultEthereum(),
        swarm: defaultSwarm(),
        ensResolver,
      });
      await expect(freedom.dweb.resolve('mysite.eth')).resolves.toEqual({
        protocol: 'bzz',
        hash: 'deadbeef',
        url: 'bzz://deadbeef',
      });
      expect(ensResolver).toHaveBeenCalledWith('mysite.eth');
    });

    test('rejects an unresolvable name with NetworkError', async () => {
      const ensResolver = jest.fn(async () => ({ type: 'not_found', reason: 'NO_RESOLVER' }));
      const { freedom } = createInstance({
        ethereum: defaultEthereum(),
        swarm: defaultSwarm(),
        ensResolver,
      });
      await expect(freedom.dweb.resolve('ghost.eth')).rejects.toMatchObject({
        name: 'NetworkError',
      });
    });

    test('rejects an unsupported contenthash codec with NotSupportedError', async () => {
      const ensResolver = jest.fn(async () => ({ type: 'unsupported', reason: 'ARWEAVE' }));
      const { freedom } = createInstance({
        ethereum: defaultEthereum(),
        swarm: defaultSwarm(),
        ensResolver,
      });
      await expect(freedom.dweb.resolve('arweave.eth')).rejects.toMatchObject({
        name: 'NotSupportedError',
      });
    });

    test('propagates a bridge error as NetworkError', async () => {
      const ensResolver = jest.fn(async () => {
        throw new Error('rpc unreachable');
      });
      const { freedom } = createInstance({
        ethereum: defaultEthereum(),
        swarm: defaultSwarm(),
        ensResolver,
      });
      await expect(freedom.dweb.resolve('flaky.eth')).rejects.toMatchObject({
        name: 'NetworkError',
      });
    });

    test('rejects a missing or empty name with TypeError', async () => {
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm: defaultSwarm() });
      await expect(freedom.dweb.resolve()).rejects.toBeInstanceOf(TypeError);
      await expect(freedom.dweb.resolve('   ')).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe('permissions', () => {
    test('query("wallet.accounts") returns granted when accounts exist', async () => {
      const ethereum = defaultEthereum({ request: jest.fn(async () => ['0xabc']) });
      const { freedom } = createInstance({ ethereum, swarm: defaultSwarm() });
      await expect(freedom.permissions.query({ name: 'wallet.accounts' })).resolves.toEqual({
        state: 'granted',
      });
    });

    test('query("wallet.accounts") returns prompt when none connected', async () => {
      const ethereum = defaultEthereum({ request: jest.fn(async () => []) });
      const { freedom } = createInstance({ ethereum, swarm: defaultSwarm() });
      await expect(freedom.permissions.query({ name: 'wallet.accounts' })).resolves.toEqual({
        state: 'prompt',
      });
    });

    test('request("storage.swarm.write") grants via requestAccess', async () => {
      const swarm = defaultSwarm();
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm });
      await expect(freedom.permissions.request({ name: 'storage.swarm.write' })).resolves.toEqual({
        state: 'granted',
      });
      expect(swarm.requestAccess).toHaveBeenCalled();
    });

    test('query("wallet.sign"/"wallet.send") track connection state, not a blanket grant', async () => {
      const connected = defaultEthereum({ request: jest.fn(async () => ['0xabc']) });
      const a = createInstance({ ethereum: connected, swarm: defaultSwarm() }).freedom;
      await expect(a.permissions.query({ name: 'wallet.sign' })).resolves.toEqual({
        state: 'granted',
      });
      await expect(a.permissions.query({ name: 'wallet.send' })).resolves.toEqual({
        state: 'granted',
      });

      const disconnected = defaultEthereum({ request: jest.fn(async () => []) });
      const b = createInstance({ ethereum: disconnected, swarm: defaultSwarm() }).freedom;
      await expect(b.permissions.query({ name: 'wallet.sign' })).resolves.toEqual({
        state: 'prompt',
      });
      await expect(b.permissions.query({ name: 'wallet.send' })).resolves.toEqual({
        state: 'prompt',
      });
    });

    test('query wallet.* reports denied when the gate is off (4900)', async () => {
      const ethereum = defaultEthereum({
        request: jest.fn(async () => {
          throw makeError(4900, 'Disconnected');
        }),
      });
      const { freedom } = createInstance({ ethereum, swarm: defaultSwarm() });
      await expect(freedom.permissions.query({ name: 'wallet.send' })).resolves.toEqual({
        state: 'denied',
      });
    });

    test('query maps non-wallet names per the registry', async () => {
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm: defaultSwarm() });
      await expect(freedom.permissions.query({ name: 'dweb.name-resolution' })).resolves.toEqual({
        state: 'granted',
      });
      await expect(freedom.permissions.query({ name: 'storage.swarm.write' })).resolves.toEqual({
        state: 'prompt',
      });
      await expect(freedom.permissions.query({ name: 'storage.ipfs.write' })).resolves.toEqual({
        state: 'denied',
      });
      await expect(freedom.permissions.query({ name: 'runtime.status' })).resolves.toEqual({
        state: 'denied',
      });
    });

    test('query/request reject unknown permission names with TypeError', async () => {
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm: defaultSwarm() });
      await expect(freedom.permissions.query({ name: 'wallet.teleport' })).rejects.toBeInstanceOf(
        TypeError
      );
      await expect(freedom.permissions.request({ name: 'bogus.permission' })).rejects.toBeInstanceOf(
        TypeError
      );
    });

    test('request("dweb.name-resolution") grants without a prompt', async () => {
      const { freedom } = createInstance({ ethereum: defaultEthereum(), swarm: defaultSwarm() });
      await expect(freedom.permissions.request({ name: 'dweb.name-resolution' })).resolves.toEqual({
        state: 'granted',
      });
    });
  });
});
