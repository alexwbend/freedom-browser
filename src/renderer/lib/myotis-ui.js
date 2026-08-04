// Myotis embedded Ethereum light-client controls in the Nodes menu.
import { state } from './state.js';
import { pushDebug } from './debug.js';

let toggleButton = null;
let toggleSwitch = null;
let infoPanel = null;
let stateText = null;
let peersCount = null;
let finalizedBlock = null;
let versionText = null;
let latestStatus = null;
let desiredRunning = null;
let reconciling = false;
let listenersAttached = false;
let pollInterval = null;

const isLiveRunning = () => latestStatus?.running === true;
const isEffectivelyRunning = () =>
  desiredRunning === null ? isLiveRunning() : desiredRunning;

const stateLabel = (status) => {
  if (!status) return 'Unavailable';
  if (status.state === 'disabled') return 'Disabled';
  if (status.state === 'unavailable') return 'Unavailable';
  if (status.state === 'error') return 'Error';
  if (status.state === 'off') return 'Off';
  if (status.state === 'ready') return 'Ready';
  if (status.currentPeriod && status.targetPeriod) {
    return `Syncing ${status.currentPeriod}/${status.targetPeriod}`;
  }
  return 'Syncing';
};

const updateControls = (status) => {
  latestStatus = status || null;
  const supported = status?.supported !== false;
  const available = status?.available === true;
  const disabled = status?.state === 'disabled';
  const controllable = supported && available && !disabled;
  const running = isEffectivelyRunning();

  if (toggleButton) {
    toggleButton.hidden = !supported;
    toggleButton.disabled = !controllable;
    toggleButton.classList.toggle('disabled', !controllable);
    if (disabled) {
      toggleButton.title = 'Disabled for this profile in Settings';
    } else if (!available) {
      toggleButton.title = 'Myotis native addon not found';
    } else {
      toggleButton.removeAttribute('title');
    }
  }
  toggleSwitch?.classList.toggle('running', running);
  infoPanel?.classList.toggle('visible', state.antMenuOpen && running);
  if (stateText) stateText.textContent = stateLabel(status);
  if (peersCount) peersCount.textContent = String(status?.peerCount ?? 0);
  if (finalizedBlock) finalizedBlock.textContent = status?.finalizedBlockNumber || '--';
  if (versionText) {
    versionText.textContent = status?.version ? `Myotis v${status.version}` : 'Myotis';
  }
};

const refreshStatus = async () => {
  try {
    updateControls(await window.myotis?.getStatus?.());
  } catch (err) {
    pushDebug(`Myotis status failed: ${err?.message || err}`);
  }
};

export const stopMyotisInfoPolling = () => {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
  infoPanel?.classList.remove('visible');
};

export const startMyotisInfoPolling = () => {
  if (!state.antMenuOpen) return;
  refreshStatus();
  infoPanel?.classList.toggle('visible', isEffectivelyRunning());
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(refreshStatus, 5000);
};

const reconcileToggle = async () => {
  if (reconciling) return;
  reconciling = true;
  try {
    while (desiredRunning !== null && desiredRunning !== isLiveRunning()) {
      const target = desiredRunning;
      try {
        const result = target ? await window.myotis.start() : await window.myotis.stop();
        updateControls(result);
      } catch (err) {
        pushDebug(`Failed to toggle Myotis: ${err?.message || err}`);
        break;
      }
      if (desiredRunning === target && desiredRunning !== isLiveRunning()) break;
    }
  } finally {
    desiredRunning = null;
    reconciling = false;
    updateControls(latestStatus);
  }
};

export const initMyotisUi = () => {
  toggleButton = document.getElementById('myotis-toggle-btn');
  toggleSwitch = document.getElementById('myotis-toggle-switch');
  infoPanel = document.getElementById('myotis-info');
  stateText = document.getElementById('myotis-state-text');
  peersCount = document.getElementById('myotis-peers-count');
  finalizedBlock = document.getElementById('myotis-finalized-block');
  versionText = document.getElementById('myotis-version-text');

  if (listenersAttached) return;
  listenersAttached = true;

  toggleButton?.addEventListener('click', () => {
    if (toggleButton.disabled) return;
    desiredRunning = !isEffectivelyRunning();
    updateControls(latestStatus);
    pushDebug(`User toggled Myotis ${desiredRunning ? 'On' : 'Off'}`);
    reconcileToggle();
  });

  if (window.myotis?.onStatusUpdate) {
    window.myotis.onStatusUpdate(updateControls);
  } else {
    refreshStatus();
  }
};
