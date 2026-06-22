const internalPages = require('./internal-pages.json');

const ALLOWED_FREEDOM_PAGES = Object.freeze(Object.keys(internalPages.routable || {}).sort());

function looksLikeDomain(value) {
  if (typeof value !== 'string' || !value.includes('.')) {
    return false;
  }

  const host = value.split(/[/?#]/, 1)[0];
  if (!host || /\s/.test(host)) {
    return false;
  }

  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}$/i.test(
    host
  );
}

function normalizeHttpUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return {
      kind: url.protocol.slice(0, -1),
      targetUrl: url.toString(),
      displayValue: url.toString(),
    };
  } catch {
    return null;
  }
}

function normalizeFreedomUrl(rawInput) {
  const match = rawInput.match(/^freedom:\/\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?\/?$/i);
  if (!match) {
    return {
      ok: false,
      error: {
        code: 'FREEDOM_URL_INVALID',
        message: 'freedom:// URLs must target a known internal page',
      },
    };
  }

  const pageName = match[1].toLowerCase();
  const subPath = match[2]?.toLowerCase() || '';
  if (!ALLOWED_FREEDOM_PAGES.includes(pageName)) {
    return {
      ok: false,
      error: {
        code: 'FREEDOM_PAGE_NOT_ALLOWED',
        message: 'freedom:// page is not in the shell allowlist',
        allowedPages: ALLOWED_FREEDOM_PAGES,
      },
    };
  }

  const targetUrl = `freedom://${pageName}${subPath ? `/${subPath}` : ''}`;
  return {
    ok: true,
    kind: 'internal',
    targetUrl,
    displayValue: targetUrl,
  };
}

function resolveNavigationInput(input) {
  const rawInput = typeof input === 'string' ? input.trim() : '';
  if (!rawInput) {
    return {
      ok: false,
      input: input ?? '',
      error: {
        code: 'INPUT_EMPTY',
        message: 'Navigation input is required',
      },
    };
  }

  const directHttpUrl = normalizeHttpUrl(rawInput);
  if (directHttpUrl) {
    return {
      ok: true,
      input: rawInput,
      ...directHttpUrl,
    };
  }

  if (looksLikeDomain(rawInput)) {
    const targetUrl = `https://${rawInput}`;
    return {
      ok: true,
      input: rawInput,
      kind: 'https',
      targetUrl,
      displayValue: targetUrl,
    };
  }

  if (rawInput.toLowerCase().startsWith('freedom://')) {
    const freedomUrl = normalizeFreedomUrl(rawInput);
    if (!freedomUrl.ok) {
      return {
        ok: false,
        input: rawInput,
        error: freedomUrl.error,
      };
    }
    return {
      ok: true,
      input: rawInput,
      kind: freedomUrl.kind,
      targetUrl: freedomUrl.targetUrl,
      displayValue: freedomUrl.displayValue,
    };
  }

  return {
    ok: false,
    input: rawInput,
    error: {
      code: 'INPUT_UNRESOLVED',
      message: 'Navigation input could not be resolved by shell API v0',
    },
  };
}

module.exports = {
  ALLOWED_FREEDOM_PAGES,
  resolveNavigationInput,
};
