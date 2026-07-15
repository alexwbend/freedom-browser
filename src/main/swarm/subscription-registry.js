/**
 * Subscription Registry
 *
 * Lifecycle state for window.swarm messaging subscriptions. Maps
 * subscription ids to their origin, target webContents, and the shared
 * node socket that feeds them. Deliberately Electron-free: the socket
 * opener and the message deliverer are injected by provider-ipc, so the
 * registry is pure bookkeeping and fully unit-testable.
 *
 * Multiplexing: the Ant node caps live pull pipelines at a small
 * node-wide pool (8 neighborhoods), so the registry opens at most one
 * socket per (kind, key) and fans messages out to every subscription on
 * it. The socket is closed when its last subscription goes away.
 */

const crypto = require('crypto');

// id → { id, origin, webContentsId, kind, key, socketKey }
const subscriptions = new Map();
// socketKey (`${kind}:${key}`) → { handle, established, subIds: Set }
const sockets = new Map();

let openSocket = null;
let deliver = null;
// configure() owns the real cap (advertised via getCapabilities limits);
// no shadow default here that could drift from it.
let maxSubscriptionsPerOrigin = Infinity;

function semanticError(reason, message) {
  const err = new Error(message);
  err.reason = reason;
  return err;
}

/**
 * Wire the registry's collaborators. Must be called before subscribe().
 * @param {Object} config
 * @param {(target: {kind, key}, handlers: {onMessage}) => {established, cancel}} config.openSocket
 * @param {(subscription: Object, payload: Buffer) => void} config.deliver
 * @param {number} config.maxSubscriptionsPerOrigin
 */
function configure(config) {
  openSocket = config.openSocket;
  deliver = config.deliver;
  if (typeof config.maxSubscriptionsPerOrigin === 'number') {
    maxSubscriptionsPerOrigin = config.maxSubscriptionsPerOrigin;
  }
}

function countByOrigin(origin) {
  let count = 0;
  for (const sub of subscriptions.values()) {
    if (sub.origin === origin) count++;
  }
  return count;
}

function fanOut(socketKey, payload) {
  const socket = sockets.get(socketKey);
  if (!socket) return;
  for (const subId of socket.subIds) {
    const sub = subscriptions.get(subId);
    if (sub) deliver(sub, payload);
  }
}

/**
 * Open (or join) a subscription.
 * @param {{ origin: string, webContentsId: number, kind: 'gsoc'|'pss', key: string }} params
 * @returns {Promise<{ subscriptionId: string }>}
 * @throws {Error} reason 'too_many_subscriptions' | 'node_subscription_limit' | socket errors
 */
async function subscribe({ origin, webContentsId, kind, key }) {
  if (countByOrigin(origin) >= maxSubscriptionsPerOrigin) {
    throw semanticError(
      'too_many_subscriptions',
      `Origin has reached the maximum of ${maxSubscriptionsPerOrigin} subscriptions`
    );
  }

  const socketKey = `${kind}:${key}`;
  let socket = sockets.get(socketKey);
  if (!socket) {
    const handle = openSocket({ kind, key }, { onMessage: (payload) => fanOut(socketKey, payload) });
    socket = { handle, subIds: new Set() };
    sockets.set(socketKey, socket);
  }

  const subscriptionId = crypto.randomBytes(16).toString('hex');
  const subscription = { id: subscriptionId, origin, webContentsId, kind, key, socketKey };
  subscriptions.set(subscriptionId, subscription);
  socket.subIds.add(subscriptionId);

  try {
    await socket.handle.established;
  } catch (err) {
    removeSubscription(subscription);
    throw err;
  }

  return { subscriptionId };
}

function removeSubscription(subscription) {
  subscriptions.delete(subscription.id);
  const socket = sockets.get(subscription.socketKey);
  if (!socket) return;
  socket.subIds.delete(subscription.id);
  if (socket.subIds.size === 0) {
    sockets.delete(subscription.socketKey);
    socket.handle.cancel();
  }
}

/**
 * Close a subscription. Origin-scoped: an origin can only close its own.
 * @throws {Error} reason 'subscription_not_found'
 */
function unsubscribe(origin, subscriptionId) {
  const subscription = subscriptions.get(subscriptionId);
  if (!subscription || subscription.origin !== origin) {
    throw semanticError('subscription_not_found', `No active subscription: ${subscriptionId}`);
  }
  removeSubscription(subscription);
}

function cancelWhere(predicate) {
  for (const subscription of [...subscriptions.values()]) {
    if (predicate(subscription)) removeSubscription(subscription);
  }
}

function cancelByWebContents(webContentsId) {
  cancelWhere((sub) => sub.webContentsId === webContentsId);
}

function cancelByOrigin(origin) {
  cancelWhere((sub) => sub.origin === origin);
}

// Exported for testing
function _reset() {
  for (const socket of sockets.values()) {
    try {
      socket.handle.cancel();
    } catch {
      // best-effort teardown
    }
  }
  subscriptions.clear();
  sockets.clear();
}

module.exports = {
  configure,
  subscribe,
  unsubscribe,
  cancelByWebContents,
  cancelByOrigin,
  countByOrigin,
  _reset,
};
