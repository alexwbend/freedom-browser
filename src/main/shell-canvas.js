(function initShellCanvas() {
  const canvasApi = window.freedomShellCanvas || null;
  const paneHost = document.querySelector('[data-shell-canvas-panes]');
  const paneElements = new Map();

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
  }

  canvasApi?.onState?.(renderState);
  renderState({
    canvasTheme: 'dark',
    panes: [],
  });
  canvasApi?.ready?.();
}());
