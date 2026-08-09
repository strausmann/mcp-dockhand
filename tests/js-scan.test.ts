import { describe, it, expect } from 'vitest';
import { splitTernary } from '../scripts/lib/js-scan.mjs';

describe('splitTernary', () => {
  it('splits a simple ternary into condition/whenTrue/whenFalse', () => {
    expect(splitTernary('environmentId ? { env: environmentId } : undefined')).toEqual({
      condition: 'environmentId',
      whenTrue: '{ env: environmentId }',
      whenFalse: 'undefined',
    });
  });

  it('returns null when there is no top-level ternary', () => {
    expect(splitTernary('{ env: environmentId }')).toBeNull();
    expect(splitTernary('undefined')).toBeNull();
    expect(splitTernary('someVariable')).toBeNull();
  });

  it('does not confuse optional chaining (?.) with a ternary', () => {
    expect(splitTernary('foo?.bar')).toBeNull();
  });

  it('does not confuse nullish coalescing (??) with a ternary', () => {
    expect(splitTernary('foo ?? {}')).toBeNull();
  });

  it('ignores ? and : nested inside parens/braces/brackets when finding the top-level split', () => {
    // The object literal's own `:` (key: value) must not be mistaken for the ternary's.
    expect(splitTernary('x ? { a: 1, b: fn(2, 3) } : { c: [1, 2] }')).toEqual({
      condition: 'x',
      whenTrue: '{ a: 1, b: fn(2, 3) }',
      whenFalse: '{ c: [1, 2] }',
    });
  });

  it('resolves nested ternaries in the whenTrue branch (ternaryDepth tracking)', () => {
    const result = splitTernary('a ? (b ? 1 : 2) : 3');
    expect(result).toEqual({ condition: 'a', whenTrue: '(b ? 1 : 2)', whenFalse: '3' });
  });

  it('resolves a bare (unparenthesized) nested ternary in whenTrue', () => {
    // `a ? b ? 1 : 2 : 3` parses (right-associatively) as `a ? (b ? 1 : 2) : 3`.
    const result = splitTernary('a ? b ? 1 : 2 : 3');
    expect(result).toEqual({ condition: 'a', whenTrue: 'b ? 1 : 2', whenFalse: '3' });
  });

  it('ignores ternary-like characters inside strings and template literals', () => {
    expect(splitTernary(`x ? 'a : b' : "c ? d"`)).toEqual({
      condition: 'x',
      whenTrue: "'a : b'",
      whenFalse: '"c ? d"',
    });
  });

  it('returns null for an unbalanced/incomplete ternary (no matching colon)', () => {
    expect(splitTernary('x ? { a: 1 }')).toBeNull();
  });
});
