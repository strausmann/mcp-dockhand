/**
 * Regression guard promised (but not yet delivered) by the header comment in
 * scripts/lib/crossref-checks.mjs: that module deliberately RE-IMPLEMENTS the same two
 * cross-reference regexes as src/openapi/derive-description.ts, rather than importing
 * them, because it lives in scripts/ (plain JS, run directly via `node`, no build/tsx
 * step) while derive-description.ts lives in src/ (TypeScript). Should the two
 * definitions ever diverge — someone edits one copy without the other — this test is
 * the thing that is supposed to notice (P3 Final Fix Wave, Finding 3, Refs #57).
 *
 * Two independent checks, because either one alone would miss a real divergence:
 *   1. The regex SOURCE STRINGS must be byte-identical. This alone would already catch
 *      almost any edit, but a source-string diff can be hard to read at a glance.
 *   2. The two sides' EXTRACTION BEHAVIOR must agree on a shared table of example
 *      operations (including edge cases: multiple refs, ignored header params, no refs
 *      at all) — a behavioral check that stays meaningful even if a future refactor
 *      changes how either side is built internally, as long as the two extractors still
 *      agree on results.
 */
import { describe, it, expect } from 'vitest';
import {
  HTTP_METHODS as TS_HTTP_METHODS,
  PROSE_CROSS_REF_SOURCE as TS_PROSE_CROSS_REF_SOURCE,
  PAREN_CROSS_REF_SOURCE as TS_PAREN_CROSS_REF_SOURCE,
  extractParamCrossRefs,
  extractBodyCrossRefs,
  type OpenApiOperation,
} from '../src/openapi/derive-description.js';
import {
  HTTP_METHODS as JS_HTTP_METHODS,
  PROSE_CROSS_REF_SOURCE as JS_PROSE_CROSS_REF_SOURCE,
  PAREN_CROSS_REF_SOURCE as JS_PAREN_CROSS_REF_SOURCE,
  extractCrossRefsFromOperation,
} from '../scripts/lib/crossref-checks.mjs';

/** TS-side combined extraction, matching the JS side's own documented order: param refs (declaration order), then prose refs (regex match order). */
function extractAllRefsTs(op: OpenApiOperation): Array<{ method: string; path: string }> {
  const paramRefs = extractParamCrossRefs(op.parameters).map((r) => ({ method: r.method, path: r.path }));
  const bodyRefs = extractBodyCrossRefs(op.description).map((r) => ({ method: r.method, path: r.path }));
  return [...paramRefs, ...bodyRefs];
}

describe('derive-description.ts vs scripts/lib/crossref-checks.mjs: cross-ref regex parity', () => {
  it('regex source strings are byte-identical between the TS and JS copies', () => {
    expect(TS_HTTP_METHODS).toBe(JS_HTTP_METHODS);
    expect(TS_PROSE_CROSS_REF_SOURCE).toBe(JS_PROSE_CROSS_REF_SOURCE);
    expect(TS_PAREN_CROSS_REF_SOURCE).toBe(JS_PAREN_CROSS_REF_SOURCE);
  });

  const cases: Array<{ name: string; op: OpenApiOperation }> = [
    {
      name: 'single param cross-ref',
      op: {
        parameters: [
          { in: 'path', name: 'environmentId', description: 'The environment (from GET /api/environments)' },
        ],
      },
    },
    {
      name: 'single prose cross-ref',
      op: { description: 'containerId from GET /api/containers.' },
    },
    {
      name: 'multiple prose cross-refs in the same description',
      op: {
        description:
          'containerId from GET /api/containers, environmentId from GET /api/environments.',
      },
    },
    {
      name: 'combined param + prose cross-refs',
      op: {
        parameters: [
          { in: 'query', name: 'environmentId', description: 'Env (from GET /api/environments)' },
        ],
        description: 'containerId from GET /api/containers.',
      },
    },
    {
      name: 'header parameter cross-ref is ignored (only path/query count)',
      op: {
        parameters: [
          { in: 'header', name: 'X-Foo', description: 'Something (from GET /api/environments)' },
        ],
      },
    },
    {
      name: 'parameter without a cross-ref annotation is ignored',
      op: { parameters: [{ in: 'path', name: 'id', description: 'Just a plain id' }] },
    },
    {
      name: 'a PUT/DELETE/PATCH method is recognized, not just GET/POST',
      op: { description: 'roleId from DELETE /api/roles/{id}.' },
    },
    {
      name: 'operation with neither parameters nor description',
      op: {},
    },
  ];

  it.each(cases)('extraction behavior agrees for: $name', ({ op }) => {
    const tsRefs = extractAllRefsTs(op);
    const jsRefs = extractCrossRefsFromOperation(op);
    expect(tsRefs).toEqual(jsRefs);
  });
});
