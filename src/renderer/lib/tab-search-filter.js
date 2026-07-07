// Fuzzy filtering for the tab search popover (tab-search.js). Pure module —
// no DOM, no tab-state imports — so the ranking rules are unit-testable in
// isolation.

/**
 * Score how well `query` matches `text` (case-insensitive).
 *
 * Ranking, best to worst:
 *   1. Substring matches — earlier is better, and a match starting at the
 *      beginning or after a separator (whitespace, `/ . : - _`) gets a
 *      word-boundary bonus ("git" in "GitHub" beats "git" in "digit").
 *   2. Subsequence matches — every query character appears in order;
 *      consecutive runs score higher than scattered hits.
 *
 * @param {string} query
 * @param {string} text
 * @returns {number} score >= 0 on match, -1 when `query` doesn't match.
 *   The empty query matches everything with score 0.
 */
export const fuzzyScore = (query, text) => {
  if (!query) return 0;
  if (!text) return -1;
  const q = String(query).toLowerCase();
  const t = String(text).toLowerCase();

  const substringIndex = t.indexOf(q);
  if (substringIndex !== -1) {
    let score = Math.max(1000 - substringIndex, 500);
    if (substringIndex === 0 || /[\s/.:\-_]/.test(t[substringIndex - 1])) {
      score += 100;
    }
    return score;
  }

  // Subsequence walk: greedy left-to-right, +10 for extending a consecutive
  // run, +1 for a scattered hit.
  let searchFrom = 0;
  let lastMatch = -2;
  let score = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, searchFrom);
    if (found === -1) return -1;
    score += found === lastMatch + 1 ? 10 : 1;
    lastMatch = found;
    searchFrom = found + 1;
  }
  return score;
};

/**
 * Filter and rank tab entries against a query. Each entry is matched on
 * both `title` and `url`; the better of the two scores wins. Ties keep the
 * input order (stable), and an empty/whitespace query returns all entries
 * unranked — so the popover's default view preserves strip order.
 *
 * @param {Array<{title?: string, url?: string}>} entries
 * @param {string} query
 * @returns {Array} matching entries, best first
 */
export const filterTabEntries = (entries, query) => {
  const items = Array.isArray(entries) ? entries : [];
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (!trimmed) return items.slice();

  return items
    .map((entry, index) => ({
      entry,
      index,
      score: Math.max(
        fuzzyScore(trimmed, entry?.title || ''),
        fuzzyScore(trimmed, entry?.url || '')
      ),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.entry);
};
