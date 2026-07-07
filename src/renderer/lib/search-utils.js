// Address-bar search providers. Used by the loadTarget fallback in
// navigation.js when typed input matches no protocol, hash, name, or domain.
// The freedom://settings dropdown mirrors this map by hand (its inline script
// cannot import ES modules); a parity test in search-utils.test.js keeps the
// two in sync.
export const SEARCH_PROVIDERS = {
  google: { label: 'Google', searchUrl: 'https://www.google.com/search?q=' },
  duckduckgo: { label: 'DuckDuckGo', searchUrl: 'https://duckduckgo.com/?q=' },
  bing: { label: 'Bing', searchUrl: 'https://www.bing.com/search?q=' },
  brave: { label: 'Brave Search', searchUrl: 'https://search.brave.com/search?q=' },
  ecosia: { label: 'Ecosia', searchUrl: 'https://www.ecosia.org/search?q=' },
  startpage: { label: 'Startpage', searchUrl: 'https://www.startpage.com/sp/search?query=' },
};

export const DEFAULT_SEARCH_PROVIDER = 'google';

// Returns the provider's results URL for `query`, or null for empty input.
// Unknown provider ids fall back to the default so a stale persisted setting
// can never break address-bar search.
export const buildSearchUrl = (query, providerId) => {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (!trimmed) return null;
  const provider = SEARCH_PROVIDERS[providerId] || SEARCH_PROVIDERS[DEFAULT_SEARCH_PROVIDER];
  return `${provider.searchUrl}${encodeURIComponent(trimmed)}`;
};
