import { fuzzyScore, filterTabEntries } from './tab-search-filter.js';

describe('fuzzyScore', () => {
  test('empty query matches everything with score 0', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('', '')).toBe(0);
  });

  test('empty text never matches a non-empty query', () => {
    expect(fuzzyScore('a', '')).toBe(-1);
  });

  test('is case-insensitive', () => {
    expect(fuzzyScore('GITHUB', 'github.com')).toBeGreaterThan(0);
    expect(fuzzyScore('github', 'GitHub — Home')).toBeGreaterThan(0);
  });

  test('substring beats subsequence', () => {
    const substring = fuzzyScore('doc', 'documentation');
    const subsequence = fuzzyScore('doc', 'д d-o!c'); // scattered d..o..c
    expect(substring).toBeGreaterThan(subsequence);
  });

  test('earlier substring match ranks higher', () => {
    expect(fuzzyScore('news', 'news.site.example')).toBeGreaterThan(
      fuzzyScore('news', 'example.site/news')
    );
  });

  test('word-boundary substring gets a bonus over mid-word', () => {
    // Both are substring matches at index > 0; only the one after a
    // separator gets the boundary bonus.
    expect(fuzzyScore('hub', 'git hub')).toBeGreaterThan(fuzzyScore('hub', 'ggithubb'));
  });

  test('subsequence must be in order', () => {
    expect(fuzzyScore('cba', 'abc')).toBe(-1);
    expect(fuzzyScore('abc', 'a1b2c3')).toBeGreaterThan(0);
  });

  test('consecutive subsequence runs beat scattered hits', () => {
    expect(fuzzyScore('abc', 'xxabcyy-z')).toBeGreaterThan(500 - 1); // substring, actually
    // Pure subsequence comparison: "ab" consecutive vs scattered.
    expect(fuzzyScore('abz', 'abxz')).toBeGreaterThan(fuzzyScore('abz', 'axbxz'));
  });
});

describe('filterTabEntries', () => {
  const entries = [
    { id: 1, title: 'New Tab', url: 'freedom://home' },
    { id: 2, title: 'GitHub — build software', url: 'https://github.com/' },
    { id: 3, title: 'Documentation', url: 'https://docs.example/' },
    { id: 4, title: 'Swarm Foundation', url: 'bzz://swarm.eth' },
  ];

  test('empty and whitespace-only queries return all entries in order', () => {
    expect(filterTabEntries(entries, '')).toEqual(entries);
    expect(filterTabEntries(entries, '   ')).toEqual(entries);
    expect(filterTabEntries(entries, undefined)).toEqual(entries);
  });

  test('matches on title', () => {
    const result = filterTabEntries(entries, 'github');
    expect(result.map((e) => e.id)).toEqual([2]);
  });

  test('matches on URL too', () => {
    const result = filterTabEntries(entries, 'bzz');
    expect(result.map((e) => e.id)).toEqual([4]);
  });

  test('takes the better score of title vs URL', () => {
    // "docs" is a substring of tab 3's URL only; the title has no match.
    const result = filterTabEntries(entries, 'docs');
    expect(result.map((e) => e.id)).toEqual([3]);
  });

  test('non-matching queries filter everything out', () => {
    expect(filterTabEntries(entries, 'zzzzqqq')).toEqual([]);
  });

  test('stable order on ties, best match first otherwise', () => {
    const dupes = [
      { id: 1, title: 'Alpha page', url: 'https://a.example' },
      { id: 2, title: 'Alpha page', url: 'https://b.example' },
      { id: 3, title: 'Contains alpha late in title', url: 'https://c.example' },
    ];
    const result = filterTabEntries(dupes, 'alpha');
    // 1 and 2 tie (same title, boundary substring at 0) and keep input order.
    expect(result.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  test('placeholder-shaped entries (persisted title/url only) are searchable', () => {
    const placeholders = [{ id: 9, title: 'Restored Page', url: 'https://restored.example/x' }];
    expect(filterTabEntries(placeholders, 'restored').map((e) => e.id)).toEqual([9]);
  });

  test('tolerates missing fields', () => {
    expect(filterTabEntries([{ id: 1 }], 'a')).toEqual([]);
    expect(filterTabEntries(null, 'a')).toEqual([]);
  });
});
