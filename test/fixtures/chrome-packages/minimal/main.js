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
    'serviceRegistry',
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

  async function resolveNavigationMatrix() {
    const shell = window.freedomShell || {};
    if (typeof shell.resolveNavigationInput !== 'function') {
      setText('nav-matrix-status', 'missing-resolver');
      return false;
    }

    const swarmHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const ipfsCid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
    const ipnsKey = 'k51qzi5uqu5dgkkr5wjh0m796f9u3tou74wn2q2u3shgh6yn52ce4hitig3if4';
    const radicleId = 'z3gqcJUoA1n9HaHKufZs5FCSGazv5';
    const cases = {
      http: 'http://example.com/path',
      https: 'https://example.com/path',
      bareDomain: 'example.com/path',
      freedomHome: 'freedom://home',
      freedomSettings: 'freedom://settings',
      bzz: `bzz://${swarmHash}/index.html`,
      ipfs: `ipfs://${ipfsCid}/readme`,
      ipns: `ipns://${ipnsKey}/docs`,
      ensBare: 'vitalik.eth/docs',
      ensTransportAssertion: 'bzz://meinhard.eth/path',
      radicle: `rad:${radicleId}/tree/main`,
    };

    try {
      const results = {};
      for (const [name, input] of Object.entries(cases)) {
        results[name] = await shell.resolveNavigationInput(input);
      }
      setJson('nav-matrix-json', results);

      const ok =
        results.http?.kind === 'http' &&
        results.https?.kind === 'https' &&
        results.bareDomain?.targetUrl === 'https://example.com/path' &&
        results.freedomHome?.targetUrl === 'freedom://home' &&
        results.freedomSettings?.targetUrl === 'freedom://settings' &&
        results.bzz?.kind === 'swarm' &&
        results.ipfs?.kind === 'ipfs' &&
        results.ipns?.kind === 'ipns' &&
        results.ensBare?.kind === 'ens' &&
        results.ensTransportAssertion?.assertedTransport === 'bzz' &&
        results.radicle?.kind === 'radicle';
      setText('nav-matrix-status', ok ? 'ok' : 'error:matrix-result');
      return ok;
    } catch (error) {
      setText('nav-matrix-status', `error:${error?.message || error}`);
      return false;
    }
  }

  async function exerciseTabs() {
    const shell = window.freedomShell || {};
    for (const method of [
      'getTabSnapshot',
      'createTab',
      'navigateTab',
      'goHome',
      'activateTab',
      'closeTab',
      'onTabCommandResult',
      'onTabSnapshotChanged',
    ]) {
      if (typeof shell[method] !== 'function') {
        setText('tabs-status', `missing-${method}`);
        return false;
      }
    }

    try {
      const tabCommandEvents = [];
      const tabSnapshotEvents = [];
      const disposeTabCommandResult = shell.onTabCommandResult((event) => {
        tabCommandEvents.push(event);
      });
      const disposeTabSnapshotChanged = shell.onTabSnapshotChanged((snapshot) => {
        tabSnapshotEvents.push(snapshot);
      });
      const before = await shell.getTabSnapshot();
      const originalTabId = before.activeTabId;
      const created = await shell.createTab({ url: 'https://example.org' });
      const createdTabId = created.tabId;
      const navigated = await shell.navigateTab(createdTabId, 'https://example.net/path');
      const homed = await shell.goHome(createdTabId);
      const activated = await shell.activateTab(originalTabId);
      const missingClose = await shell.closeTab(9999);
      const closed = await shell.closeTab(createdTabId);
      await new Promise((resolve) => setTimeout(resolve, 25));
      disposeTabCommandResult();
      disposeTabSnapshotChanged();
      const result = {
        before,
        created,
        navigated,
        homed,
        activated,
        missingClose,
        closed,
        tabCommandEvents,
        tabSnapshotEvents,
      };
      setJson('tabs-json', result);

      const ok =
        created.ok === true &&
        navigated.ok === true &&
        homed.ok === true &&
        activated.ok === true &&
        missingClose.ok === false &&
        missingClose.snapshotChanged === false &&
        closed.ok === true &&
        tabCommandEvents.length >= 6 &&
        tabSnapshotEvents.length >= 5 &&
        closed.snapshot?.activeTabId === originalTabId;
      setText('tabs-status', ok ? 'ok' : 'error:command-result');
      return ok;
    } catch (error) {
      setText('tabs-status', `error:${error?.message || error}`);
      return false;
    }
  }

  async function exerciseSurfaces() {
    const shell = window.freedomShell || {};
    for (const method of ['getSurfaceState', 'openSurface', 'closeSurface', 'toggleSurface']) {
      if (typeof shell[method] !== 'function') {
        setText('surfaces-status', `missing-${method}`);
        return false;
      }
    }

    try {
      const initial = await shell.getSurfaceState('wallet');
      const opened = await shell.openSurface('wallet');
      const toggled = await shell.toggleSurface('wallet');
      const closed = await shell.closeSurface('wallet');
      const unsupported = await shell.openSurface('unknown');
      const result = {
        initial,
        opened,
        toggled,
        closed,
        unsupported,
      };
      setJson('surfaces-json', result);

      const ok =
        initial.ok === true &&
        initial.open === false &&
        initial.owner === 'shell' &&
        initial.mode === 'shell-owned-trusted-window' &&
        opened.ok === true &&
        opened.open === true &&
        toggled.ok === true &&
        toggled.open === false &&
        closed.ok === true &&
        closed.open === false &&
        unsupported.ok === false &&
        unsupported.error?.code === 'SURFACE_UNSUPPORTED';
      setText('surfaces-status', ok ? 'ok' : 'error:surface-result');
      return ok;
    } catch (error) {
      setText('surfaces-status', `error:${error?.message || error}`);
      return false;
    }
  }

  async function exerciseTrustedPrompt() {
    const shell = window.freedomShell || {};
    if (typeof shell.requestTestTrustedPrompt !== 'function') {
      setText('trusted-prompt-status', 'missing-requestTestTrustedPrompt');
      return false;
    }

    try {
      const result = await shell.requestTestTrustedPrompt({
        kind: 'test.confirmation',
        reason: 'Fixture package broker check',
        origin: 'https://spoofed.example',
        tabId: 999,
      });
      setJson('trusted-prompt-json', result);

      const ok =
        result.ok === true &&
        result.trusted === true &&
        result.surfaceOwner === 'shell' &&
        result.renderedBy === 'trusted-prompt-broker' &&
        result.context?.source === 'main' &&
        result.context?.origin === null &&
        result.context?.tabId === null &&
        result.context?.caller?.packageId === 'baby.freedom.chrome.fixture' &&
        result.result?.outcome === 'accepted' &&
        result.result?.source === 'test-only-broker';
      setText('trusted-prompt-status', ok ? 'ok' : 'error:prompt-result');
      return ok;
    } catch (error) {
      setText('trusted-prompt-status', `error:${error?.message || error}`);
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
    const matrixReady = await resolveNavigationMatrix();
    const tabsReady = await exerciseTabs();
    const surfacesReady = await exerciseSurfaces();
    const trustedPromptReady = await exerciseTrustedPrompt();
    if (
      infoReady &&
      navigationReady &&
      matrixReady &&
      tabsReady &&
      surfacesReady &&
      trustedPromptReady &&
      presentBroadApis.length === 0
    ) {
      await signalReady();
    }
  })();
})();
