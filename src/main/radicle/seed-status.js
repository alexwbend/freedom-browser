/**
 * In-process repository fetch status tracker.
 *
 * The native clone call performs the seed policy update and fetch on libuv's
 * worker pool. This module keeps that promise out of IPC request lifetimes so
 * window.radicle can start a fetch and poll it honestly.
 */

const log = require('../logger');

const records = new Map();

function publicStatus(record) {
  const status = {
    rid: record.rid,
    state: record.state,
    inStorage: record.state === 'fetched',
    seedersKnown: record.seedersKnown,
    attemptCount: record.attemptCount,
    recentAttempts: [],
    lastError: record.lastError,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  };
  if (record.done) {
    Object.defineProperty(status, 'done', { value: record.done, enumerable: false });
  }
  return status;
}

function startFetch(rid, { fetchRepo, getSeeders }) {
  const existing = records.get(rid);
  if (existing?.state === 'fetching') return publicStatus(existing);

  const record = {
    rid,
    state: 'fetching',
    seedersKnown: existing?.seedersKnown ?? null,
    attemptCount: (existing?.attemptCount ?? 0) + 1,
    lastError: null,
    startedAt: Date.now(),
    finishedAt: null,
    cancelled: false,
  };
  records.set(rid, record);

  record.done = Promise.resolve()
    .then(() => fetchRepo(rid))
    .then(async () => {
      if (record.cancelled || records.get(rid) !== record) return;
      record.state = 'fetched';
      record.finishedAt = Date.now();
      if (getSeeders) {
        try {
          record.seedersKnown = await getSeeders(rid);
        } catch (err) {
          log.warn(`[seed-status] seed count failed for ${rid}: ${err.message}`);
        }
      }
    })
    .catch((err) => {
      if (record.cancelled || records.get(rid) !== record) return;
      record.state = 'failed';
      record.lastError = err.message;
      if (/no seeds found/i.test(err.message)) record.seedersKnown = 0;
      record.finishedAt = Date.now();
      log.warn(`[seed-status] ${rid} fetch failed: ${err.message}`);
    });

  return publicStatus(record);
}

function cancelFetch(rid) {
  const record = records.get(rid);
  if (record) record.cancelled = true;
  records.delete(rid);
}

async function getStatus(rid, { repoExists, getSeeders } = {}) {
  const record = records.get(rid);
  let inStorage = record?.state === 'fetched';
  if (repoExists) {
    try {
      inStorage = await repoExists(rid);
    } catch {
      inStorage = false;
    }
  }

  if (!record) {
    let seedersKnown = null;
    if (getSeeders) {
      try {
        seedersKnown = await getSeeders(rid);
      } catch {
        seedersKnown = null;
      }
    }
    return {
      rid,
      state: inStorage ? 'fetched' : 'idle',
      inStorage,
      seedersKnown,
      attemptCount: 0,
      recentAttempts: [],
      lastError: null,
      startedAt: null,
      finishedAt: null,
    };
  }

  if (inStorage && record.state !== 'fetching') record.state = 'fetched';
  return { ...publicStatus(record), inStorage };
}

function _reset() {
  for (const record of records.values()) record.cancelled = true;
  records.clear();
}

module.exports = { startFetch, cancelFetch, getStatus, _reset };
