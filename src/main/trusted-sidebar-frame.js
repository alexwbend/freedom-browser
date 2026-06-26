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

  function setText(element, value) {
    if (!element) {
      return;
    }
    element.textContent = typeof value === 'string' ? value : '';
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

    function setLayoutMode(layoutMode) {
      if (!layoutToggle) {
        return;
      }
      const label = layoutMode === 'overlay' ? 'Overlay' : 'Docked';
      layoutToggle.title = `${label} sidebar`;
      layoutToggle.setAttribute('aria-label', `${label} sidebar`);
      layoutToggle.dataset.layoutMode = layoutMode === 'overlay' ? 'overlay' : 'dock';
      setHidden(layoutToggle, !onLayoutToggle);
    }

    function setContext(context = {}) {
      setText(title, context.title || context.heading || options.title || '');
      setText(subtitle, context.subtitle || options.subtitle || '');
      setText(eyebrow, context.eyebrow || options.eyebrow || 'Trusted shell surface');
      if (context.theme) {
        applyTheme(context.theme);
      }
      setLayoutMode(context.layoutMode || options.layoutMode || 'dock');
      if (closeButton && context.title) {
        closeButton.setAttribute('aria-label', `Close ${context.title}`);
      }
    }

    const closeHandler = () => {
      onClose?.();
    };
    const layoutHandler = () => {
      onLayoutToggle?.(layoutToggle?.dataset.layoutMode || 'dock');
    };
    closeButton?.addEventListener('click', closeHandler);
    layoutToggle?.addEventListener('click', layoutHandler);
    setHidden(layoutToggle, !onLayoutToggle);

    return {
      applyTheme,
      destroy: () => {
        closeButton?.removeEventListener('click', closeHandler);
        layoutToggle?.removeEventListener('click', layoutHandler);
      },
      setContext,
      setLayoutMode,
      setSubtitle: (value) => setText(subtitle, value),
      setTitle: (value) => setText(title, value),
    };
  }

  window.trustedSidebarFrame = Object.freeze({
    applyTheme,
    init: createFrameController,
    normalizeTheme,
  });
}());
