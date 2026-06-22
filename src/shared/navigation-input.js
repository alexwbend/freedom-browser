const internalPages = require('./internal-pages.json');
const { isEnsHost } = require('./origin-utils');

const ALLOWED_FREEDOM_PAGES = Object.freeze(Object.keys(internalPages.routable || {}).sort());
const SUPPORTED_ENS_TRANSPORTS = Object.freeze(['bzz', 'ipfs', 'ipns']);
const DWEB_PROTOCOL_KINDS = Object.freeze({
  bzz: 'swarm',
  ipfs: 'ipfs',
  ipns: 'ipns',
});

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

function isValidRadicleId(value) {
  return typeof value === 'string' && /^z[1-9A-HJ-NP-Za-km-z]{20,60}$/.test(value);
}

function splitReferenceAndSuffix(value) {
  const match = String(value || '').match(/^([^/?#]+)([/?#].*)?$/);
  if (!match) {
    return null;
  }
  return {
    reference: match[1],
    suffix: match[2] || '',
  };
}

function makeProtocolUrl(protocol, reference, suffix = '') {
  return `${protocol}://${reference}${suffix || ''}`;
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

function parseEnsNavigationInput(rawInput) {
  let value = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!value) {
    return null;
  }

  const lower = value.toLowerCase();
  let assertedTransport = null;
  let inputProtocol = null;
  for (const protocol of ['ens', ...SUPPORTED_ENS_TRANSPORTS]) {
    const prefix = `${protocol}://`;
    if (lower.startsWith(prefix)) {
      value = value.slice(prefix.length);
      inputProtocol = protocol;
      assertedTransport = protocol === 'ens' ? null : protocol;
      break;
    }
  }

  const parsed = splitReferenceAndSuffix(value);
  if (!parsed || !isEnsHost(parsed.reference)) {
    return null;
  }

  const name = parsed.reference.toLowerCase();
  return {
    name,
    suffix: parsed.suffix,
    assertedTransport,
    inputProtocol,
  };
}

function normalizeEnsNavigationInput(rawInput) {
  const ens = parseEnsNavigationInput(rawInput);
  if (!ens) {
    return null;
  }

  const protocol = ens.inputProtocol || 'ens';
  const targetUrl = makeProtocolUrl(protocol, ens.name, ens.suffix);
  return {
    ok: true,
    input: rawInput,
    kind: 'ens',
    targetUrl,
    displayValue: ens.inputProtocol ? targetUrl : `${ens.name}${ens.suffix}`,
    name: ens.name,
    suffix: ens.suffix,
    assertedTransport: ens.assertedTransport,
  };
}

function normalizeDwebProtocolUrl(rawInput) {
  const match = rawInput.match(/^(bzz|ipfs|ipns):\/\/([^/?#]+)([/?#].*)?$/i);
  if (!match) {
    return null;
  }

  const protocol = match[1].toLowerCase();
  const reference = match[2];
  const suffix = match[3] || '';
  if (!reference || /\s/.test(reference) || isEnsHost(reference)) {
    return null;
  }

  const targetUrl = makeProtocolUrl(protocol, reference, suffix);
  return {
    ok: true,
    input: rawInput,
    kind: DWEB_PROTOCOL_KINDS[protocol],
    protocol,
    reference,
    suffix,
    targetUrl,
    displayValue: targetUrl,
  };
}

function normalizeRadicleUrl(rawInput) {
  const value = rawInput.replace(/^rad:\/\//i, '').replace(/^rad:/i, '').replace(/^\/+/, '');
  if (value === rawInput) {
    return null;
  }

  const parsed = splitReferenceAndSuffix(value);
  if (!parsed || !isValidRadicleId(parsed.reference)) {
    return {
      ok: false,
      input: rawInput,
      error: {
        code: 'RADICLE_ID_INVALID',
        message: 'Radicle URLs must target a valid Radicle repository id',
      },
    };
  }

  const targetUrl = makeProtocolUrl('rad', parsed.reference, parsed.suffix);
  return {
    ok: true,
    input: rawInput,
    kind: 'radicle',
    protocol: 'rad',
    rid: parsed.reference,
    suffix: parsed.suffix,
    targetUrl,
    displayValue: targetUrl,
  };
}

function getEnsContenthashError(input, ens, resolution) {
  if (!resolution || typeof resolution !== 'object') {
    return {
      ok: false,
      input,
      error: {
        code: 'ENS_CONTENTHASH_UNAVAILABLE',
        message: 'ENS contenthash result is required',
        name: ens.name,
      },
    };
  }
  if (resolution.type === 'conflict') {
    return {
      ok: false,
      input,
      error: {
        code: 'ENS_CONTENTHASH_CONFLICT',
        message: 'ENS contenthash resolution returned conflicting records',
        name: ens.name,
        groups: resolution.groups || [],
        trust: resolution.trust || null,
      },
    };
  }
  if (resolution.type === 'not_found') {
    return {
      ok: false,
      input,
      error: {
        code: 'ENS_CONTENTHASH_NOT_FOUND',
        message: 'ENS name has no supported contenthash record',
        name: ens.name,
        reason: resolution.reason || null,
      },
    };
  }
  if (resolution.type !== 'ok') {
    return {
      ok: false,
      input,
      error: {
        code: 'ENS_CONTENTHASH_UNAVAILABLE',
        message: 'ENS contenthash resolution did not return a usable result',
        name: ens.name,
        reason: resolution.reason || resolution.type || null,
      },
    };
  }
  return null;
}

function resolveEnsContenthashNavigation(input, resolution) {
  const rawInput = typeof input === 'string' ? input.trim() : '';
  const ens = parseEnsNavigationInput(rawInput);
  if (!ens) {
    return {
      ok: false,
      input: rawInput,
      error: {
        code: 'ENS_INPUT_INVALID',
        message: 'ENS navigation requires a bare ENS name or ens/bzz/ipfs/ipns ENS URL',
      },
    };
  }

  const resolutionError = getEnsContenthashError(rawInput, ens, resolution);
  if (resolutionError) {
    return resolutionError;
  }

  const resolvedProtocol = String(resolution.protocol || '').toLowerCase();
  const resolvedTarget = normalizeDwebProtocolUrl(resolution.uri || '');
  if (
    !SUPPORTED_ENS_TRANSPORTS.includes(resolvedProtocol) ||
    !resolvedTarget ||
    resolvedTarget.protocol !== resolvedProtocol
  ) {
    return {
      ok: false,
      input: rawInput,
      error: {
        code: 'ENS_CONTENTHASH_UNSUPPORTED',
        message: 'ENS contenthash resolved to an unsupported transport',
        name: ens.name,
        protocol: resolution.protocol || null,
        uri: resolution.uri || null,
      },
    };
  }

  if (ens.assertedTransport && ens.assertedTransport !== resolvedProtocol) {
    return {
      ok: false,
      input: rawInput,
      error: {
        code: 'ENS_TRANSPORT_MISMATCH',
        message: 'ENS contenthash transport did not match the asserted URL transport',
        name: ens.name,
        assertedTransport: ens.assertedTransport,
        resolvedTransport: resolvedProtocol,
        uri: resolution.uri,
      },
    };
  }

  const targetUrl = makeProtocolUrl(resolvedProtocol, resolvedTarget.reference, ens.suffix);
  const displayValue = makeProtocolUrl(resolvedProtocol, ens.name, ens.suffix);
  return {
    ok: true,
    input: rawInput,
    kind: DWEB_PROTOCOL_KINDS[resolvedProtocol],
    protocol: resolvedProtocol,
    targetUrl,
    displayValue,
    ens: {
      name: ens.name,
      suffix: ens.suffix,
      assertedTransport: ens.assertedTransport,
      resolvedTransport: resolvedProtocol,
    },
    contenthash: {
      uri: resolution.uri,
      reference: resolvedTarget.reference,
      trust: resolution.trust || null,
    },
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

  const ensInput = normalizeEnsNavigationInput(rawInput);
  if (ensInput) {
    return ensInput;
  }
  if (rawInput.toLowerCase().startsWith('ens://')) {
    return {
      ok: false,
      input: rawInput,
      error: {
        code: 'ENS_NAME_INVALID',
        message: 'ENS URLs must target an .eth or .box name',
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

  const decentralizedUrl = normalizeDwebProtocolUrl(rawInput);
  if (decentralizedUrl) {
    return decentralizedUrl;
  }

  const radicleUrl = normalizeRadicleUrl(rawInput);
  if (radicleUrl) {
    return radicleUrl;
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
  SUPPORTED_ENS_TRANSPORTS,
  parseEnsNavigationInput,
  resolveEnsContenthashNavigation,
  resolveNavigationInput,
};
