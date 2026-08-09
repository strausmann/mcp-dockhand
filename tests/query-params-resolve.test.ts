import { describe, it, expect } from 'vitest';
import { resolveQueryParamKeys } from '../scripts/lib/query-params.mjs';

describe('resolveQueryParamKeys', () => {
  it('resolves a plain object literal', () => {
    expect(resolveQueryParamKeys('{ env: environmentId, tail }')).toEqual(['env', 'tail']);
  });

  it('resolves undefined/null literals as sending nothing', () => {
    expect(resolveQueryParamKeys('undefined')).toEqual([]);
    expect(resolveQueryParamKeys('null')).toEqual([]);
  });

  it('returns null for a bare identifier (not statically resolvable)', () => {
    expect(resolveQueryParamKeys('opts')).toBeNull();
  });

  it('returns null for a function call', () => {
    expect(resolveQueryParamKeys('buildParams(x)')).toBeNull();
  });

  // The real bug class this fixes: get_registry_catalog in src/tools/registries.ts sends
  // `client.get('/api/registry/catalog', environmentId ? { env: environmentId } : undefined)`.
  // Before this fix, extractCallQueryParamKeys only handled a bare `{...}` argument and
  // returned null for this ternary — silently skipping the query-param check for the
  // entire call, which is exactly how the call never sending the *required* `registry`
  // param went unnoticed.
  it('resolves a ternary with an object-literal true-branch and undefined false-branch (get_registry_catalog shape)', () => {
    expect(resolveQueryParamKeys('environmentId ? { env: environmentId } : undefined')).toEqual(['env']);
  });

  it('resolves a ternary the other way round (object-literal false-branch)', () => {
    expect(resolveQueryParamKeys('force ? undefined : { env: environmentId }')).toEqual(['env']);
  });

  it('unions keys across both branches when both are object literals', () => {
    expect(resolveQueryParamKeys("mode === 'a' ? { a: 1 } : { b: 2 }")).toEqual(['a', 'b']);
  });

  it('deduplicates keys sent by both branches', () => {
    expect(resolveQueryParamKeys('x ? { env: a } : { env: b }')).toEqual(['env']);
  });

  it('resolves a nested ternary across all reachable branches', () => {
    expect(resolveQueryParamKeys("x ? { a: 1 } : y ? { b: 2 } : undefined")).toEqual(['a', 'b']);
  });

  it('bails to null (does NOT silently under-report) when either ternary branch is unresolvable', () => {
    // `params` here is a bare identifier — even though the other branch is a concrete
    // object literal, the overall set of keys this call can send is NOT fully known, so
    // this must stay null (skip the check), not resolve to just the known branch.
    expect(resolveQueryParamKeys('x ? params : { env: a }')).toBeNull();
    expect(resolveQueryParamKeys('x ? { env: a } : params')).toBeNull();
  });

  it('treats a spread-only object literal branch as sending no statically known keys, not as unresolvable', () => {
    // Matches extractObjectKey()'s existing behavior for plain object literals: an
    // unresolvable key (spread/computed) is silently dropped, not a bail-out signal.
    expect(resolveQueryParamKeys('x ? { ...rest } : undefined')).toEqual([]);
  });
});
