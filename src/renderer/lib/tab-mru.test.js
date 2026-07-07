import { touchMru, removeFromMru, cycleIndex } from './tab-mru.js';

describe('touchMru', () => {
  test('adds an unseen id at the front', () => {
    expect(touchMru([], 1)).toEqual([1]);
    expect(touchMru([2, 3], 1)).toEqual([1, 2, 3]);
  });

  test('moves an existing id to the front, keeping relative order of the rest', () => {
    expect(touchMru([1, 2, 3], 3)).toEqual([3, 1, 2]);
    expect(touchMru([1, 2, 3], 2)).toEqual([2, 1, 3]);
  });

  test('re-touching the front id is a no-op ordering', () => {
    expect(touchMru([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });

  test('does not mutate the input', () => {
    const order = [1, 2, 3];
    touchMru(order, 3);
    expect(order).toEqual([1, 2, 3]);
  });

  test('tolerates a missing order', () => {
    expect(touchMru(undefined, 7)).toEqual([7]);
  });
});

describe('removeFromMru', () => {
  test('removes the id wherever it sits', () => {
    expect(removeFromMru([1, 2, 3], 2)).toEqual([1, 3]);
    expect(removeFromMru([1, 2, 3], 1)).toEqual([2, 3]);
  });

  test('is a no-op for unknown ids', () => {
    expect(removeFromMru([1, 2], 9)).toEqual([1, 2]);
    expect(removeFromMru([], 9)).toEqual([]);
  });

  test('does not mutate the input', () => {
    const order = [1, 2];
    removeFromMru(order, 1);
    expect(order).toEqual([1, 2]);
  });
});

describe('cycleIndex', () => {
  test('advances and wraps forward', () => {
    expect(cycleIndex(3, 0, 1)).toBe(1);
    expect(cycleIndex(3, 2, 1)).toBe(0);
  });

  test('retreats and wraps backward', () => {
    expect(cycleIndex(3, 0, -1)).toBe(2);
    expect(cycleIndex(3, 1, -1)).toBe(0);
  });

  test('degenerate lengths clamp to 0', () => {
    expect(cycleIndex(0, 0, 1)).toBe(0);
    expect(cycleIndex(-1, 5, 1)).toBe(0);
    expect(cycleIndex(1, 0, 1)).toBe(0);
    expect(cycleIndex(1, 0, -1)).toBe(0);
  });
});
