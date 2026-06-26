(function initSurfaceRail() {
  const SURFACE_LABELS = Object.freeze({
    wallet: 'Wallet',
  });

  const railApi = window.freedomSurfaceRail || null;
  const toggleButton = document.querySelector('[data-rail-toggle]');
  const surfaceButtons = new Map(
    [...document.querySelectorAll('[data-rail-surface]')].map((button) => [
      button.dataset.railSurface,
      button,
    ])
  );
  let currentState = {
    activeSurface: null,
    lastActiveSurface: 'wallet',
    surfaces: [],
  };

  function getSurfaceLabel(surface) {
    return SURFACE_LABELS[surface] || 'Sidebar';
  }

  function getSurfaceOpen(surface) {
    return currentState.surfaces?.some((entry) => entry.surface === surface && entry.open === true);
  }

  function setButtonLabel(button, label) {
    if (!button) {
      return;
    }
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  function renderState(state = {}) {
    currentState = {
      activeSurface: typeof state.activeSurface === 'string' ? state.activeSurface : null,
      lastActiveSurface:
        typeof state.lastActiveSurface === 'string' ? state.lastActiveSurface : 'wallet',
      surfaces: Array.isArray(state.surfaces) ? state.surfaces : [],
    };

    const isOpen = Boolean(currentState.activeSurface);
    const lastSurface = currentState.lastActiveSurface || 'wallet';
    toggleButton?.setAttribute('data-open', String(isOpen));
    toggleButton?.setAttribute('data-active', String(isOpen));
    setButtonLabel(
      toggleButton,
      isOpen ? 'Close sidebar' : `Open ${getSurfaceLabel(lastSurface)} sidebar`
    );

    surfaceButtons.forEach((button, surface) => {
      const open = getSurfaceOpen(surface);
      button.setAttribute('aria-pressed', String(open));
      button.dataset.active = String(currentState.activeSurface === surface);
      setButtonLabel(button, open ? `${getSurfaceLabel(surface)} is open` : `Open ${getSurfaceLabel(surface)}`);
    });
  }

  async function sendCommand(command, payload = {}) {
    if (!railApi || typeof railApi.command !== 'function') {
      return;
    }
    try {
      const result = await railApi.command(command, payload);
      if (result?.railState) {
        renderState(result.railState);
      }
    } catch {
      // The rail is a launcher; command errors leave the current visual state intact.
    }
  }

  toggleButton?.addEventListener('click', () => {
    sendCommand('toggle-last-surface');
  });

  surfaceButtons.forEach((button, surface) => {
    button.addEventListener('click', () => {
      sendCommand('open-surface', { surface });
    });
  });

  railApi?.onState?.(renderState);
  renderState(currentState);
  sendCommand('sync-state');
}());
