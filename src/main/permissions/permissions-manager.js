/**
 * Site Permissions Manager
 *
 * Owns Electron's session permission hooks (`setPermissionRequestHandler`
 * + `setPermissionCheckHandler`) for the sessions webviews run on, and
 * turns the old blanket deny into a per-site ask flow:
 *
 *   stored decision (permissions.json)   → applied silently
 *   session-only decision (this run)     → applied silently
 *   no decision, promptable permission   → anchored prompt in the
 *                                          requesting window's renderer
 *   anything else                        → denied (deny-by-default keeps)
 *
 * `pointerLock` and `fullscreen` stay auto-allowed (status quo). `hid`
 * is deliberately NOT promptable: Ledger hardware-wallet support drives
 * HID through its own connect flow, so web-page HID requests keep the
 * pre-existing always-deny behavior.
 *
 * Decisions are keyed by the shared origin normalization
 * (src/shared/origin-utils.js) — the same representation the dApp and
 * Swarm permission stores use, so `bzz://name.eth` and the resolved
 * hash stay distinct origins exactly like they do for wallet grants.
 *
 * Prompts are queued per window (one visible prompt at a time); identical
 * origin+permission requests are coalesced onto the same prompt.
 */

const { ipcMain, systemPreferences } = require('electron');
const log = require('../logger');
const IPC = require('../../shared/ipc-channels');
const store = require('./permissions-store');
const { normalizeOrigin } = require('../../shared/origin-utils');
const { broadcastToAllWebContents } = require('../lib/broadcast-to-all-webcontents');

// Auto-allowed without prompting (status quo before this manager).
const ALWAYS_ALLOWED = new Set(['pointerLock', 'fullscreen']);

// Media types → storage keys. `media` requests are split so the prompt
// names the right device and decisions stay per-device.
const MEDIA_TYPE_KEYS = {
  video: 'camera',
  audio: 'microphone',
};

// In-memory, session-only decisions (unremembered prompt answers):
// Map<origin, Map<storageKey, 'allow'|'deny'>>. Never persisted.
const sessionDecisions = new Map();

// Per-window prompt queues: Map<hostWebContentsId, {host, active, queue: []}>
const hostQueues = new Map();

// Pending prompt entries by prompt id (for the renderer's response).
const pendingById = new Map();

let nextPromptId = 1;

/**
 * Map an Electron permission request to the storage keys it covers.
 * Returns null when the permission is not promptable (stays denied).
 *
 * @param {string} permission - Electron permission name
 * @param {Object} [details] - Request details (mediaTypes for 'media')
 * @returns {string[]|null}
 */
function permissionKeysForRequest(permission, details) {
  switch (permission) {
    case 'media': {
      const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
      const keys = [...new Set(mediaTypes.map((t) => MEDIA_TYPE_KEYS[t]).filter(Boolean))];
      // A media request that names neither camera nor microphone (e.g.
      // screen-capture style requests) is not covered by this prompt set.
      return keys.length > 0 ? keys : null;
    }
    case 'notifications':
      return ['notifications'];
    case 'clipboard-read':
      return ['clipboard-read'];
    case 'geolocation':
      return ['geolocation'];
    // Chromium requests plain MIDI as 'midi' and SysEx-capable MIDI as
    // 'midiSysex'; one stored decision covers both.
    case 'midi':
    case 'midiSysex':
      return ['midi'];
    default:
      return null;
  }
}

/**
 * Derive the permission-store origin for a request. Uses the frame's
 * actual URL — webviews load `bzz://name.eth` (not the resolved hash)
 * directly, so this matches the display-origin the rest of the codebase
 * keys permissions by.
 *
 * @returns {string|null} Normalized origin, or null when unusable
 */
function originForRequest(webContents, details, requestingOrigin) {
  const rawUrl =
    details?.requestingUrl ||
    (typeof webContents?.getURL === 'function' ? webContents.getURL() : '') ||
    requestingOrigin ||
    '';
  if (!rawUrl) return null;
  // Internal pages (file://) and other non-site surfaces never get
  // prompted; they have privileged IPC paths instead.
  if (rawUrl.startsWith('file:') || rawUrl.startsWith('devtools:') || rawUrl === 'about:blank') {
    return null;
  }
  const origin = normalizeOrigin(rawUrl);
  return origin || null;
}

function getSessionDecision(origin, key) {
  return sessionDecisions.get(origin)?.get(key) || null;
}

function setSessionDecision(origin, key, decision) {
  if (!sessionDecisions.has(origin)) {
    sessionDecisions.set(origin, new Map());
  }
  sessionDecisions.get(origin).set(key, decision);
}

function clearSessionDecision(origin, key) {
  const map = sessionDecisions.get(origin);
  if (!map) return;
  if (key === undefined) {
    sessionDecisions.delete(origin);
    return;
  }
  map.delete(key);
  if (map.size === 0) sessionDecisions.delete(origin);
}

/**
 * Effective decision for origin+key: persistent store first, then
 * session-only. Returns 'allow' | 'deny' | null.
 */
function getEffectiveDecision(origin, key) {
  return store.getDecision(origin, key) || getSessionDecision(origin, key);
}

function broadcastChanged() {
  broadcastToAllWebContents(IPC.PERMISSIONS_CHANGED, {});
}

/**
 * macOS gate for camera/microphone: after the user allows a site, the OS
 * must also allow Freedom itself. Returns the storage keys the OS
 * blocked (empty array = all good). Non-macOS platforms always pass.
 *
 * @param {string[]} keys - Storage keys being granted
 * @returns {Promise<string[]>} Keys blocked at the OS level
 */
async function getOsBlockedMediaKeys(keys) {
  if (process.platform !== 'darwin') return [];
  if (typeof systemPreferences?.askForMediaAccess !== 'function') return [];

  const OS_MEDIA_TYPES = { camera: 'camera', microphone: 'microphone' };
  const blocked = [];
  for (const key of keys) {
    const osType = OS_MEDIA_TYPES[key];
    if (!osType) continue;
    try {
      const granted = await systemPreferences.askForMediaAccess(osType);
      if (!granted) blocked.push(key);
    } catch (err) {
      log.warn(`[permissions] askForMediaAccess(${osType}) failed:`, err?.message || err);
      blocked.push(key);
    }
  }
  return blocked;
}

/**
 * Resolve a media grant through the OS gate; on OS-level denial the
 * request fails and the window gets a distinct notice (the site-level
 * grant stays recorded — it applies as soon as the OS setting flips).
 */
async function grantWithOsGate({ permission, keys, origin, host, callbacks }) {
  let allowed = true;
  if (permission === 'media') {
    const blocked = await getOsBlockedMediaKeys(keys.filter((k) => k === 'camera' || k === 'microphone'));
    if (blocked.length > 0) {
      allowed = false;
      log.info(`[permissions] macOS blocks ${blocked.join('+')} for ${origin}`);
      try {
        if (host && !host.isDestroyed()) {
          host.send(IPC.PERMISSIONS_OS_DENIED, { origin, permissions: blocked });
        }
      } catch {
        // Host window may be closing
      }
    }
  }
  for (const cb of callbacks) {
    try {
      cb(allowed);
    } catch {
      // Requesting webContents may be gone
    }
  }
}

function denyAll(callbacks) {
  for (const cb of callbacks) {
    try {
      cb(false);
    } catch {
      // Requesting webContents may be gone
    }
  }
}

/**
 * Resolve the BrowserWindow-side webContents that hosts a webview's
 * contents (where the prompt UI lives).
 */
function hostForWebContents(webContents) {
  return webContents?.hostWebContents || webContents || null;
}

function getHostQueue(host) {
  const id = host.id;
  if (!hostQueues.has(id)) {
    hostQueues.set(id, { host, active: null, queue: [] });
    // When the window goes away, deny everything still pending on it.
    host.once('destroyed', () => {
      const state = hostQueues.get(id);
      hostQueues.delete(id);
      if (!state) return;
      const entries = [state.active, ...state.queue].filter(Boolean);
      for (const entry of entries) {
        pendingById.delete(entry.id);
        denyAll(entry.callbacks);
      }
    });
  }
  return hostQueues.get(id);
}

function sendNextPrompt(state) {
  if (state.active || state.queue.length === 0) return;
  state.active = state.queue.shift();
  const { id, origin, permission, keys } = state.active;
  try {
    state.host.send(IPC.PERMISSIONS_PROMPT_REQUEST, { id, origin, permission, keys });
  } catch {
    // Host went away between queueing and sending
    const entry = state.active;
    state.active = null;
    pendingById.delete(entry.id);
    denyAll(entry.callbacks);
    sendNextPrompt(state);
  }
}

/**
 * Queue a prompt on the requesting window. Coalesces with an existing
 * pending prompt for the same origin + key set.
 */
function enqueuePrompt({ host, origin, permission, keys, callback }) {
  const state = getHostQueue(host);
  const signature = `${origin} ${[...keys].sort().join(',')}`;

  const existing = [state.active, ...state.queue].find(
    (entry) => entry && entry.signature === signature
  );
  if (existing) {
    existing.callbacks.push(callback);
    return;
  }

  const entry = {
    id: nextPromptId++,
    hostId: host.id,
    origin,
    permission,
    keys,
    signature,
    callbacks: [callback],
  };
  pendingById.set(entry.id, entry);
  state.queue.push(entry);
  sendNextPrompt(state);
}

/**
 * Apply the renderer's answer for a pending prompt.
 *
 * decision: 'allow' | 'deny' | 'dismiss'
 *   - allow/deny + remember      → persisted to permissions.json
 *   - allow/deny, not remembered → session-only decision
 *   - dismiss (Esc/click-away)   → denied once, nothing recorded
 */
function resolvePrompt({ id, decision, remember }) {
  const entry = pendingById.get(id);
  if (!entry) return false;
  pendingById.delete(id);

  const state = hostQueues.get(entry.hostId);
  if (state && state.active === entry) {
    state.active = null;
  }

  if (decision === 'allow' || decision === 'deny') {
    for (const key of entry.keys) {
      if (remember) {
        store.setDecision(entry.origin, key, decision);
        // A stale session answer must not shadow future revokes.
        clearSessionDecision(entry.origin, key);
      } else {
        setSessionDecision(entry.origin, key, decision);
      }
    }
    broadcastChanged();
    log.info(
      `[permissions] ${decision} ${entry.keys.join('+')} for ${entry.origin}` +
        (remember ? ' (remembered)' : ' (this session)')
    );
  } else {
    log.info(`[permissions] dismissed ${entry.keys.join('+')} prompt for ${entry.origin}`);
  }

  if (decision === 'allow') {
    grantWithOsGate({
      permission: entry.permission,
      keys: entry.keys,
      origin: entry.origin,
      host: state?.host || null,
      callbacks: entry.callbacks,
    });
  } else {
    denyAll(entry.callbacks);
  }

  if (state) sendNextPrompt(state);
  return true;
}

/**
 * Install the request + check handlers on a session (the default
 * session — webviews carry no `partition` attribute, so they share it).
 */
function installPermissionHandlers(targetSession) {
  if (!targetSession || typeof targetSession.setPermissionRequestHandler !== 'function') {
    return;
  }

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (ALWAYS_ALLOWED.has(permission)) {
      callback(true);
      return;
    }

    const keys = permissionKeysForRequest(permission, details);
    if (!keys) {
      callback(false);
      return;
    }

    const origin = originForRequest(webContents, details);
    if (!origin) {
      callback(false);
      return;
    }

    const decisions = keys.map((key) => getEffectiveDecision(origin, key));

    if (decisions.some((d) => d === 'deny')) {
      callback(false);
      return;
    }

    const host = hostForWebContents(webContents);

    if (decisions.every((d) => d === 'allow')) {
      grantWithOsGate({ permission, keys, origin, host, callbacks: [callback] });
      return;
    }

    if (!host || host.isDestroyed()) {
      callback(false);
      return;
    }

    enqueuePrompt({ host, origin, permission, keys, callback });
  });

  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (ALWAYS_ALLOWED.has(permission)) {
      return true;
    }

    // Checks are synchronous, so only recorded allows pass. An undecided
    // permission reports "denied" — the request path still prompts when
    // the page actually asks.
    let keys;
    if (permission === 'media') {
      const key = MEDIA_TYPE_KEYS[details?.mediaType];
      // A media *check* without a concrete device type passes only when
      // both devices are allowed.
      keys = key ? [key] : ['camera', 'microphone'];
    } else {
      keys = permissionKeysForRequest(permission, details);
    }
    if (!keys) return false;

    const origin = originForRequest(webContents, details, requestingOrigin);
    if (!origin) return false;

    return keys.every((key) => getEffectiveDecision(origin, key) === 'allow');
  });
}

/**
 * Merged decision view for one origin (persistent + session-only).
 * @returns {Object} Map of permission -> { decision, remembered }
 */
function getDecisionsForOrigin(origin) {
  const key = normalizeOrigin(origin);
  if (!key) return {};

  const result = {};
  const stored = store.getAllDecisions()[key] || {};
  for (const [permission, decision] of Object.entries(stored)) {
    result[permission] = { decision, remembered: true };
  }
  for (const [permission, decision] of sessionDecisions.get(key) || []) {
    if (!result[permission]) {
      result[permission] = { decision, remembered: false };
    }
  }
  return result;
}

function revokeDecision(origin, permission) {
  const key = normalizeOrigin(origin);
  const removed = store.removeDecision(key, permission);
  const hadSession = getSessionDecision(key, permission) !== null;
  clearSessionDecision(key, permission);
  if (removed || hadSession) broadcastChanged();
  return removed || hadSession;
}

function revokeOrigin(origin) {
  const key = normalizeOrigin(origin);
  const removed = store.removeOrigin(key);
  const hadSession = sessionDecisions.has(key);
  clearSessionDecision(key);
  if (removed || hadSession) broadcastChanged();
  return removed || hadSession;
}

function revokeAll() {
  store.clearAll();
  sessionDecisions.clear();
  broadcastChanged();
  return true;
}

/**
 * Register IPC handlers (prompt responses + settings/indicator queries).
 */
function registerPermissionsIpc() {
  ipcMain.handle(IPC.PERMISSIONS_PROMPT_RESPONSE, (_event, response) => {
    if (!response || typeof response.id !== 'number') return false;
    const decision = ['allow', 'deny', 'dismiss'].includes(response.decision)
      ? response.decision
      : 'dismiss';
    return resolvePrompt({
      id: response.id,
      decision,
      remember: response.remember === true,
    });
  });

  ipcMain.handle(IPC.PERMISSIONS_GET_ALL, () => {
    return store.getAllDecisions();
  });

  ipcMain.handle(IPC.PERMISSIONS_GET_FOR_ORIGIN, (_event, origin) => {
    return getDecisionsForOrigin(origin);
  });

  ipcMain.handle(IPC.PERMISSIONS_REVOKE, (_event, origin, permission) => {
    return revokeDecision(origin, permission);
  });

  ipcMain.handle(IPC.PERMISSIONS_REVOKE_ORIGIN, (_event, origin) => {
    return revokeOrigin(origin);
  });

  ipcMain.handle(IPC.PERMISSIONS_REVOKE_ALL, () => {
    return revokeAll();
  });

  log.info('[permissions] IPC handlers registered');
}

// Test-only: reset all in-memory state (queues, session decisions).
function _resetState() {
  sessionDecisions.clear();
  hostQueues.clear();
  pendingById.clear();
  nextPromptId = 1;
}

module.exports = {
  installPermissionHandlers,
  registerPermissionsIpc,
  permissionKeysForRequest,
  getDecisionsForOrigin,
  revokeDecision,
  revokeOrigin,
  revokeAll,
  _resetState,
};
