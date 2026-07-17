import { describe, it, expect } from 'vitest';
import { diffEnvVars } from '../src/utils/env-helpers.js';

describe('diffEnvVars', () => {
  const existing = [
    { key: 'A', value: 'a', isSecret: false },
    { key: 'B', value: 'b', isSecret: true },
    { key: 'C', value: 'c', isSecret: false },
  ];

  it('merge: added/updated/preserved (omitted keys only); masked re-send is not surfaced', () => {
    const d = diffEnvVars(existing, [
      { key: 'A', value: 'a2' },          // updated (value changed)
      { key: 'D', value: 'd' },           // added
      { key: 'B', value: '***' },         // re-sent masked -> unchanged, in NO bucket
    ], 'merge');
    expect(d.added).toEqual(['D']);
    expect(d.updated).toEqual(['A']);
    expect(d.preserved).toEqual(['C']);   // only the omitted key
    expect(d.removed).toEqual([]);
  });

  it('replace: untouched existing keys count as removed, preserved empty', () => {
    const d = diffEnvVars(existing, [{ key: 'A', value: 'a' }], 'replace');
    expect(d.removed.sort()).toEqual(['B', 'C']);
    expect(d.preserved).toEqual([]);
    expect(d.updated).toEqual([]); // same value -> not updated
  });

  it('isSecret flip counts as updated', () => {
    const d = diffEnvVars(existing, [{ key: 'A', value: 'a', isSecret: true }], 'merge');
    expect(d.updated).toEqual(['A']);
  });
});
