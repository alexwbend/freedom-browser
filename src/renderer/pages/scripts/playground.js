// freedom://playground — live smoke test for the Phase 1 navigator.freedom
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
    // Surface the current capability state immediately.
    runCapabilities();
  });
})();
