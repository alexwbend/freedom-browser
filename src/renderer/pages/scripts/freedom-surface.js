// Shared driver for both navigator.freedom exercisers:
//   - the internal freedom://playground page (src/renderer/pages/playground.html)
//   - the standalone demo site (test/freedom-api-demo/index.html), served over
//     a real http:// origin.
//
// One implementation, two pages. Controls are wired only when their elements
// exist, so each page includes whichever cards it wants without the script
// caring. The only environment branch is the clipboard transport: window.freedomAPI
// is injected on every page but only functions on internal file: pages, so the
// document protocol (not the presence of the bridge) is the honest discriminator.

(function () {
  'use strict';

  var account = null;

  // Internal freedom:// pages load as file:; the demo loads over http(s).
  var isInternalPage = window.location.protocol === 'file:';

  var $ = function (id) {
    return document.getElementById(id);
  };

  function on(id, event, handler) {
    var el = $(id);
    if (el) el.addEventListener(event, handler);
  }

  function log(message, kind) {
    var el = $('log');
    if (!el) return;
    var line = document.createElement('div');
    var ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = new Date().toLocaleTimeString() + '  ';
    var body = document.createElement('span');
    body.className = 'l-' + (kind || 'info');
    body.textContent = message;
    line.appendChild(ts);
    line.appendChild(body);
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  function describeError(err) {
    if (!err) return 'unknown error';
    var name = err.name || 'Error';
    var reason = err.reason ? ' [' + err.reason + ']' : '';
    return name + ': ' + (err.message || String(err)) + reason;
  }

  function pretty(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function ensureFreedom() {
    if (typeof navigator.freedom === 'undefined') {
      log('navigator.freedom is missing — open this page in Freedom Browser', 'err');
      return false;
    }
    return true;
  }

  function renderResult(outId, result) {
    var out = $(outId);
    if (!out) return;
    out.textContent = '';
    out.appendChild(document.createTextNode(pretty(result) + '\n'));
    if (result && result.url) {
      var a = document.createElement('a');
      a.href = result.url;
      a.textContent = 'open ' + result.url;
      out.appendChild(a);
    }
  }

  // ---- call snippets ---------------------------------------------------------
  // Mirror the exact navigator.freedom call each control runs, so the page is a
  // copy-pasteable reference and not just a black-box of buttons. setCall no-ops
  // when the snippet element is absent, so a page can omit any of these.

  function setCall(id, code) {
    var el = $(id);
    if (el) el.textContent = code;
  }

  function renderCalls() {
    var msg = ($('sign-msg') && $('sign-msg').value) || '';
    var contentType = ($('ctype') && $('ctype').value) || '';
    var name = ($('dweb-name') && $('dweb-name').value.trim()) || '';
    var permName = ($('perm-name') && $('perm-name').value.trim()) || '';

    setCall(
      'detect-call',
      'const has = {\n' +
        "  freedom: typeof navigator.freedom !== 'undefined',\n" +
        "  ethereum: typeof window.ethereum !== 'undefined',\n" +
        "  swarm: typeof window.swarm !== 'undefined',\n" +
        '};'
    );
    setCall('caps-call', 'await navigator.freedom.capabilities()');
    setCall(
      'connect-call',
      "await navigator.freedom.wallet.request({ method: 'eth_requestAccounts' })"
    );
    setCall(
      'sign-call',
      'await navigator.freedom.wallet.request({\n' +
        "  method: 'personal_sign',\n" +
        '  params: [' + JSON.stringify(msg) + ', account]\n' +
        '})'
    );
    setCall(
      'publish-call',
      'await navigator.freedom.storage.upload({\n' +
        '  data: blob,\n' +
        "  network: 'swarm',\n" +
        '  contentType: ' + JSON.stringify(contentType || undefined) + '\n' +
        '})'
    );
    setCall('resolve-call', 'await navigator.freedom.dweb.resolve(' + JSON.stringify(name) + ')');
    setCall(
      'perm-call',
      'await navigator.freedom.permissions.query(' + JSON.stringify({ name: permName }) + ')'
    );
  }

  function copyText(text) {
    // Internal freedom:// pages run inside a sandboxed webview where the async
    // Clipboard API is blocked (the main-process permission handler denies it
    // and freedom:// is not a secure context), so route through the preload
    // bridge. On the demo's real http origin freedomAPI.copyText would reject,
    // hence the protocol gate plus the standard Clipboard API fallbacks.
    if (isInternalPage && window.freedomAPI && typeof window.freedomAPI.copyText === 'function') {
      return Promise.resolve(window.freedomAPI.copyText(text)).then(function (res) {
        if (res && res.success === false) {
          throw new Error(res.error || 'clipboard copy failed');
        }
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error('copy command was rejected'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function wireCopyButtons() {
    var buttons = document.querySelectorAll('.copy');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var target = $(btn.getAttribute('data-copy'));
        if (!target) return;
        copyText(target.textContent).then(
          function () {
            var label = btn.textContent;
            btn.textContent = 'copied';
            btn.classList.add('copied');
            log('copied call: ' + target.textContent.replace(/\s+/g, ' '), 'ok');
            setTimeout(function () {
              btn.textContent = label;
              btn.classList.remove('copied');
            }, 1200);
          },
          function (err) {
            log('copy failed — ' + describeError(err), 'err');
          }
        );
      });
    });
  }

  // ---- detection -------------------------------------------------------------

  function runDetection() {
    if ($('origin')) $('origin').textContent = window.location.origin;

    var present = typeof navigator.freedom !== 'undefined';
    var version = $('version');
    if (version) {
      version.textContent = present ? 'API v' + (navigator.freedom.version || '?') : 'unavailable';
      version.className = 'pill ' + (present ? 'ok' : 'err');
    }

    var result = {
      'navigator.freedom': present,
      'window.ethereum': typeof window.ethereum !== 'undefined',
      'window.swarm': typeof window.swarm !== 'undefined',
      version: present ? navigator.freedom.version || null : null,
    };
    if ($('detect-out')) $('detect-out').textContent = pretty(result);

    log(
      present
        ? 'navigator.freedom detected (version ' + navigator.freedom.version + ')'
        : 'navigator.freedom is NOT present — open this page in Freedom Browser',
      present ? 'ok' : 'err'
    );
    return present;
  }

  // ---- capabilities ----------------------------------------------------------

  function runCapabilities() {
    if (!ensureFreedom()) return;
    log('capabilities() …');
    navigator.freedom.capabilities().then(
      function (caps) {
        if ($('caps-out')) $('caps-out').textContent = pretty(caps);
        log('capabilities() resolved', 'ok');
      },
      function (err) {
        if ($('caps-out')) $('caps-out').textContent = describeError(err);
        log('capabilities() rejected — ' + describeError(err), 'err');
      }
    );
  }

  // ---- wallet ----------------------------------------------------------------

  function connectWallet() {
    if (!ensureFreedom()) return;
    log('wallet.request(eth_requestAccounts) …');
    navigator.freedom.wallet.request({ method: 'eth_requestAccounts' }).then(
      function (accounts) {
        account = accounts && accounts[0];
        if ($('account')) {
          $('account').textContent = account || 'no account';
          $('account').className = account ? 'pill ok' : 'pill err';
        }
        if ($('sign-btn')) $('sign-btn').disabled = !account;
        if ($('disconnect-btn')) $('disconnect-btn').disabled = !account;
        log('connected: ' + account, 'ok');
      },
      function (err) {
        if ($('account')) {
          $('account').textContent = describeError(err);
          $('account').className = 'pill err';
        }
        log('connect failed — ' + describeError(err), 'err');
      }
    );
  }

  function disconnectWallet() {
    // EIP-1193 has no dapp-initiated disconnect and the wallet exposes no
    // revoke method to the page, so this clears the page's own session state.
    // The browser keeps the granted permission until revoked from the wallet UI.
    account = null;
    if ($('account')) {
      $('account').textContent = 'not connected';
      $('account').className = 'pill';
    }
    if ($('sign-btn')) $('sign-btn').disabled = true;
    if ($('disconnect-btn')) $('disconnect-btn').disabled = true;
    if ($('sign-out')) $('sign-out').textContent = '';
    log('wallet disconnected (cleared page session)', 'info');
  }

  function signMessage() {
    if (!ensureFreedom()) return;
    if (!account) {
      log('sign: connect a wallet first', 'err');
      return;
    }
    var msg = $('sign-msg').value;
    log('wallet.request(personal_sign) …');
    navigator.freedom.wallet.request({ method: 'personal_sign', params: [msg, account] }).then(
      function (signature) {
        if ($('sign-out')) $('sign-out').textContent = signature;
        log('signed: ' + signature, 'ok');
      },
      function (err) {
        if ($('sign-out')) $('sign-out').textContent = describeError(err);
        log('sign failed — ' + describeError(err), 'err');
      }
    );
  }

  // ---- storage ---------------------------------------------------------------

  function publish(network) {
    if (!ensureFreedom()) return;
    var text = $('content').value;
    var contentType = $('ctype').value || undefined;
    var blob = new Blob([text], { type: contentType || 'text/plain' });
    setCall(
      'publish-call',
      'await navigator.freedom.storage.upload({\n' +
        '  data: blob,\n' +
        '  network: ' + JSON.stringify(network) + ',\n' +
        '  contentType: ' + JSON.stringify(contentType) + '\n' +
        '})'
    );
    log('storage.upload({ network: "' + network + '" }) …');
    navigator.freedom.storage.upload({ data: blob, network: network, contentType: contentType }).then(
      function (result) {
        renderResult('publish-out', result);
        log('uploaded → ' + result.url, 'ok');
      },
      function (err) {
        if ($('publish-out')) $('publish-out').textContent = describeError(err);
        log('upload(' + network + ') rejected — ' + describeError(err), 'err');
      }
    );
  }

  // ---- dweb ------------------------------------------------------------------

  function resolveName() {
    if (!ensureFreedom()) return;
    var name = $('dweb-name').value.trim();
    if (!name) {
      log('dweb.resolve: enter a name first', 'err');
      return;
    }
    log('dweb.resolve("' + name + '") …');
    navigator.freedom.dweb.resolve(name).then(
      function (result) {
        renderResult('resolve-out', result);
        log('resolved ' + name + ' → ' + result.url, 'ok');
      },
      function (err) {
        if ($('resolve-out')) $('resolve-out').textContent = describeError(err);
        log('dweb.resolve(' + name + ') rejected — ' + describeError(err), 'err');
      }
    );
  }

  // ---- permissions -----------------------------------------------------------

  function permission(kind) {
    if (!ensureFreedom()) return;
    var name = $('perm-name').value.trim();
    if (!name) {
      log('permissions: enter a permission name first', 'err');
      return;
    }
    setCall(
      'perm-call',
      'await navigator.freedom.permissions.' + kind + '(' + JSON.stringify({ name: name }) + ')'
    );
    log('permissions.' + kind + '({ name: "' + name + '" }) …');
    navigator.freedom.permissions[kind]({ name: name }).then(
      function (status) {
        if ($('perm-out')) $('perm-out').textContent = pretty(status);
        log('permissions.' + kind + '(' + name + ') → ' + pretty(status), 'ok');
      },
      function (err) {
        if ($('perm-out')) $('perm-out').textContent = describeError(err);
        log('permissions.' + kind + '(' + name + ') rejected — ' + describeError(err), 'err');
      }
    );
  }

  // ---- wiring ----------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    on('detect-btn', 'click', runDetection);
    on('caps-btn', 'click', runCapabilities);
    on('connect-btn', 'click', connectWallet);
    on('disconnect-btn', 'click', disconnectWallet);
    on('sign-btn', 'click', signMessage);
    on('publish-btn', 'click', function () {
      publish('swarm');
    });
    on('resolve-btn', 'click', resolveName);
    on('perm-query-btn', 'click', function () {
      permission('query');
    });
    on('perm-request-btn', 'click', function () {
      permission('request');
    });

    // Keep the call snippets in sync with the current inputs.
    renderCalls();
    ['sign-msg', 'ctype', 'dweb-name', 'perm-name'].forEach(function (id) {
      on(id, 'input', renderCalls);
    });
    wireCopyButtons();
  });
})();
