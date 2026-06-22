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

  if (/^freedom:\/\/[a-z0-9-]+/i.test(rawInput)) {
    return {
      ok: true,
      input: rawInput,
      kind: 'internal',
      targetUrl: rawInput,
      displayValue: rawInput,
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
  resolveNavigationInput,
};
