import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadToolBodyShapes, BodyShapeCollectorError } from '../scripts/validate-mcp-tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Refs #173 -- follow-up to #172's hard BODY_PARAM_MISSING_REQUIRED gate.
 *
 * Ground truth for "why this test exists": the OLD loadToolBodyShapes() caught EVERY
 * failure of the `tsx` collector subprocess (crash, missing binary, bad JSON) and
 * returned `null`. computeValidation() treats `null` as "body-checks intentionally
 * skipped" -- the exact same signal a caller sends by never calling loadToolBodyShapes()
 * at all (see generate-coverage-doc.mjs's 2-arg computeValidation() call). That made a
 * genuine collector CRASH indistinguishable from "checks were never requested", so the
 * hard gate (#172) went silently fail-open on a broken collector: CI stayed green even
 * though the body-contract check never ran.
 *
 * These are unit tests against loadToolBodyShapes() itself (now parametrized by
 * `scriptPath` purely so a crash can be simulated without touching the real
 * collect-tool-shapes.mjs) -- no vitest mocking of child_process, matching the existing
 * convention in this file's siblings (body-contract-gate.test.ts) of testing the real
 * exported function directly. The companion "successful run, 0 findings, exit 0" case is
 * already covered by hasCriticalErrors(emptyResult()) in body-contract-gate.test.ts, and
 * is additionally proven live by actually running `node scripts/validate-mcp-tools.mjs`
 * against the real repo (see PR description / task report) -- not re-implemented as a
 * slow end-to-end vitest case here.
 */

describe('loadToolBodyShapes — fail-CLOSED on collector crash (#173)', () => {
  it('throws a BodyShapeCollectorError (not a silent null) when the tsx subprocess itself fails', () => {
    // A script path that does not exist makes the `npx tsx <path>` subprocess fail fast
    // with a non-zero exit — the same failure class ("tsx-Collector-Subprozess scheitert")
    // #173 is about (build/import errors inside collect-tool-shapes.mjs surface the same
    // way: execFileSync throws because the child process exited non-zero).
    const missingScript = join(__dirname, 'fixtures', 'does-not-exist-collector.mjs');

    expect(() => loadToolBodyShapes(missingScript)).toThrow(BodyShapeCollectorError);
  });

  it('the thrown error carries the "body-contract collector failed" marker validate() greps for', () => {
    const missingScript = join(__dirname, 'fixtures', 'does-not-exist-collector.mjs');

    try {
      loadToolBodyShapes(missingScript);
      expect.unreachable('loadToolBodyShapes() should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BodyShapeCollectorError);
      expect((err as Error).message).toContain('body-contract collector failed');
    }
  });

  it('throws a BodyShapeCollectorError when the collector prints invalid JSON to stdout', () => {
    // Fixture script runs to completion (exit 0) but its stdout is not JSON at all —
    // exercises the second failure path (JSON.parse throws) independently from the
    // "subprocess itself failed" path above (missing-script test case).
    const nonJsonScript = join(__dirname, 'fixtures', 'invalid-json-collector.mjs');

    expect(() => loadToolBodyShapes(nonJsonScript)).toThrow(BodyShapeCollectorError);
  });

  it('a successful collector run (real collect-tool-shapes.mjs) returns an object, does not throw', () => {
    // Proves the refactor (adding the scriptPath param, replacing swallow-and-null with
    // throw-on-failure) did not break the happy path: the REAL collector against the REAL
    // repo state must still resolve normally.
    const shapes = loadToolBodyShapes();

    expect(shapes).toBeTypeOf('object');
    expect(shapes).not.toBeNull();
    expect(Object.keys(shapes as Record<string, unknown>).length).toBeGreaterThan(0);
  });
});
