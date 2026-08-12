import { walletState, registerScreenHider, hideAllSubscreens } from './wallet-state.js';
import { open as openSidebarPanel } from '../sidebar.js';
import { createPromptQueue, setButtonsDisabled } from './prompt-queue.js';

let screen;
let site;
let name;
let description;
let rows;
let identityNote;
let rejectBtn;
let individualBtn;
let allowBtn;

// The manifest sheet owns a single sidebar screen, so concurrent consent
// requests (two tabs on manifest-bearing apps) queue up like every other
// approval prompt instead of overwriting each other.
const manifestQueue = createPromptQueue(presentPermissionManifest, (armed) => {
  setButtonsDisabled([rejectBtn, individualBtn, allowBtn], !armed);
});

export function initPermissionManifest() {
  screen = document.getElementById('sidebar-swarm-manifest');
  site = document.getElementById('swarm-manifest-site');
  name = document.getElementById('swarm-manifest-name');
  description = document.getElementById('swarm-manifest-description');
  rows = document.getElementById('swarm-manifest-rows');
  identityNote = document.getElementById('swarm-manifest-identity-note');
  rejectBtn = document.getElementById('swarm-manifest-reject');
  individualBtn = document.getElementById('swarm-manifest-individual');
  allowBtn = document.getElementById('swarm-manifest-allow');

  rejectBtn?.addEventListener('click', () => settle('deny'));
  individualBtn?.addEventListener('click', () => settle('individual'));
  allowBtn?.addEventListener('click', () => settle('allow'));
  document.getElementById('swarm-manifest-back')?.addEventListener('click', () => settle('deny'));

  registerScreenHider(() => {
    // `presenting` means this queue is showing its own next request — the
    // hideAllSubscreens() inside present() is our transition, not a
    // dismissal (queued requests behind it must survive it).
    if (manifestQueue.presenting) return;
    const wasVisible = screen && !screen.classList.contains('hidden');
    screen?.classList.add('hidden');
    // Dismissing the sheet drops queued requests too — the user never sees
    // them, so leaving them pending would hang the page.
    if (wasVisible) {
      for (const pending of manifestQueue.drain()) pending.resolve('deny');
    }
  });
}

export function showPermissionManifest(model) {
  return new Promise((resolve) => {
    manifestQueue.show({ model, resolve });
  });
}

function presentPermissionManifest({ model }) {
  site.textContent = model.origin;
  name.textContent = model.name;
  description.textContent = model.description;
  description.classList.toggle('hidden', !model.description);
  rows.innerHTML = '';

  for (const capability of model.removed) {
    const row = document.createElement('div');
    row.className = 'swarm-manifest-row';
    const heading = document.createElement('div');
    heading.className = 'swarm-manifest-row-title';
    heading.textContent = `${capability.label} removed`;
    const detail = document.createElement('div');
    detail.className = 'swarm-manifest-row-detail';
    detail.textContent = 'The app no longer requests this capability. Manifest-managed access has been removed.';
    row.append(heading, detail);
    rows.appendChild(row);
  }

  for (const capability of model.changed) {
    const row = document.createElement('div');
    row.className = 'swarm-manifest-row';
    const heading = document.createElement('div');
    heading.className = 'swarm-manifest-row-title';
    heading.textContent = capability.label;
    const detail = document.createElement('div');
    detail.className = 'swarm-manifest-row-detail';
    detail.textContent = capability.why;
    row.append(heading, detail);
    rows.appendChild(row);
  }

  identityNote.classList.toggle('hidden', !model.createsIdentity && !model.preservedIdentity);
  identityNote.textContent = model.createsIdentity
    ? 'A new app-scoped signing identity will be created. Your vault still unlocks at signing time.'
    : model.preservedIdentity
      ? 'Your existing publisher identity will be kept.'
      : '';

  hideAllSubscreens();
  walletState.identityView?.classList.add('hidden');
  screen?.classList.remove('hidden');
  openSidebarPanel();
}

// Every settling path claims the on-screen request first: claim() hands it
// out once, so a repeated click can neither settle it twice nor act on the
// request queued behind it.
function settle(outcome) {
  const pending = manifestQueue.claim();
  if (!pending) return;
  screen?.classList.add('hidden');
  walletState.identityView?.classList.remove('hidden');
  pending.resolve(outcome);
  manifestQueue.settle();
}
