/**
 * Sidebar Module
 *
 * Manages the right-side identity & wallet sidebar.
 * Fixed width (320px), toggle open/closed.
 */

import { getChromeRuntimeApi, isPackageChromeRuntime } from './chrome-runtime-api.js';

const WALLET_SURFACE = 'wallet';

// State
let isOpen = false;
let featureEnabled = false;
let packageSurfaceMode = false;
let runtimeApi;
let packageSurfaceDisposer = null;

// DOM references
let sidebar;
let toggleBtn;
let closeBtn;

/**
 * Initialize the sidebar module
 */
export function initSidebar() {
  sidebar = document.getElementById('sidebar');
  toggleBtn = document.getElementById('wallet-toggle-btn');
  closeBtn = document.getElementById('sidebar-close');

  if (!sidebar || !toggleBtn) {
    console.error('[Sidebar] Required elements not found');
    return;
  }

  runtimeApi = getChromeRuntimeApi();
  packageSurfaceMode = isPackageChromeRuntime();
  cleanupPackageSurfaceSubscription();

  if (packageSurfaceMode) {
    featureEnabled = true;
    configurePackageSurfacePlaceholder();
    applyFeatureVisibility();
    packageSurfaceDisposer = subscribePackageSurfaceState();
    syncPackageSurfaceState();
  } else {
    // Load initial feature flag state
    runtimeApi.getSettings().then((settings) => {
      featureEnabled = settings?.enableIdentityWallet === true;
      applyFeatureVisibility();
    }).catch(() => {
      featureEnabled = false;
      applyFeatureVisibility();
    });

    // React to settings changes
    window.addEventListener('settings:updated', (event) => {
      const wasEnabled = featureEnabled;
      featureEnabled = event.detail?.enableIdentityWallet === true;
      applyFeatureVisibility();
      // Close sidebar if feature was just disabled while open
      if (wasEnabled && !featureEnabled && isOpen) {
        close();
      }
    });
  }

  // Apply initial state (sidebar starts closed)
  applyState();

  // Setup event listeners
  toggleBtn.addEventListener('click', toggle);

  if (closeBtn) {
    closeBtn.addEventListener('click', close);
  }

  // Keyboard shortcut: Cmd/Ctrl+Shift+W
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'W') {
      if (!featureEnabled) return;
      e.preventDefault();
      toggle();
    }
  });

  console.log('[Sidebar] Initialized');
}

/**
 * Show/hide the toolbar toggle button based on feature flag
 */
function applyFeatureVisibility() {
  if (!toggleBtn) return;
  toggleBtn.classList.toggle('hidden', !featureEnabled);
}

/**
 * Toggle sidebar open/closed
 */
export function toggle() {
  if (!featureEnabled) return;
  if (packageSurfaceMode) {
    togglePackageSurface();
    return;
  }
  const wasOpen = isOpen;
  isOpen = !isOpen;
  applyState();
  dispatchVisibilityEvent(wasOpen);
}

/**
 * Open the sidebar
 */
export function open() {
  if (!featureEnabled) return;
  if (packageSurfaceMode) {
    openPackageSurface();
    return;
  }
  if (!isOpen) {
    const wasOpen = isOpen;
    isOpen = true;
    applyState();
    dispatchVisibilityEvent(wasOpen);
  }
}

/**
 * Close the sidebar
 */
export function close() {
  if (packageSurfaceMode) {
    closePackageSurface();
    return;
  }
  if (isOpen) {
    const wasOpen = isOpen;
    isOpen = false;
    applyState();
    dispatchVisibilityEvent(wasOpen);
  }
}

/**
 * Check if sidebar is open
 */
export function isVisible() {
  return isOpen;
}

/**
 * Whether the Identity & Wallet feature flag is on (controls the sidebar).
 */
export function isFeatureEnabled() {
  return featureEnabled;
}

/**
 * Apply current state to DOM
 */
function applyState() {
  if (!sidebar || !toggleBtn) return;

  if (isOpen) {
    sidebar.classList.remove('collapsed');
    toggleBtn.classList.add('active');
    toggleBtn.setAttribute('aria-expanded', 'true');
  } else {
    sidebar.classList.add('collapsed');
    toggleBtn.classList.remove('active');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }
}

function dispatchVisibilityEvent(wasOpen) {
  if (wasOpen && !isOpen) {
    document.dispatchEvent(new CustomEvent('sidebar-closed'));
  } else if (!wasOpen && isOpen) {
    document.dispatchEvent(new CustomEvent('sidebar-opened'));
  }
}

function configurePackageSurfacePlaceholder() {
  sidebar.dataset.surfaceMode = 'shell-owned-placeholder';

  const tabs = sidebar.querySelector('.sidebar-tabs');
  if (tabs) {
    tabs.hidden = true;
  }

  document.getElementById('sidebar-setup-cta')?.classList.add('hidden');
  document.getElementById('sidebar-identity')?.classList.add('hidden');

  const content = sidebar.querySelector('.sidebar-content');
  if (!content || document.getElementById('package-wallet-surface-placeholder')) {
    return;
  }

  const placeholder = document.createElement('div');
  placeholder.id = 'package-wallet-surface-placeholder';
  placeholder.className = 'package-wallet-surface-placeholder';
  placeholder.setAttribute('role', 'status');

  const title = document.createElement('div');
  title.className = 'package-wallet-surface-title';
  title.textContent = 'Wallet surface';

  const body = document.createElement('p');
  body.textContent =
    'Wallet UI remains shell-owned in package mode. This package can only request the surface state.';

  placeholder.append(title, body);
  content.prepend(placeholder);
}

async function syncPackageSurfaceState() {
  const state = await callPackageSurface('getSurfaceState');
  if (state?.ok !== true || state.surface !== WALLET_SURFACE) {
    featureEnabled = false;
    isOpen = false;
    applyFeatureVisibility();
    applyState();
    return;
  }

  applyPackageSurfaceState(state, { dispatch: false });
}

async function togglePackageSurface() {
  const state = await callPackageSurface('toggleSurface');
  applyPackageSurfaceState(state);
}

async function openPackageSurface() {
  const state = await callPackageSurface('openSurface');
  applyPackageSurfaceState(state);
}

async function closePackageSurface() {
  const state = await callPackageSurface('closeSurface');
  applyPackageSurfaceState(state);
}

function subscribePackageSurfaceState() {
  if (typeof runtimeApi?.onSurfaceStateChanged !== 'function') {
    return null;
  }
  const disposer = runtimeApi.onSurfaceStateChanged((state) => {
    applyPackageSurfaceState(state);
  });
  return typeof disposer === 'function' ? disposer : null;
}

function cleanupPackageSurfaceSubscription() {
  if (typeof packageSurfaceDisposer === 'function') {
    packageSurfaceDisposer();
  }
  packageSurfaceDisposer = null;
}

function applyPackageSurfaceState(state, { dispatch = true } = {}) {
  if (state?.ok !== true || state.surface !== WALLET_SURFACE) {
    return false;
  }
  const wasOpen = isOpen;
  isOpen = state.open === true;
  applyState();
  if (dispatch) {
    dispatchVisibilityEvent(wasOpen);
  }
  return wasOpen !== isOpen;
}

async function callPackageSurface(methodName) {
  const method = runtimeApi?.[methodName];
  if (typeof method !== 'function') {
    return null;
  }
  return method(WALLET_SURFACE).catch(() => null);
}
