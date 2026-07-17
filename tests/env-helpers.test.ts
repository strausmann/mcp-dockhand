import { describe, it, expect } from 'vitest';
import { diffEnvVars, parseDotEnvKeys, removeKeysFromDotEnv } from '../src/utils/env-helpers.js';

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

describe('parseDotEnvKeys', () => {
  it('returns keys, skipping comments and blank lines', () => {
    const content = '# comment\nA=1\n\nB=two=with=eq\n  C = 3 \n';
    expect(parseDotEnvKeys(content)).toEqual(['A', 'B', 'C']);
  });

  it('strips a leading "export " prefix before extracting the key', () => {
    expect(parseDotEnvKeys('export A=1\nB=2')).toEqual(['A', 'B']);
  });
});

describe('removeKeysFromDotEnv', () => {
  it('drops matching KEY= lines, preserves comments/blanks/order', () => {
    const content = '# keep\nA=1\nB=2\n\nC=3';
    expect(removeKeysFromDotEnv(content, ['B'])).toBe('# keep\nA=1\n\nC=3');
  });
  it('is a no-op for keys not present', () => {
    const content = 'A=1\nB=2';
    expect(removeKeysFromDotEnv(content, ['Z'])).toBe('A=1\nB=2');
  });
  it('drops an "export KEY=" line when KEY is targeted', () => {
    expect(removeKeysFromDotEnv('export A=1\nB=2', ['A'])).toBe('B=2');
  });
});

describe('diffEnvVars — defensive against malformed API entries', () => {
  it('ignores null/undefined/non-string-key entries in existing without crashing', () => {
    const existing = [null, undefined, { key: 123 }, { key: 'A', value: 'a', isSecret: false }] as unknown as Parameters<typeof diffEnvVars>[0];
    const d = diffEnvVars(existing, [{ key: 'A', value: 'a2' }], 'merge');
    expect(d.added).toEqual([]);
    expect(d.updated).toEqual(['A']);
    expect(d.preserved).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});
