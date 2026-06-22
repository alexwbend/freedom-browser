const { resolveNavigationInput } = require('./navigation-input');

describe('navigation-input', () => {
  test('normalizes bare domains to https URLs', () => {
    expect(resolveNavigationInput('example.com')).toEqual({
      ok: true,
      input: 'example.com',
      kind: 'https',
      targetUrl: 'https://example.com',
      displayValue: 'https://example.com',
    });
  });

  test('preserves explicit http and https URLs', () => {
    expect(resolveNavigationInput('http://example.com/path')).toMatchObject({
      ok: true,
      kind: 'http',
      targetUrl: 'http://example.com/path',
    });
    expect(resolveNavigationInput('https://example.com/path')).toMatchObject({
      ok: true,
      kind: 'https',
      targetUrl: 'https://example.com/path',
    });
  });

  test('recognizes internal freedom URLs without renderer involvement', () => {
    expect(resolveNavigationInput('freedom://settings')).toEqual({
      ok: true,
      input: 'freedom://settings',
      kind: 'internal',
      targetUrl: 'freedom://settings',
      displayValue: 'freedom://settings',
    });
    expect(resolveNavigationInput('FREEDOM://SETTINGS/PROFILES')).toEqual({
      ok: true,
      input: 'FREEDOM://SETTINGS/PROFILES',
      kind: 'internal',
      targetUrl: 'freedom://settings/profiles',
      displayValue: 'freedom://settings/profiles',
    });
  });

  test('rejects freedom URLs outside the shell allowlist', () => {
    expect(resolveNavigationInput('freedom://wallet-seed')).toMatchObject({
      ok: false,
      input: 'freedom://wallet-seed',
      error: {
        code: 'FREEDOM_PAGE_NOT_ALLOWED',
      },
    });
    expect(resolveNavigationInput('freedom://settings/profile/extra')).toMatchObject({
      ok: false,
      input: 'freedom://settings/profile/extra',
      error: {
        code: 'FREEDOM_URL_INVALID',
      },
    });
  });

  test('rejects empty and unresolved inputs with structured errors', () => {
    expect(resolveNavigationInput('   ')).toMatchObject({
      ok: false,
      error: { code: 'INPUT_EMPTY' },
    });
    expect(resolveNavigationInput('not a url')).toMatchObject({
      ok: false,
      input: 'not a url',
      error: { code: 'INPUT_UNRESOLVED' },
    });
  });
});
