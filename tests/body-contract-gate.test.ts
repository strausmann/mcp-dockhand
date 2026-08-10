import { describe, it, expect } from 'vitest';
import { hasCriticalErrors, partitionBodyFindings, generateReport } from '../scripts/validate-mcp-tools.mjs';

/**
 * Task P2.2 -- promotes BODY_PARAM_MISSING_REQUIRED from advisory to a hard gate.
 *
 * Ground truth for "why now": after PR #171 (real bug fixes) and #170 (FP-cleanup for the
 * two known false-positive classes -- z.record(...) whole-body passthrough via
 * UNTYPED_PASSTHROUGH, and FP_COMPUTED_BODY via WHITELISTED_BODY_PASSTHROUGH in
 * body-checks.mjs), the committed docs/dockhand-openapi.json + current tool bodies produce
 * ZERO BODY_PARAM_MISSING_REQUIRED findings (see docs/body-contract-report.md, which lists
 * only BODY_PARAM_UNKNOWN/UNTYPED_PASSTHROUGH/BODY_CONTRACT_UNRESOLVED). The other three
 * body-finding types stay advisory (Plan Task P2.2 Step 1).
 *
 * These are unit tests against a synthetic computeValidation()-shaped result -- no real
 * file I/O, no tsx-collector subprocess. The live proof that the REAL current repo state
 * produces 0 BODY_PARAM_MISSING_REQUIRED findings (and therefore exit code 0) is verified
 * separately by actually running `node scripts/validate-mcp-tools.mjs` (see PR description /
 * task report), not re-implemented as a heavy end-to-end vitest case here.
 */

function emptyResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    orphanedTool: [],
    paramMismatch: [],
    missingEncode: [],
    queryParamUnknown: [],
    queryParamMissingRequired: [],
    bodyFindings: [],
    ...overrides,
  };
}

describe('hasCriticalErrors — BODY_PARAM_MISSING_REQUIRED is now a hard gate (Task P2.2)', () => {
  it('fails (true) when a single BODY_PARAM_MISSING_REQUIRED finding is present and nothing else', () => {
    const result = emptyResult({
      bodyFindings: [
        {
          type: 'BODY_PARAM_MISSING_REQUIRED',
          field: 'name',
          toolName: 'rename_container',
          httpMethod: 'POST',
          path: '/api/containers/{containerId}/rename',
          file: 'containers.ts',
          line: 205,
        },
      ],
    });

    expect(hasCriticalErrors(result)).toBe(true);
  });

  it('passes (false) when bodyFindings is empty and every other bucket is empty', () => {
    expect(hasCriticalErrors(emptyResult())).toBe(false);
  });

  it('passes (false) when bodyFindings contains only advisory-class findings (UNKNOWN/PASSTHROUGH/UNRESOLVED)', () => {
    const result = emptyResult({
      bodyFindings: [
        { type: 'BODY_PARAM_UNKNOWN', field: 'bogus', toolName: 'create_stack', httpMethod: 'POST', path: '/api/stacks', file: 'stacks.ts', line: 10 },
        { type: 'UNTYPED_PASSTHROUGH', toolName: 'update_container', httpMethod: 'POST', path: '/api/containers/{id}/update', file: 'containers.ts', line: 209 },
        { type: 'BODY_CONTRACT_UNRESOLVED', toolName: 'create_git_stack', httpMethod: 'POST', path: '/api/git/stacks', file: 'git.ts', line: 42 },
      ],
    });

    expect(hasCriticalErrors(result)).toBe(false);
  });

  it('still fails when the existing critical buckets (e.g. ORPHANED_TOOL) fire, independent of body findings', () => {
    const result = emptyResult({
      orphanedTool: [{ toolName: 'ghost_tool' }],
    });

    expect(hasCriticalErrors(result)).toBe(true);
  });

  it('fails when BOTH an existing critical bucket AND a BODY_PARAM_MISSING_REQUIRED finding are present', () => {
    const result = emptyResult({
      queryParamUnknown: [{ toolName: 'x', queryParam: 'bogus' }],
      bodyFindings: [{ type: 'BODY_PARAM_MISSING_REQUIRED', field: 'name', toolName: 'rename_container', httpMethod: 'POST', path: '/api/containers/{id}/rename', file: 'containers.ts', line: 205 }],
    });

    expect(hasCriticalErrors(result)).toBe(true);
  });
});

describe('partitionBodyFindings — single source of truth for critical vs advisory body findings', () => {
  it('splits BODY_PARAM_MISSING_REQUIRED into critical, the rest into advisory', () => {
    const bodyFindings = [
      { type: 'BODY_PARAM_MISSING_REQUIRED', field: 'name', toolName: 'rename_container', httpMethod: 'POST', path: '/api/containers/{id}/rename', file: 'containers.ts', line: 205 },
      { type: 'BODY_PARAM_UNKNOWN', field: 'bogus', toolName: 'create_stack', httpMethod: 'POST', path: '/api/stacks', file: 'stacks.ts', line: 10 },
      { type: 'UNTYPED_PASSTHROUGH', toolName: 'update_container', httpMethod: 'POST', path: '/api/containers/{id}/update', file: 'containers.ts', line: 209 },
      { type: 'BODY_CONTRACT_UNRESOLVED', toolName: 'create_git_stack', httpMethod: 'POST', path: '/api/git/stacks', file: 'git.ts', line: 42 },
    ];

    const { critical, advisory } = partitionBodyFindings(bodyFindings);

    expect(critical).toEqual([bodyFindings[0]]);
    expect(advisory).toEqual([bodyFindings[1], bodyFindings[2], bodyFindings[3]]);
  });

  it('returns two empty arrays for no findings', () => {
    expect(partitionBodyFindings([])).toEqual({ critical: [], advisory: [] });
  });
});

describe('generateReport — BODY_PARAM_MISSING_REQUIRED gets its own Kritisch section (Task P2.2)', () => {
  const baseArgs = {
    schema: { sourceCommit: 'deadbeefcafe', endpointCount: 42 },
    covered: [],
    missingTool: [],
    orphanedTool: [],
    paramMismatch: [],
    missingEncode: [],
    queryParamMissingRequired: [],
    queryParamUnknown: [],
  };

  it('renders a dedicated "BODY_PARAM_MISSING_REQUIRED (Kritisch)" table when present', () => {
    const report = generateReport({
      ...baseArgs,
      bodyFindings: [
        { type: 'BODY_PARAM_MISSING_REQUIRED', field: 'name', toolName: 'rename_container', httpMethod: 'POST', path: '/api/containers/{containerId}/rename', file: 'containers.ts', line: 205 },
      ],
    });

    expect(report).toContain('## BODY_PARAM_MISSING_REQUIRED (Kritisch)');
    expect(report).toMatch(/\|\s*`rename_container`\s*\|\s*POST\s*\|\s*`\/api\/containers\/\{containerId\}\/rename`\s*\|\s*`name`\s*\|\s*containers\.ts:205\s*\|/);
  });

  it('does NOT render the critical section when there are no BODY_PARAM_MISSING_REQUIRED findings', () => {
    const report = generateReport({
      ...baseArgs,
      bodyFindings: [
        { type: 'UNTYPED_PASSTHROUGH', toolName: 'update_container', httpMethod: 'POST', path: '/api/containers/{id}/update', file: 'containers.ts', line: 209 },
      ],
    });

    expect(report).not.toContain('## BODY_PARAM_MISSING_REQUIRED (Kritisch)');
  });

  it('keeps the remaining advisory body-finding types out of the critical section, still listed separately', () => {
    const report = generateReport({
      ...baseArgs,
      bodyFindings: [
        { type: 'BODY_PARAM_MISSING_REQUIRED', field: 'name', toolName: 'rename_container', httpMethod: 'POST', path: '/api/containers/{id}/rename', file: 'containers.ts', line: 205 },
        { type: 'BODY_PARAM_UNKNOWN', field: 'bogus', toolName: 'create_stack', httpMethod: 'POST', path: '/api/stacks', file: 'stacks.ts', line: 10 },
      ],
    });

    // Critical finding shows up in its own section...
    expect(report).toContain('## BODY_PARAM_MISSING_REQUIRED (Kritisch)');
    // ...the advisory one is still visible somewhere in the report...
    expect(report).toContain('`create_stack`');
    // ...but NOT inside the critical section's table (only in the advisory one).
    const criticalSection = report.split('## BODY_PARAM_MISSING_REQUIRED (Kritisch)')[1].split('##')[0];
    expect(criticalSection).not.toContain('create_stack');
  });
});
