(function bootFixtureChrome() {
  const broadApiNames = [
    'electronAPI',
    'wallet',
    'identity',
    'swarmProvider',
    'swarmPermissions',
    'dappPermissions',
    'ant',
    'ipfs',
    'radicle',
    'nodeConfig',
  ];

  const setText = (testId, value) => {
    const element = document.querySelector(`[data-test="${testId}"]`);
    if (element) {
      element.textContent = value;
    }
  };

  const setJson = (testId, value) => {
    setText(testId, JSON.stringify(value, null, 2));
  };

  const missingBroadApis = broadApiNames.filter((name) => !(name in window));
  const presentBroadApis = broadApiNames.filter((name) => name in window);
  setText(
    'broad-api-status',
    presentBroadApis.length === 0 ? 'absent' : `present:${presentBroadApis.join(',')}`
  );

  async function loadShellInfo() {
    if (!window.freedomShell || typeof window.freedomShell.getInfo !== 'function') {
      setText('shell-info-status', 'missing-freedomShell');
      return false;
    }

    try {
      const info = await window.freedomShell.getInfo();
      setText('shell-info-status', info.runtimeMode || 'ok');
      setJson('shell-info-json', {
        ...info,
        broadApisAbsent: missingBroadApis,
      });
      return true;
    } catch (error) {
      setText('shell-info-status', `error:${error?.message || error}`);
      return false;
    }
  }

  async function resolveExample() {
    if (!window.freedomShell || typeof window.freedomShell.resolveNavigationInput !== 'function') {
      setText('resolve-nav-status', 'missing-resolver');
      return false;
    }

    try {
      const result = await window.freedomShell.resolveNavigationInput('example.com');
      setText('resolve-nav-status', result.ok ? result.targetUrl : `error:${result.error?.code}`);
      setJson('resolve-nav-json', result);
      return result.ok === true;
    } catch (error) {
      setText('resolve-nav-status', `error:${error?.message || error}`);
      return false;
    }
  }

  async function signalReady() {
    if (!window.freedomShell || typeof window.freedomShell.markReady !== 'function') {
      document.body.dataset.ready = 'missing-mark-ready';
      return;
    }

    try {
      await window.freedomShell.markReady();
      document.body.dataset.ready = 'true';
    } catch (error) {
      document.body.dataset.ready = `error:${error?.message || error}`;
    }
  }

  document.querySelector('[data-test="resolve-nav-button"]')?.addEventListener('click', () => {
    resolveExample();
  });

  (async () => {
    const infoReady = await loadShellInfo();
    const navigationReady = await resolveExample();
    if (infoReady && navigationReady && presentBroadApis.length === 0) {
      await signalReady();
    }
  })();
})();
