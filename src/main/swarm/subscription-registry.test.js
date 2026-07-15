const registry = require('./subscription-registry');

function makeSocketFactory() {
  const opened = [];
  const openSocket = jest.fn((target, handlers) => {
    let resolveEstablished;
    let rejectEstablished;
    const handle = {
      target,
      handlers,
      cancel: jest.fn(),
      established: new Promise((resolve, reject) => {
        resolveEstablished = resolve;
        rejectEstablished = reject;
      }),
    };
    handle.resolveEstablished = resolveEstablished;
    handle.rejectEstablished = rejectEstablished;
    opened.push(handle);
    return handle;
  });
  return { openSocket, opened };
}

describe('subscription-registry', () => {
  let openSocket;
  let opened;
  let deliver;

  const GSOC_KEY = 'ab'.repeat(32);

  beforeEach(() => {
    registry._reset();
    ({ openSocket, opened } = makeSocketFactory());
    deliver = jest.fn();
    registry.configure({ openSocket, deliver, maxSubscriptionsPerOrigin: 3 });
  });

  async function subscribeEstablished(params) {
    const promise = registry.subscribe(params);
    opened[opened.length - 1].resolveEstablished();
    return promise;
  }

  test('subscribe opens a socket and resolves once established', async () => {
    const promise = registry.subscribe({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: GSOC_KEY });
    expect(openSocket).toHaveBeenCalledWith({ kind: 'gsoc', key: GSOC_KEY }, expect.any(Object));

    opened[0].resolveEstablished();
    const { subscriptionId } = await promise;
    expect(typeof subscriptionId).toBe('string');
    expect(subscriptionId).toHaveLength(32);
  });

  test('multiplexes: same (kind, key) shares one socket, distinct keys open their own', async () => {
    const first = registry.subscribe({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: GSOC_KEY });
    opened[0].resolveEstablished();
    await first;
    await registry.subscribe({ origin: 'b.eth', webContentsId: 2, kind: 'gsoc', key: GSOC_KEY });
    expect(openSocket).toHaveBeenCalledTimes(1);

    await subscribeEstablished({ origin: 'a.eth', webContentsId: 1, kind: 'pss', key: GSOC_KEY });
    expect(openSocket).toHaveBeenCalledTimes(2);
  });

  test('fans a payload out to every subscription on the socket', async () => {
    const { subscriptionId: subA } = await subscribeEstablished({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: GSOC_KEY });
    const { subscriptionId: subB } = await registry.subscribe({ origin: 'b.eth', webContentsId: 2, kind: 'gsoc', key: GSOC_KEY });

    const payload = Buffer.from('hello');
    opened[0].handlers.onMessage(payload);

    expect(deliver).toHaveBeenCalledTimes(2);
    const deliveredIds = deliver.mock.calls.map(([sub]) => sub.id).sort();
    expect(deliveredIds).toEqual([subA, subB].sort());
    expect(deliver.mock.calls[0][1]).toBe(payload);
    expect(deliver.mock.calls[0][0]).toMatchObject({ kind: 'gsoc', key: GSOC_KEY });
  });

  test('enforces the per-origin cap', async () => {
    for (let i = 0; i < 3; i++) {
      await subscribeEstablished({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: `${i}${i}`.repeat(32) });
    }
    await expect(
      registry.subscribe({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: 'ff'.repeat(32) })
    ).rejects.toMatchObject({ reason: 'too_many_subscriptions' });

    // Other origins are unaffected
    await subscribeEstablished({ origin: 'b.eth', webContentsId: 2, kind: 'gsoc', key: 'ff'.repeat(32) });
  });

  test('a failed establish releases the slot and removes the socket', async () => {
    const promise = registry.subscribe({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: GSOC_KEY });
    const err = new Error('no lurker slot available');
    err.reason = 'node_subscription_limit';
    opened[0].rejectEstablished(err);

    await expect(promise).rejects.toMatchObject({ reason: 'node_subscription_limit' });
    expect(registry.countByOrigin('a.eth')).toBe(0);

    // A retry opens a fresh socket rather than joining the dead one
    await subscribeEstablished({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: GSOC_KEY });
    expect(openSocket).toHaveBeenCalledTimes(2);
  });

  test('unsubscribe is origin-scoped and closes the socket with its last subscription', async () => {
    const { subscriptionId } = await subscribeEstablished({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: GSOC_KEY });
    const { subscriptionId: other } = await registry.subscribe({ origin: 'b.eth', webContentsId: 2, kind: 'gsoc', key: GSOC_KEY });

    expect(() => registry.unsubscribe('b.eth', subscriptionId)).toThrow(
      expect.objectContaining({ reason: 'subscription_not_found' })
    );

    registry.unsubscribe('a.eth', subscriptionId);
    expect(opened[0].cancel).not.toHaveBeenCalled();

    registry.unsubscribe('b.eth', other);
    expect(opened[0].cancel).toHaveBeenCalledTimes(1);

    expect(() => registry.unsubscribe('a.eth', subscriptionId)).toThrow(
      expect.objectContaining({ reason: 'subscription_not_found' })
    );
  });

  test('no delivery after unsubscribe', async () => {
    const { subscriptionId } = await subscribeEstablished({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: GSOC_KEY });
    await registry.subscribe({ origin: 'b.eth', webContentsId: 2, kind: 'gsoc', key: GSOC_KEY });

    registry.unsubscribe('a.eth', subscriptionId);
    opened[0].handlers.onMessage(Buffer.from('after'));

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0].origin).toBe('b.eth');
  });

  test('cancelByWebContents tears down that page only', async () => {
    await subscribeEstablished({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: GSOC_KEY });
    await subscribeEstablished({ origin: 'a.eth', webContentsId: 7, kind: 'gsoc', key: 'cd'.repeat(32) });

    registry.cancelByWebContents(1);

    expect(registry.countByOrigin('a.eth')).toBe(1);
    expect(opened[0].cancel).toHaveBeenCalledTimes(1);
    expect(opened[1].cancel).not.toHaveBeenCalled();
  });

  test('cancelByOrigin tears down every subscription of the origin', async () => {
    await subscribeEstablished({ origin: 'a.eth', webContentsId: 1, kind: 'gsoc', key: GSOC_KEY });
    await subscribeEstablished({ origin: 'a.eth', webContentsId: 2, kind: 'pss', key: 'cd'.repeat(32) });
    await subscribeEstablished({ origin: 'b.eth', webContentsId: 3, kind: 'gsoc', key: 'ef'.repeat(32) });

    registry.cancelByOrigin('a.eth');

    expect(registry.countByOrigin('a.eth')).toBe(0);
    expect(registry.countByOrigin('b.eth')).toBe(1);
    expect(opened[0].cancel).toHaveBeenCalledTimes(1);
    expect(opened[1].cancel).toHaveBeenCalledTimes(1);
    expect(opened[2].cancel).not.toHaveBeenCalled();
  });
});
