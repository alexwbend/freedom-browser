// freedom://playground — live smoke test for the navigator.freedom
// surface. Uses the page-realm globals injected by the webview preload
// (navigator.freedom + window.ethereum), not the internal freedomAPI bridge.

(function () {
  'use strict';

  var account = null;

  var $ = function (id) {
    return document.getElementById(id);
  };

  function log(message, kind) {
    var el = $('log');
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

  // ---- call snippets ---------------------------------------------------------
  // Mirror the exact navigator.freedom call each control runs, so the page is a
  // copy-pasteable reference and not just a black-box of buttons.

  function setCall(id, code) {
    var el = $(id);
    if (el) el.textContent = code;
  }

  function copyText(text) {
    // Internal freedom:// pages run inside a sandboxed webview where the async
    // Clipboard API is blocked (the main-process permission handler denies it
    // and freedom:// is not a secure context). Route through the preload bridge,
    // which copies via Electron's main-process clipboard, with API fallbacks.
    if (window.freedomAPI && typeof window.freedomAPI.copyText === 'function') {
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

  function renderCalls() {
    var msg = ($('sign-msg') && $('sign-msg').value) || '';
    var contentType = ($('ctype') && $('ctype').value) || '';
    var name = ($('dweb-name') && $('dweb-name').value.trim()) || '';

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
  }

  // ---- detection -----------------------------------------------------------

  function runDetection() {
    var present = typeof navigator.freedom !== 'undefined';
    var detect = $('detect');
    var version = $('version');
    if (present) {
      detect.textContent = 'present';
      detect.className = 'pill ok';
      version.textContent = 'v' + (navigator.freedom.version || '?');
      version.className = 'pill ok';
      log('navigator.freedom detected (version ' + navigator.freedom.version + ')', 'ok');
    } else {
      detect.textContent = 'missing';
      detect.className = 'pill err';
      version.textContent = 'unavailable';
      version.className = 'pill err';
      log('navigator.freedom is NOT present — injection failed', 'err');
    }
    return present;
  }

  // ---- capabilities ----------------------------------------------------------

  function runCapabilities() {
    if (typeof navigator.freedom === 'undefined') {
      log('cannot call capabilities(): navigator.freedom missing', 'err');
      return;
    }
    log('capabilities() …');
    navigator.freedom.capabilities().then(
      function (caps) {
        $('caps-out').textContent = pretty(caps);
        log('capabilities() resolved', 'ok');
      },
      function (err) {
        $('caps-out').textContent = describeError(err);
        log('capabilities() rejected — ' + describeError(err), 'err');
      }
    );
  }

  // ---- wallet ----------------------------------------------------------------

  function connectWallet() {
    log('wallet.request(eth_requestAccounts) …');
    navigator.freedom.wallet.request({ method: 'eth_requestAccounts' }).then(
      function (accounts) {
        account = accounts && accounts[0];
        $('account').textContent = account || 'no account';
        $('account').className = account ? 'pill ok' : 'pill err';
        $('sign-btn').disabled = !account;
        $('disconnect-btn').disabled = !account;
        log('connected: ' + account, 'ok');
      },
      function (err) {
        $('account').textContent = describeError(err);
        $('account').className = 'pill err';
        log('connect failed — ' + describeError(err), 'err');
      }
    );
  }

  function disconnectWallet() {
    // EIP-1193 has no dapp-initiated disconnect and the wallet exposes no
    // revoke method to the page, so this clears the page's own session state.
    // The browser keeps the granted permission until revoked from the wallet UI.
    account = null;
    $('account').textContent = 'not connected';
    $('account').className = 'pill';
    $('sign-btn').disabled = true;
    $('disconnect-btn').disabled = true;
    $('sign-out').textContent = '';
    log('wallet disconnected (cleared page session)', 'info');
  }

  function signMessage() {
    if (!account) {
      log('sign: connect a wallet first', 'err');
      return;
    }
    var msg = $('sign-msg').value;
    log('wallet.request(personal_sign) …');
    navigator.freedom.wallet
      .request({ method: 'personal_sign', params: [msg, account] })
      .then(
        function (signature) {
          $('sign-out').textContent = signature;
          log('signed: ' + signature, 'ok');
        },
        function (err) {
          $('sign-out').textContent = describeError(err);
          log('sign failed — ' + describeError(err), 'err');
        }
      );
  }

  // ---- storage ---------------------------------------------------------------

  function publish(network) {
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
        var out = $('publish-out');
        out.textContent = '';
        out.appendChild(document.createTextNode(pretty(result) + '\n'));
        if (result.url) {
          var a = document.createElement('a');
          a.href = result.url;
          a.textContent = 'open ' + result.url;
          out.appendChild(a);
        }
        log('uploaded → ' + result.url, 'ok');
      },
      function (err) {
        $('publish-out').textContent = describeError(err);
        log('upload(' + network + ') rejected — ' + describeError(err), 'err');
      }
    );
  }

  // ---- dweb ------------------------------------------------------------------

  function resolveName() {
    var name = $('dweb-name').value.trim();
    if (!name) {
      log('dweb.resolve: enter a name first', 'err');
      return;
    }
    log('dweb.resolve("' + name + '") …');
    navigator.freedom.dweb.resolve(name).then(
      function (result) {
        var out = $('resolve-out');
        out.textContent = '';
        out.appendChild(document.createTextNode(pretty(result) + '\n'));
        if (result.url) {
          var a = document.createElement('a');
          a.href = result.url;
          a.textContent = 'open ' + result.url;
          out.appendChild(a);
        }
        log('resolved ' + name + ' → ' + result.url, 'ok');
      },
      function (err) {
        $('resolve-out').textContent = describeError(err);
        log('dweb.resolve(' + name + ') rejected — ' + describeError(err), 'err');
      }
    );
  }

  // ---- wiring ----------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    runDetection();
    $('caps-btn').addEventListener('click', runCapabilities);
    $('connect-btn').addEventListener('click', connectWallet);
    $('disconnect-btn').addEventListener('click', disconnectWallet);
    $('sign-btn').addEventListener('click', signMessage);
    $('publish-btn').addEventListener('click', function () {
      publish('swarm');
    });
    $('resolve-btn').addEventListener('click', resolveName);

    // Keep the call snippets in sync with the current inputs.
    renderCalls();
    ['sign-msg', 'ctype', 'dweb-name'].forEach(function (id) {
      $(id).addEventListener('input', renderCalls);
    });
    wireCopyButtons();

    // Surface the current capability state immediately.
    runCapabilities();
  });
})();
