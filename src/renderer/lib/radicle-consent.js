/**
 * Radicle provider consent prompts.
 *
 * Self-contained modal dialogs (own DOM overlay) for the three consent
 * moments of the window.radicle provider:
 *  - connect: origin wants access to the user's Radicle node
 *  - seed: origin asks the node to seed a repository (disk + bandwidth)
 *  - signing: origin wants to act as the user's Radicle identity
 *
 * Unlike the Swarm prompts (screens inside the identity-wallet sidebar),
 * these are standalone: the Radicle integration is gated on its own
 * experimental setting, independent of the wallet feature.
 */

let overlay = null;
let pending = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'radicle-consent-overlay';
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'background:rgba(0,0,0,0.5)',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'z-index:10000',
  ].join(';');

  const card = document.createElement('div');
  card.id = 'radicle-consent-card';
  card.style.cssText = [
    'background:var(--bg-primary, #1c1c1e)',
    'color:var(--text-primary, #f2f2f7)',
    'border:1px solid var(--border-color, #3a3a3c)',
    'border-radius:12px',
    'width:380px',
    'max-width:90vw',
    'padding:20px',
    'font-size:14px',
    'box-shadow:0 8px 40px rgba(0,0,0,0.4)',
  ].join(';');

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <span style="font-size:20px;">🌱</span>
      <strong id="radicle-consent-title" style="font-size:15px;"></strong>
    </div>
    <div id="radicle-consent-origin" style="font-family:monospace;font-size:12px;
      padding:6px 10px;border:1px solid var(--border-color, #3a3a3c);border-radius:6px;
      margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
    <div id="radicle-consent-body" style="line-height:1.5;margin-bottom:16px;
      color:var(--text-secondary, #aeaeb2);"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="radicle-consent-reject" style="padding:7px 14px;border-radius:6px;
        border:1px solid var(--border-color, #3a3a3c);background:transparent;
        color:inherit;cursor:pointer;">Cancel</button>
      <button id="radicle-consent-approve" style="padding:7px 14px;border-radius:6px;
        border:none;background:#238636;color:#fff;cursor:pointer;font-weight:600;"></button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  card.querySelector('#radicle-consent-approve').addEventListener('click', () => finish(true));
  card.querySelector('#radicle-consent-reject').addEventListener('click', () => finish(false));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) finish(false);
  });

  return overlay;
}

function finish(approved) {
  if (!pending) return;
  const { resolve, reject } = pending;
  pending = null;
  overlay.style.display = 'none';
  if (approved) resolve();
  else reject({ code: 4001, message: 'User rejected the request' });
}

/**
 * Show a consent prompt. Resolves on approve, rejects {code:4001} on cancel.
 * Only one prompt can be active; a second request while one is showing is
 * rejected immediately (prevents prompt-queue confusion from spammy pages).
 */
function prompt({ title, origin, body, approveLabel }) {
  return new Promise((resolve, reject) => {
    if (pending) {
      reject({ code: 4001, message: 'Another consent prompt is already open' });
      return;
    }
    const el = ensureOverlay();
    el.querySelector('#radicle-consent-title').textContent = title;
    el.querySelector('#radicle-consent-origin').textContent = origin;
    el.querySelector('#radicle-consent-body').innerHTML = body;
    el.querySelector('#radicle-consent-approve').textContent = approveLabel;
    pending = { resolve, reject };
    el.style.display = 'flex';
  });
}

const escapeHtml = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function showRadicleConnect(permissionKey) {
  return prompt({
    title: 'Connect to your Radicle node?',
    origin: permissionKey,
    body: 'This site wants to interact with your Radicle node: see its status, list seeded repositories, and request seeding or syncing. It cannot write anything as you without a separate approval.',
    approveLabel: 'Connect',
  });
}

export function showRadicleSeedApproval(permissionKey, rid) {
  return prompt({
    title: 'Seed this repository?',
    origin: permissionKey,
    body: `This site asks your node to seed<br><code style="font-size:12px">${escapeHtml(rid)}</code><br>Your node will download the repository and share it with the network, using disk space and bandwidth until you unseed it.`,
    approveLabel: 'Seed repository',
  });
}

export function showRadicleSigningApproval(permissionKey) {
  return prompt({
    title: 'Act as your Radicle identity?',
    origin: permissionKey,
    body: 'This site wants to know your Radicle identity and author content as you: open issues, comment, and change issue states. Everything it writes is signed with your key, published to the Radicle network, and cannot be unpublished.',
    approveLabel: 'Allow',
  });
}
