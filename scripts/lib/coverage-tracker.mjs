/**
 * Pure builder for the single, self-healing `coverage-tracker` issue body (#227
 * Part 2 — "Make future MISSING_TOOL coverage gaps self-tracking").
 *
 * Context: a PREVIOUS sticky-issue mechanism existed (issue #60, labeled
 * `coverage-tracker`) but was removed in #165 ("drop dead coverage-tracker") because
 * its update step could only ever UPDATE an already-OPEN issue with that label — once
 * a human closed #60, the step silently no-op'd (`core.warning()` only, never failed
 * the workflow) and coverage drift went unnoticed for roughly three months. #165
 * replaced it with the committed, always-current `docs/coverage.md` report, which
 * remains the single source of truth for the numbers below.
 *
 * #227 asks to bring the ACTIONABLE side back, but fixed: the workflow step (see
 * scripts/coverage-tracker-summary.mjs + api-schema-sync.yml) now CREATES the issue
 * if none is open, and REOPENS a previously-closed one if new gaps appear — the exact
 * failure mode above becomes structurally impossible instead of merely documented.
 *
 * This module only builds the markdown body from numbers `computeValidation()`
 * already produced elsewhere (validate-mcp-tools.mjs / generate-coverage-doc.mjs) —
 * it does no I/O and re-derives nothing, so the tracker issue and docs/coverage.md
 * can never disagree on the count.
 */

import { groupMissingByArea } from './coverage-report.mjs';

/** GitHub label used to find/create the single tracker issue (matches #60's label). */
const TRACKER_LABEL = 'coverage-tracker';

/**
 * @param {object} input
 * @param {number} input.missingCount MISSING_TOOL count (`missingTool.length`)
 * @param {Array<{path: string, method: string, pathParams?: string[]}>} input.missingTool
 * @param {string} input.sourceCommit Dockhand upstream commit the schema was extracted from
 * @param {string} [input.workflowRunUrl] Link to the run that produced this body (omitted if not given — e.g. local/manual invocation)
 * @returns {string} Full issue body markdown (title is set by the caller, not part of this).
 */
function buildTrackerBody({ missingCount, missingTool, sourceCommit, workflowRunUrl }) {
  const lines = [];

  lines.push(
    'This issue tracks Dockhand REST API endpoints that do not yet have a corresponding ' +
      'MCP tool, as detected by `scripts/validate-mcp-tools.mjs`.'
  );
  lines.push('');
  lines.push(
    '**Auto-maintained** by the ' +
      '[`api-schema-sync`](../actions/workflows/api-schema-sync.yml) workflow ' +
      '(daily 05:00 UTC + manual dispatch). Do not edit this body by hand — it is fully ' +
      'replaced on every run that changes the count. See `docs/coverage.md` for the full, ' +
      'always-current report (COVERED / ORPHANED_TOOL / deliberately-omitted endpoints, ' +
      'per-endpoint tables).'
  );
  lines.push('');
  lines.push(`**Dockhand upstream commit:** \`${sourceCommit}\``);
  lines.push(`**MISSING_TOOL:** ${missingCount}`);
  if (workflowRunUrl) {
    lines.push(`**Last sync:** [run log](${workflowRunUrl})`);
  }
  lines.push('');

  if (missingCount === 0) {
    lines.push(
      'No open gaps — every in-scope endpoint currently has an MCP tool. This issue is ' +
        'closed automatically and will be **reopened** if a future Dockhand release ' +
        'introduces an endpoint without a tool, rather than silently going stale (see #165 ' +
        'for why the previous mechanism died, and why this one reopens instead of only ' +
        'updating-while-open).'
    );
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## MISSING_TOOL — by area');
  lines.push('');
  lines.push(
    'Endpoints that exist per the schema but have no MCP tool yet, grouped by the first ' +
      'path segment after `/api/`:'
  );
  lines.push('');

  const grouped = groupMissingByArea(missingTool);
  for (const { area, entries } of grouped) {
    lines.push(`### ${area} (${entries.length})`);
    lines.push('');
    lines.push('| HTTP | Path |');
    lines.push('|------|------|');
    for (const e of entries) {
      lines.push(`| ${e.method} | \`${e.path}\` |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export { TRACKER_LABEL, buildTrackerBody };
