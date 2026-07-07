// Most-recently-used tab order — pure list operations backing the MRU
// Ctrl+Tab switcher in tabs.js. The order is a plain array of tab ids,
// most recent first; tabs.js owns the array and feeds every mutation
// through these helpers so the ordering rules stay unit-testable.

/**
 * Move `id` to the front of the MRU order (adding it if absent).
 * Returns a new array; the input is not mutated.
 */
export const touchMru = (order, id) => [id, ...(order || []).filter((x) => x !== id)];

/**
 * Drop `id` from the MRU order (no-op if absent). Returns a new array.
 */
export const removeFromMru = (order, id) => (order || []).filter((x) => x !== id);

/**
 * Step a selection index through a cyclic list. `direction` is +1 (next,
 * Ctrl+Tab) or -1 (previous, Ctrl+Shift+Tab); wraps at both ends.
 */
export const cycleIndex = (length, current, direction) => {
  if (!Number.isInteger(length) || length <= 0) return 0;
  return (((current + direction) % length) + length) % length;
};
