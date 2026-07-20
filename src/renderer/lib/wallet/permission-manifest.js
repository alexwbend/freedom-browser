import { walletState, registerScreenHider, hideAllSubscreens } from './wallet-state.js';
import { open as openSidebarPanel } from '../sidebar.js';

let screen;
let site;
let name;
let description;
let rows;
let identityNote;
let pending = null;

export function initPermissionManifest() {
  screen = document.getElementById('sidebar-swarm-manifest');
  site = document.getElementById('swarm-manifest-site');
  name = document.getElementById('swarm-manifest-name');
  description = document.getElementById('swarm-manifest-description');
  rows = document.getElementById('swarm-manifest-rows');
  identityNote = document.getElementById('swarm-manifest-identity-note');

  document.getElementById('swarm-manifest-reject')?.addEventListener('click', () => settle('deny'));
  document.getElementById('swarm-manifest-individual')?.addEventListener('click', () => settle('individual'));
  document.getElementById('swarm-manifest-allow')?.addEventListener('click', () => settle('allow'));
  document.getElementById('swarm-manifest-back')?.addEventListener('click', () => settle('deny'));

  registerScreenHider(() => {
    const wasVisible = screen && !screen.classList.contains('hidden');
    screen?.classList.add('hidden');
    if (wasVisible && pending) settle('deny');
  });
}

export function showPermissionManifest(model) {
  return new Promise((resolve) => {
    pending = { resolve };
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
  });
}

function settle(outcome) {
  if (!pending) return;
  const { resolve } = pending;
  pending = null;
  screen?.classList.add('hidden');
  walletState.identityView?.classList.remove('hidden');
  resolve(outcome);
}
