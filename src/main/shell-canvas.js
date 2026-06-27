(function initShellCanvas() {
  const canvasApi = window.freedomShellCanvas || null;
  const paneHost = document.querySelector('[data-shell-canvas-panes]');
  const runningAppsHost = document.querySelector('[data-shell-running-apps]');
  const launcher = document.querySelector('[data-shell-app-launcher]');
  const launchBrowserButton = document.querySelector('[data-shell-launch-app="browser"]');
  const appStatus = document.querySelector('[data-shell-app-status]');
  const paneElements = new Map();
  let currentBrowserState = {
    status: 'idle',
    snapshotDataUrl: '',
  };

  function normalizeTheme(theme) {
    return theme === 'light' ? 'light' : 'dark';
  }

  function normalizeNumber(value) {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }

  function normalizeBounds(bounds = {}) {
    return {
      x: normalizeNumber(bounds.x),
      y: normalizeNumber(bounds.y),
      width: normalizeNumber(bounds.width),
      height: normalizeNumber(bounds.height),
    };
  }

  function getPaneElement(id) {
    if (paneElements.has(id)) {
      return paneElements.get(id);
    }
    const element = document.createElement('div');
    element.className = 'shell-canvas-pane-shadow';
    element.dataset.pane = id;
    paneHost?.appendChild(element);
    paneElements.set(id, element);
    return element;
  }

  function prunePaneElements(activeIds) {
    paneElements.forEach((element, id) => {
      if (activeIds.has(id)) {
        return;
      }
      element.remove();
      paneElements.delete(id);
    });
  }

  function getBrowserAppState(state = {}) {
    const launcherState = state.launcher && typeof state.launcher === 'object'
      ? state.launcher
      : {};
    const appState = launcherState.browser && typeof launcherState.browser === 'object'
      ? launcherState.browser
      : {};
    return {
      visible: launcherState.visible !== false,
      status: typeof appState.status === 'string' ? appState.status : 'idle',
      error: typeof appState.error === 'string' ? appState.error : '',
      snapshotDataUrl:
        typeof appState.snapshotDataUrl === 'string' ? appState.snapshotDataUrl : '',
    };
  }

  function renderLauncher(state = {}) {
    if (!launcher) {
      return;
    }
    const browser = getBrowserAppState(state);
    currentBrowserState = browser;
    launcher.hidden = !browser.visible;
    launcher.dataset.status = browser.status;
    if (launchBrowserButton) {
      launchBrowserButton.disabled = browser.status === 'launching';
      launchBrowserButton.setAttribute('aria-busy', browser.status === 'launching' ? 'true' : 'false');
    }
    if (!appStatus) {
      return;
    }
    if (browser.status === 'launching') {
      appStatus.textContent = 'Opening...';
    } else if (browser.status === 'failed') {
      appStatus.textContent = browser.error || 'Could not open';
    } else if (browser.status === 'minimized') {
      appStatus.textContent = 'Running';
    } else {
      appStatus.textContent = 'Open the web';
    }
  }

  function renderRunningApps(state = {}) {
    if (!runningAppsHost) {
      return;
    }
    const browser = getBrowserAppState(state);
    runningAppsHost.replaceChildren();
    runningAppsHost.hidden = !(browser.visible && browser.status === 'minimized');
    if (runningAppsHost.hidden) {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shell-running-app-card';
    button.dataset.shellActivateApp = 'browser';
    button.setAttribute('aria-label', 'Restore Browser');
    button.title = 'Restore Browser';

    const preview = document.createElement('span');
    preview.className = 'shell-running-app-card__preview';
    if (browser.snapshotDataUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = browser.snapshotDataUrl;
      preview.appendChild(image);
    }

    const label = document.createElement('span');
    label.className = 'shell-running-app-card__label';
    label.textContent = 'Browser';

    button.append(preview, label);
    runningAppsHost.appendChild(button);
  }

  function renderPane(pane = {}) {
    const id = typeof pane.id === 'string' && pane.id ? pane.id : 'pane';
    const bounds = normalizeBounds(pane.bounds);
    const radius = normalizeNumber(pane.radius);
    const element = getPaneElement(id);
    element.style.transform = `translate(${bounds.x}px, ${bounds.y}px)`;
    element.style.width = `${bounds.width}px`;
    element.style.height = `${bounds.height}px`;
    element.style.borderRadius = `${radius}px`;
    element.hidden = bounds.width <= 0 || bounds.height <= 0;
    return id;
  }

  function renderState(state = {}) {
    const canvasTheme = normalizeTheme(state.canvasTheme);
    document.documentElement.dataset.canvasTheme = canvasTheme;
    document.body.dataset.canvasTheme = canvasTheme;
    if (typeof state.backgroundColor === 'string') {
      document.documentElement.style.backgroundColor = state.backgroundColor;
      document.body.style.backgroundColor = state.backgroundColor;
    }

    const activeIds = new Set();
    (Array.isArray(state.panes) ? state.panes : []).forEach((pane) => {
      activeIds.add(renderPane(pane));
    });
    prunePaneElements(activeIds);
    renderLauncher(state);
    renderRunningApps(state);
  }

  async function sendAppCommand(command, app = 'browser') {
    if (!canvasApi?.command) {
      return null;
    }
    return canvasApi.command(command, { app });
  }

  async function launchBrowser() {
    if (!canvasApi?.command || !launchBrowserButton) {
      return;
    }
    launchBrowserButton.disabled = true;
    launchBrowserButton.setAttribute('aria-busy', 'true');
    if (appStatus) {
      appStatus.textContent = 'Opening...';
    }
    try {
      const command = currentBrowserState.status === 'minimized'
        ? 'activate-app'
        : 'launch-app';
      const result = await sendAppCommand(command);
      if (result?.ok === false && appStatus) {
        appStatus.textContent = result.error?.message || 'Could not open';
        launchBrowserButton.disabled = false;
        launchBrowserButton.setAttribute('aria-busy', 'false');
      }
    } catch (error) {
      if (appStatus) {
        appStatus.textContent = error?.message || 'Could not open';
      }
      launchBrowserButton.disabled = false;
      launchBrowserButton.setAttribute('aria-busy', 'false');
    }
  }

  launchBrowserButton?.addEventListener('click', launchBrowser);
  runningAppsHost?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-shell-activate-app]');
    const app = button?.dataset?.shellActivateApp;
    if (!app) {
      return;
    }
    sendAppCommand('activate-app', app).catch(() => {});
  });

  canvasApi?.onState?.(renderState);
  renderState({
    canvasTheme: 'dark',
    panes: [],
    launcher: {
      visible: true,
      browser: {
        status: 'idle',
        snapshotDataUrl: '',
      },
    },
  });
  canvasApi?.ready?.();
}());
