// Drives the navigator.freedom test site against the page-realm globals the
// Freedom Browser webview preload injects into every origin (navigator.freedom
// + window.ethereum + window.swarm). Plain browser script — no bundler.

(function () {
  'use strict';

  var account = null;

  function $(id) {
    return document.getElementById(id);
  }

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

  function setPill(id, present) {
    var el = $(id);
    el.textContent = present ? 'present' : 'missing';
    el.className = 'pill ' + (present ? 'ok' : 'err');
  }

  // ---- detection -----------------------------------------------------------

  function runDetection() {
    $('origin').textContent = window.location.origin;

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
      log('navigator.freedom is NOT present — open this page in Freedom Browser', 'err');
    }

    setPill('detect-eth', typeof window.ethereum !== 'undefined');
    setPill('detect-swarm', typeof window.swarm !== 'undefined');
    return present;
  }

  function ensureFreedom() {
    if (typeof navigator.freedom === 'undefined') {
      log('navigator.freedom is missing — open this page in Freedom Browser', 'err');
      return false;
    }
    return true;
  }

  // ---- capabilities ----------------------------------------------------------

  function runCapabilities() {
    if (!ensureFreedom()) return;
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
    if (!ensureFreedom()) return;
    log('wallet.request(eth_requestAccounts) …');
    navigator.freedom.wallet.request({ method: 'eth_requestAccounts' }).then(
      function (accounts) {
        account = accounts && accounts[0];
        $('account').textContent = account || 'no account';
        $('account').className = account ? 'pill ok' : 'pill err';
        $('sign-btn').disabled = !account;
        log('connected: ' + account, 'ok');
      },
      function (err) {
        $('account').textContent = describeError(err);
        $('account').className = 'pill err';
        log('connect failed — ' + describeError(err), 'err');
      }
    );
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
    if (!ensureFreedom()) return;
    var text = $('content').value;
    var contentType = $('ctype').value || undefined;
    var blob = new Blob([text], { type: contentType || 'text/plain' });
    log('storage.upload({ network: "' + network + '" }) …');
    navigator.freedom.storage
      .upload({ data: blob, network: network, contentType: contentType })
      .then(
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
    if (!ensureFreedom()) return;
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

  // ---- permissions -----------------------------------------------------------

  function permission(kind) {
    if (!ensureFreedom()) return;
    var name = $('perm-name').value.trim();
    if (!name) {
      log('permissions: enter a permission name first', 'err');
      return;
    }
    log('permissions.' + kind + '({ name: "' + name + '" }) …');
    navigator.freedom.permissions[kind]({ name: name }).then(
      function (status) {
        $('perm-out').textContent = pretty(status);
        log('permissions.' + kind + '(' + name + ') → ' + pretty(status), 'ok');
      },
      function (err) {
        $('perm-out').textContent = describeError(err);
        log('permissions.' + kind + '(' + name + ') rejected — ' + describeError(err), 'err');
      }
    );
  }

  // ---- wiring ----------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    runDetection();
    $('caps-btn').addEventListener('click', runCapabilities);
    $('connect-btn').addEventListener('click', connectWallet);
    $('sign-btn').addEventListener('click', signMessage);
    $('publish-btn').addEventListener('click', function () {
      publish('swarm');
    });
    $('publish-ipfs-btn').addEventListener('click', function () {
      publish('ipfs');
    });
    $('resolve-btn').addEventListener('click', resolveName);
    $('perm-query-btn').addEventListener('click', function () {
      permission('query');
    });
    $('perm-request-btn').addEventListener('click', function () {
      permission('request');
    });
    // Surface the current capability state immediately.
    runCapabilities();
  });
})();
