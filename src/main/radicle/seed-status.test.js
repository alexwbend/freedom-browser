jest.mock('../logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const tracker = require('./seed-status');

const RID = 'rad:z371PVmDHdjJucejRoRYJcDEvD5pp';

beforeEach(() => tracker._reset());
afterAll(() => tracker._reset());

test('unknown repositories are idle unless native storage contains them', async () => {
  await expect(tracker.getStatus(RID, { repoExists: async () => false })).resolves.toMatchObject({
    state: 'idle',
    inStorage: false,
  });
  await expect(tracker.getStatus(RID, { repoExists: async () => true })).resolves.toMatchObject({
    state: 'fetched',
    inStorage: true,
  });
});

test('tracks a native fetch from fetching to fetched', async () => {
  let finish;
  const fetchRepo = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const initial = tracker.startFetch(RID, {
    fetchRepo,
    getSeeders: async () => 4,
  });
  expect(initial.state).toBe('fetching');
  await Promise.resolve();
  finish();
  await initial.done;
  await expect(tracker.getStatus(RID)).resolves.toMatchObject({
    state: 'fetched',
    inStorage: true,
    seedersKnown: 4,
    attemptCount: 1,
  });
});

test('surfaces native fetch failures and allows retry', async () => {
  const failed = tracker.startFetch(RID, {
    fetchRepo: async () => { throw new Error('network failed'); },
  });
  await failed.done;
  await expect(tracker.getStatus(RID)).resolves.toMatchObject({
    state: 'failed',
    lastError: 'network failed',
  });

  const retried = tracker.startFetch(RID, { fetchRepo: async () => {} });
  await retried.done;
  await expect(tracker.getStatus(RID)).resolves.toMatchObject({
    state: 'fetched',
    attemptCount: 2,
  });
});

test('cancelled fetches cannot resurrect their record', async () => {
  let finish;
  tracker.startFetch(RID, {
    fetchRepo: () => new Promise((resolve) => { finish = resolve; }),
  });
  await Promise.resolve();
  tracker.cancelFetch(RID);
  finish();
  await Promise.resolve();
  await expect(tracker.getStatus(RID)).resolves.toMatchObject({ state: 'idle' });
});
