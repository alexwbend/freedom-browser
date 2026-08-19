// Radicle node UI controls
import { state, getDisplayMessage } from './state.js';
import { pushDebug } from './debug.js';

// DOM elements (initialized in initRadicleUi)
let radicleToggleBtn = null;
let radicleToggleSwitch = null;
let radiclePeersCount = null;
let radicleReposCount = null;
let radicleVersionText = null;
let radicleInfoPanel = null;
let radicleStatusRow = null;
let radicleStatusLabel = null;
let radicleStatusValue = null;
let radicleNodesSection = null;

// Binary availability state
let radicleBinaryAvailable = true;

// Polling state
let radicleInfoInterval = null;

export const stopRadicleInfoPolling = () => {
  if (radicleInfoInterval) {
    clearInterval(radicleInfoInterval);
    radicleInfoInterval = null;
  }
  radicleInfoPanel?.classList.remove('visible');
  if (radiclePeersCount) radiclePeersCount.textContent = '0';
  if (radicleReposCount) radicleReposCount.textContent = '--';
  if (radicleVersionText) radicleVersionText.textContent = state.radicleVersionFetched ? state.radicleVersionValue : '';
};

const updateRadicleSectionVisibility = () => {
  const enabled = state.enableRadicleIntegration === true;
  radicleNodesSection?.classList.toggle('hidden', !enabled);
  if (!enabled) {
    stopRadicleInfoPolling();
    radicleToggleSwitch?.classList.remove('running');
  }
};

const fetchRadicleInfo = async () => {
  if (!state.antMenuOpen) return;
  if (state.currentRadicleStatus === 'stopped') {
    stopRadicleInfoPolling();
    return;
  }
  if (!radicleInfoPanel?.classList.contains('visible')) return;

  // Fetch node information through the preload bridge. The internal radapi:
  // protocol deliberately does not grant cross-origin access to the renderer.
  if (window.radicle?.getConnections) {
    try {
      const info = await window.radicle.getConnections();
      if (!radicleInfoPanel?.classList.contains('visible')) return;
      if (info.success && radiclePeersCount) {
        radiclePeersCount.textContent = String(info.count);
      } else if (radiclePeersCount) {
        radiclePeersCount.textContent = '0';
      }
      if (radicleReposCount) {
        radicleReposCount.textContent = Number.isInteger(info.reposCount)
          ? String(info.reposCount)
          : '--';
      }
      if (typeof info.version === 'string' && info.version) {
        state.radicleVersionValue = `libradicle v${info.version}`;
        state.radicleVersionFetched = true;
      }
      if (radicleVersionText) {
        radicleVersionText.textContent = state.radicleVersionValue || '--';
      }
    } catch {
      if (radiclePeersCount) radiclePeersCount.textContent = '0';
      if (radicleReposCount) radicleReposCount.textContent = '--';
      if (radicleVersionText) {
        radicleVersionText.textContent = state.radicleVersionValue || '--';
      }
    }
  }
};

export const startRadicleInfoPolling = () => {
  if (!state.enableRadicleIntegration) {
    stopRadicleInfoPolling();
    return;
  }
  if (!state.antMenuOpen || state.currentRadicleStatus === 'stopped') {
    stopRadicleInfoPolling();
    return;
  }

  radicleInfoPanel?.classList.add('visible');

  fetchRadicleInfo();

  if (radicleInfoInterval) clearInterval(radicleInfoInterval);
  radicleInfoInterval = setInterval(fetchRadicleInfo, 2000);
};

export const updateRadicleUi = (status, error) => {
  if (!state.enableRadicleIntegration) {
    state.currentRadicleStatus = 'stopped';
    return;
  }
  if (state.suppressRadicleRunningStatus && status === 'running') {
    return;
  }
  if (status === 'stopped' || status === 'error') {
    state.suppressRadicleRunningStatus = false;
  }

  state.currentRadicleStatus = status;

  // Update status line from registry.
  updateRadicleStatusLine();

  if (!radicleToggleBtn || !radicleToggleSwitch) return;

  radicleToggleSwitch.classList.remove('running');
  switch (status) {
    case 'running':
    case 'starting':
      radicleToggleSwitch.classList.add('running');
      break;
    case 'error':
      if (error) pushDebug(`Radicle Error: ${error}`);
      break;
    case 'stopping':
    case 'stopped':
    default:
      // Clear status row when stopped
      if (radicleStatusRow) radicleStatusRow.classList.remove('visible');
      break;
  }

  if (state.antMenuOpen) {
    if (status === 'stopped') {
      stopRadicleInfoPolling();
    } else if (!radicleInfoInterval && radicleToggleSwitch?.classList.contains('running')) {
      startRadicleInfoPolling();
    }
  }
};

const setToggleDisabled = (disabled) => {
  if (!radicleToggleBtn) return;

  if (disabled) {
    radicleToggleBtn.classList.add('disabled');
    radicleToggleBtn.setAttribute('disabled', 'true');
    radicleToggleBtn.setAttribute('title', 'Radicle binaries not found');
  } else {
    radicleToggleBtn.classList.remove('disabled');
    radicleToggleBtn.removeAttribute('disabled');
    radicleToggleBtn.removeAttribute('title');
  }
};

const refreshRadicleBinaryAvailability = () => {
  if (!window.radicle?.checkBinary) return;
  window.radicle.checkBinary().then(({ available }) => {
    radicleBinaryAvailable = available;
    setToggleDisabled(!available);
    if (!available) {
      pushDebug('Radicle binaries not found - toggle disabled');
    }
  });
};

// Update the status row from registry
export const updateRadicleStatusLine = () => {
  if (!state.enableRadicleIntegration) return;
  if (!radicleStatusRow || !radicleStatusLabel || !radicleStatusValue) return;

  const message = getDisplayMessage('radicle');

  if (message) {
    // Parse "Label: value" format
    const colonIndex = message.indexOf(':');
    if (colonIndex > 0) {
      radicleStatusLabel.textContent = message.substring(0, colonIndex + 1);
      radicleStatusValue.textContent = message.substring(colonIndex + 1).trim();
    } else {
      // Fallback for messages without colon
      radicleStatusLabel.textContent = message;
      radicleStatusValue.textContent = '';
    }
    radicleStatusRow.classList.add('visible');
  } else {
    radicleStatusLabel.textContent = '';
    radicleStatusValue.textContent = '';
    radicleStatusRow.classList.remove('visible');
  }
};

export const initRadicleUi = () => {
  // Initialize DOM elements
  radicleToggleBtn = document.getElementById('radicle-toggle-btn');
  radicleToggleSwitch = document.getElementById('radicle-toggle-switch');
  radiclePeersCount = document.getElementById('radicle-peers-count');
  radicleReposCount = document.getElementById('radicle-repos-count');
  radicleVersionText = document.getElementById('radicle-version-text');
  radicleInfoPanel = document.querySelector('.radicle-info');
  radicleStatusRow = document.getElementById('radicle-status-row');
  radicleStatusLabel = document.getElementById('radicle-status-label');
  radicleStatusValue = document.getElementById('radicle-status-value');
  radicleNodesSection = document.getElementById('radicle-nodes-section');
  updateRadicleSectionVisibility();

  // Check binary availability
  refreshRadicleBinaryAvailability();

  // Toggle button listener
  radicleToggleBtn?.addEventListener('click', () => {
    if (!state.enableRadicleIntegration) return;
    if (!radicleBinaryAvailable) return;

    if (state.currentRadicleStatus === 'running' || state.currentRadicleStatus === 'starting') {
      state.suppressRadicleRunningStatus = true;
      radicleToggleSwitch?.classList.remove('running');
      stopRadicleInfoPolling();
      pushDebug('User toggled Radicle Off');
      window.radicle
        .stop()
        .then(({ status, error }) => updateRadicleUi(status, error))
        .catch((err) => {
          console.error('Failed to toggle Radicle', err);
          pushDebug(`Failed to toggle Radicle: ${err.message}`);
        });
    } else {
      state.suppressRadicleRunningStatus = false;
      radicleToggleSwitch?.classList.add('running');
      startRadicleInfoPolling();
      pushDebug('User toggled Radicle On');
      window.radicle
        .start()
        .then(({ status, error }) => updateRadicleUi(status, error))
        .catch((err) => {
          console.error('Failed to toggle Radicle', err);
          pushDebug(`Failed to toggle Radicle: ${err.message}`);
        });
    }
  });

  // Listen for status updates from main process
  if (window.radicle) {
    const handleStatus = ({ status, error }) => {
      pushDebug(`Radicle Status Update: ${status} ${error ? `(${error})` : ''}`);
      updateRadicleUi(status, error);
    };
    window.radicle.onStatusUpdate(handleStatus);

    // Initial status check
    const refreshRadicleStatus = () => {
      window.radicle.getStatus().then(({ status, error }) => {
        updateRadicleUi(status, error);
      });
    };
    refreshRadicleStatus();
    setInterval(refreshRadicleStatus, 5000);
  }

  window.addEventListener('settings:updated', (event) => {
    const wasEnabled = state.enableRadicleIntegration === true;
    const isEnabled = event.detail?.enableRadicleIntegration === true;
    state.enableRadicleIntegration = isEnabled;
    updateRadicleSectionVisibility();
    if (!wasEnabled && isEnabled) {
      refreshRadicleBinaryAvailability();
    }
  });
};
