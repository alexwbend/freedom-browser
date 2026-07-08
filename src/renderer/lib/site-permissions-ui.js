/**
 * Site Permissions UI
 *
 * Two chrome surfaces for per-site web permissions (camera, mic,
 * notifications, clipboard-read, geolocation, MIDI):
 *
 * 1. The permission prompt anchored under the address bar. Main queues
 *    requests per window and sends one at a time over
 *    `permissions:prompt-request`; the answer goes back via
 *    `permissions:prompt-response`. Dismissing (Esc, clicking away,
 *    switching tabs, navigating) denies once without recording anything.
 *
 * 2. The address-bar indicator + popover: a small icon when the current
 *    site holds granted permissions, listing decisions with quick revoke.
 *    Mirrors the ENS trust shield's popover interaction pattern.
 */

import { getActiveWebview, getDisplayUrlForWebview } from './tabs.js';
import { getPermissionKey } from './origin-utils.js';
import { pushDebug } from './debug.js';

// Storage-key → human noun (indicator popover, settings mirror this).
const PERMISSION_LABELS = {
  camera: 'Camera',
  microphone: 'Microphone',
  notifications: 'Notifications',
  'clipboard-read': 'Clipboard reading',
  geolocation: 'Location',
  midi: 'MIDI devices',
};

// Storage-key → prompt verb phrase ("example.com wants to <phrase>").
const PERMISSION_PHRASES = {
  camera: 'use your camera',
  microphone: 'use your microphone',
  notifications: 'show notifications',
  'clipboard-read': 'read text and images from your clipboard',
  geolocation: 'know your location',
  midi: 'use your MIDI devices',
};

export const permissionLabel = (key) => PERMISSION_LABELS[key] || key;

/**
 * Build the "wants to …" phrase for a prompt's storage keys.
 * Camera + microphone collapse into one natural sentence; anything
 * else joins with "and".
 *
 * @param {string[]} keys
 * @returns {string}
 */
export const describePermissionRequest = (keys = []) => {
  const unique = [...new Set(keys)];
  if (unique.includes('camera') && unique.includes('microphone')) {
    const rest = unique.filter((k) => k !== 'camera' && k !== 'microphone');
    const phrases = ['use your camera and microphone', ...rest.map((k) => PERMISSION_PHRASES[k] || `use ${k}`)];
    return phrases.join(' and ');
  }
  const phrases = unique.map((k) => PERMISSION_PHRASES[k] || `use ${k}`);
  return phrases.join(' and ') || 'use a device';
};

/**
 * Caveat line shown under the prompt sentence, or null.
 * Geolocation gets an honesty note: Electron lacks Chromium's network
 * location service, so grants may still not produce a position.
 *
 * @param {string[]} keys
 * @returns {string|null}
 */
export const permissionRequestNote = (keys = []) => {
  if (keys.includes('geolocation')) {
    return 'Location may not work reliably in Freedom.';
  }
  return null;
};

// DOM references
let promptEl;
let promptOriginEl;
let promptActionEl;
let promptNoteEl;
let promptRememberLabel;
let promptRememberCheckbox;
let promptAllowBtn;
let promptBlockBtn;
let indicatorBtn;
let popoverEl;
let popoverTitleEl;
let popoverListEl;

// Prompt state. Main sends one prompt per window at a time, but an
// os-denied notice can arrive while a prompt is up — both flow through
// the same local queue. Entries: {type: 'request'|'os-denied', ...payload}.
let promptQueue = [];
let activePrompt = null;

// Indicator state for the popover renderer.
let indicatorOrigin = null;
let indicatorDecisions = {};

const sitePermissions = () => window.sitePermissions;

const hidePromptElement = () => {
  if (promptEl) promptEl.hidden = true;
  activePrompt = null;
};

const showNextPrompt = () => {
  if (activePrompt || promptQueue.length === 0 || !promptEl) return;
  activePrompt = promptQueue.shift();

  const isNotice = activePrompt.type === 'os-denied';
  const keys = activePrompt.keys || activePrompt.permissions || [];

  if (isNotice) {
    const devices = keys.map((k) => permissionLabel(k).toLowerCase()).join(' and ');
    if (promptOriginEl) promptOriginEl.textContent = '';
    if (promptActionEl) {
      promptActionEl.textContent = `macOS is blocking Freedom's access to your ${devices || 'camera'}.`;
    }
    if (promptNoteEl) {
      promptNoteEl.textContent =
        'Allow Freedom under System Settings → Privacy & Security, then try again.';
      promptNoteEl.classList.remove('hidden');
    }
    promptRememberLabel?.classList.add('hidden');
    promptBlockBtn?.classList.add('hidden');
    if (promptAllowBtn) promptAllowBtn.textContent = 'OK';
  } else {
    if (promptOriginEl) promptOriginEl.textContent = activePrompt.origin || 'This site';
    if (promptActionEl) {
      promptActionEl.textContent = ` wants to ${describePermissionRequest(keys)}`;
    }
    const note = permissionRequestNote(keys);
    if (promptNoteEl) {
      promptNoteEl.textContent = note || '';
      promptNoteEl.classList.toggle('hidden', !note);
    }
    promptRememberLabel?.classList.remove('hidden');
    if (promptRememberCheckbox) promptRememberCheckbox.checked = true;
    promptBlockBtn?.classList.remove('hidden');
    if (promptAllowBtn) promptAllowBtn.textContent = 'Allow';
  }

  promptEl.hidden = false;
  pushDebug(
    isNotice
      ? `[permissions] showing macOS-denied notice (${keys.join('+')})`
      : `[permissions] prompt for ${activePrompt.origin}: ${keys.join('+')}`
  );
};

const respondToActivePrompt = (decision) => {
  if (!activePrompt) return;

  if (activePrompt.type === 'os-denied') {
    hidePromptElement();
    showNextPrompt();
    return;
  }

  const remember =
    decision !== 'dismiss' && promptRememberCheckbox ? promptRememberCheckbox.checked : false;
  const id = activePrompt.id;
  hidePromptElement();
  sitePermissions()
    ?.respondToPrompt({ id, decision, remember })
    .catch((err) => pushDebug(`[permissions] prompt response failed: ${err.message}`));
  showNextPrompt();
};

// Dismiss = deny once, nothing recorded (Esc, click-away, tab switch,
// navigation). Safe to call when no prompt is showing.
const dismissActivePrompt = (reason = 'unknown') => {
  if (!activePrompt) return;
  pushDebug(`[permissions] prompt dismissed (${reason})`);
  respondToActivePrompt('dismiss');
};

const setPopoverOpen = (open) => {
  if (!popoverEl || !indicatorBtn) return;
  popoverEl.hidden = !open;
  indicatorBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
};

const renderPopover = () => {
  if (!popoverEl || !popoverTitleEl || !popoverListEl) return;

  popoverTitleEl.textContent = indicatorOrigin || '';
  popoverListEl.textContent = '';

  for (const [key, entry] of Object.entries(indicatorDecisions)) {
    const row = document.createElement('div');
    row.className = 'permission-popover-row';

    const label = document.createElement('div');
    label.className = 'permission-popover-row-label';

    const name = document.createElement('div');
    name.className = 'permission-popover-row-name';
    name.textContent = permissionLabel(key);

    const status = document.createElement('div');
    status.className = 'permission-popover-row-status';
    const scope = entry.remembered ? '' : ' (this session)';
    if (entry.decision === 'allow') {
      status.textContent = `Allowed${scope}`;
    } else {
      status.textContent = `Blocked${scope}`;
      status.classList.add('blocked');
    }

    label.appendChild(name);
    label.appendChild(status);

    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'permission-popover-revoke';
    revoke.textContent = 'Reset';
    revoke.setAttribute('aria-label', `Reset ${permissionLabel(key)} permission`);
    revoke.addEventListener('click', () => {
      const origin = indicatorOrigin;
      sitePermissions()
        ?.revoke(origin, key)
        .catch((err) => pushDebug(`[permissions] revoke failed: ${err.message}`));
    });

    row.appendChild(label);
    row.appendChild(revoke);
    popoverListEl.appendChild(row);
  }
};

/**
 * Recompute the indicator for the active tab's committed origin.
 * Shown when the site holds at least one granted permission (stored or
 * session-scoped); the popover lists blocks too once open.
 */
const refreshIndicator = async () => {
  if (!indicatorBtn) return;

  const webview = getActiveWebview();
  const displayUrl = webview ? getDisplayUrlForWebview(webview) : '';
  const origin = displayUrl ? getPermissionKey(displayUrl) : null;

  if (!origin || !sitePermissions()?.getForOrigin) {
    indicatorOrigin = null;
    indicatorDecisions = {};
    indicatorBtn.classList.add('hidden');
    setPopoverOpen(false);
    return;
  }

  let decisions = {};
  try {
    decisions = (await sitePermissions().getForOrigin(origin)) || {};
  } catch (err) {
    pushDebug(`[permissions] getForOrigin failed: ${err.message}`);
  }

  indicatorOrigin = origin;
  indicatorDecisions = decisions;

  const hasGrant = Object.values(decisions).some((entry) => entry?.decision === 'allow');
  indicatorBtn.classList.toggle('hidden', !hasGrant);

  if (!popoverEl?.hidden) {
    if (Object.keys(decisions).length === 0) {
      setPopoverOpen(false);
    } else {
      renderPopover();
    }
  }
};

export const initSitePermissionsUi = () => {
  promptEl = document.getElementById('permission-prompt');
  promptOriginEl = document.getElementById('permission-prompt-origin');
  promptActionEl = document.getElementById('permission-prompt-action');
  promptNoteEl = document.getElementById('permission-prompt-note');
  promptRememberLabel = document.getElementById('permission-prompt-remember-label');
  promptRememberCheckbox = document.getElementById('permission-prompt-remember');
  promptAllowBtn = document.getElementById('permission-prompt-allow');
  promptBlockBtn = document.getElementById('permission-prompt-block');
  indicatorBtn = document.getElementById('permission-indicator');
  popoverEl = document.getElementById('permission-popover');
  popoverTitleEl = document.getElementById('permission-popover-title');
  popoverListEl = document.getElementById('permission-popover-list');

  const api = sitePermissions();
  if (!api || !promptEl) {
    pushDebug('[permissions] site permissions UI unavailable (missing API or DOM)');
    return;
  }

  api.onPromptRequest((payload) => {
    if (!payload || typeof payload.id !== 'number') return;
    promptQueue.push({ type: 'request', ...payload });
    showNextPrompt();
  });

  api.onOsDenied((payload) => {
    promptQueue.push({ type: 'os-denied', ...(payload || {}) });
    showNextPrompt();
  });

  api.onChanged(() => {
    refreshIndicator();
  });

  promptAllowBtn?.addEventListener('click', () => respondToActivePrompt('allow'));
  promptBlockBtn?.addEventListener('click', () => respondToActivePrompt('deny'));

  indicatorBtn?.addEventListener('click', () => {
    if (!popoverEl) return;
    if (popoverEl.hidden) {
      renderPopover();
      setPopoverOpen(true);
    } else {
      setPopoverOpen(false);
    }
  });

  // Click-away / Esc dismissal, mirroring the trust popover's handlers.
  document.addEventListener('click', (e) => {
    if (activePrompt && !promptEl.hidden && !promptEl.contains(e.target)) {
      dismissActivePrompt('click-away');
    }
    if (popoverEl && !popoverEl.hidden) {
      if (!popoverEl.contains(e.target) && !(indicatorBtn && indicatorBtn.contains(e.target))) {
        setPopoverOpen(false);
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    dismissActivePrompt('escape');
    if (popoverEl && !popoverEl.hidden) setPopoverOpen(false);
  });

  // Focus loss only closes the indicator popover — never the prompt.
  // The guest <webview> takes focus asynchronously while its page
  // activates, and pages typically request permissions right after
  // load, so dismissing on blur deny-onces the prompt the page just
  // triggered via the blur from its own load stealing focus. Keeping
  // the prompt pending across focus changes matches Chrome and
  // Firefox; it still dismisses on click-away in the chrome, Esc,
  // navigation, and tab switch, and grants nothing by itself.
  window.addEventListener('blur', () => {
    setPopoverOpen(false);
  });

  // Navigating away or switching tabs invalidates the prompt's context.
  document.addEventListener('navigation-completed', () => {
    dismissActivePrompt('navigation');
    refreshIndicator();
  });
  document.addEventListener('active-tab-changed', () => {
    dismissActivePrompt('tab-changed');
    setPopoverOpen(false);
    refreshIndicator();
  });

  refreshIndicator();
};

// Test-only: reset module state between cases.
export const _resetForTests = () => {
  promptQueue = [];
  activePrompt = null;
  indicatorOrigin = null;
  indicatorDecisions = {};
};
