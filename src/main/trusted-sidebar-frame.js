(function initTrustedSidebarFrame() {
  function normalizeTheme(theme = {}) {
    const mode = theme.mode === 'light' || theme.mode === 'dark' ? theme.mode : 'system';
    const effective = theme.effective === 'dark' ? 'dark' : 'light';
    return { mode, effective };
  }

  function applyTheme(theme) {
    const normalized = normalizeTheme(theme);
    document.documentElement.dataset.theme = normalized.effective;
    document.documentElement.style.colorScheme = normalized.effective;
    if (document.body) {
      document.body.dataset.theme = normalized.effective;
    }
    return normalized;
  }

  function setText(element, value, { hideWhenEmpty = false } = {}) {
    if (!element) {
      return;
    }
    element.textContent = typeof value === 'string' ? value : '';
    if (hideWhenEmpty) {
      element.hidden = element.textContent.length === 0;
    }
  }

  function setHidden(element, hidden) {
    if (!element) {
      return;
    }
    element.hidden = hidden;
  }

  function createFrameController(options = {}) {
    const root = options.root || document.querySelector('[data-sidebar-frame]');
    const title = root?.querySelector('[data-sidebar-title]') || null;
    const subtitle = root?.querySelector('[data-sidebar-subtitle]') || null;
    const eyebrow = root?.querySelector('[data-sidebar-eyebrow]') || null;
    const closeButton = root?.querySelector('[data-sidebar-close]') || null;
    const layoutToggle = root?.querySelector('[data-sidebar-layout-toggle]') || null;
    const onClose = typeof options.onClose === 'function' ? options.onClose : null;
    const onLayoutToggle =
      typeof options.onLayoutToggle === 'function' ? options.onLayoutToggle : null;
    let currentLayoutMode = 'dock';

    function setLayoutMode(layoutMode, { available = true } = {}) {
      currentLayoutMode = layoutMode === 'overlay' ? 'overlay' : 'dock';
      const frameLayoutMode = available ? currentLayoutMode : 'window';
      document.documentElement.dataset.sidebarLayoutMode = frameLayoutMode;
      if (document.body) {
        document.body.dataset.sidebarLayoutMode = frameLayoutMode;
      }
      if (!layoutToggle) {
        return;
      }
      const nextLayoutMode = currentLayoutMode === 'overlay' ? 'dock' : 'overlay';
      const label = currentLayoutMode === 'overlay' ? 'Dock sidebar' : 'Undock sidebar';
      layoutToggle.title = label;
      layoutToggle.setAttribute('aria-label', label);
      layoutToggle.dataset.layoutMode = currentLayoutMode;
      layoutToggle.dataset.nextLayoutMode = nextLayoutMode;
      setHidden(layoutToggle, !onLayoutToggle || !available);
    }

    function setContext(context = {}) {
      setText(title, context.title || context.heading || options.title || '');
      setText(subtitle, context.subtitle || options.subtitle || '', { hideWhenEmpty: true });
      setText(eyebrow, context.eyebrow || options.eyebrow || '', { hideWhenEmpty: true });
      if (context.theme) {
        applyTheme(context.theme);
      }
      const contextLayoutMode = context.layoutMode === 'overlay' || context.layoutMode === 'dock'
        ? context.layoutMode
        : null;
      const optionLayoutMode = options.layoutMode === 'overlay' || options.layoutMode === 'dock'
        ? options.layoutMode
        : null;
      setLayoutMode(contextLayoutMode || optionLayoutMode || 'dock', {
        available: Boolean(contextLayoutMode || optionLayoutMode),
      });
      if (closeButton && context.title) {
        closeButton.setAttribute('aria-label', `Close ${context.title}`);
      }
    }

    const closeHandler = () => {
      onClose?.();
    };
    const layoutHandler = () => {
      const nextLayoutMode =
        layoutToggle?.dataset.nextLayoutMode ||
        (currentLayoutMode === 'overlay' ? 'dock' : 'overlay');
      onLayoutToggle?.(nextLayoutMode, currentLayoutMode);
    };
    closeButton?.addEventListener('click', closeHandler);
    layoutToggle?.addEventListener('click', layoutHandler);
    setHidden(layoutToggle, true);

    return {
      applyTheme,
      destroy: () => {
        closeButton?.removeEventListener('click', closeHandler);
        layoutToggle?.removeEventListener('click', layoutHandler);
      },
      setContext,
      getLayoutMode: () => currentLayoutMode,
      setLayoutMode,
      setSubtitle: (value) => setText(subtitle, value, { hideWhenEmpty: true }),
      setTitle: (value) => setText(title, value),
    };
  }

  window.trustedSidebarFrame = Object.freeze({
    applyTheme,
    init: createFrameController,
    normalizeTheme,
  });
}());
