import { describe, it, expect } from 'vitest';
import { diffRouteSources } from '../scripts/diff-route-sources.mjs';

/**
 * Task 2 of the mcp-dockhand spec-source consolidation (#222).
 *
 * This is the parallel-run equivalence proof between the OLD route extractor's
 * committed output (`docs/dockhand-api-schema.json`) and the NEW openapi-derived
 * routes (`deriveRoutesFromOpenapi()`, Task 1). It is the evidence a later task needs
 * before the old extractor (`scripts/extract-dockhand-api.mjs` and its
 * clone-and-regex-scan of the upstream SvelteKit route tree) can be deleted: every
 * delta between the two sources is either eliminated or explicitly allowlisted with a
 * one-line reason below.
 *
 * Each allowlist entry was verified against the real, committed
 * `docs/dockhand-openapi.json` (not guessed) -- see the reason string on each entry
 * for how, and `docs/superpowers/sdd/2026-08-20-mcp-dockhand-spec-consolidation/task-2-report.md`
 * for the full investigation.
 *
 * Key format (matches `diffRouteSources()`'s own `key` fields, prefixed by which
 * diff bucket they came from):
 *   - `onlyInSchema:<path>`                          -- route the old schema has, openapi source doesn't
 *   - `onlyInOpenapi:<path>`                          -- route the openapi source has, old schema doesn't
 *   - `mismatched:<path>:methods`                     -- method set differs
 *   - `mismatched:<path>:pathParams`                  -- path param name set differs
 *   - `mismatched:<path>:<METHOD>:queryParamNames`    -- query param name set differs for that method
 *   - `mismatched:<path>:<METHOD>:<name>:required`    -- a shared query param's `required` flag differs
 */

// One-line reason per allowlisted delta. Every key here must match a delta that is
// CURRENTLY present (see the "no stale entries" test below) -- an entry that stops
// matching a real delta is itself a signal that something changed and needs a fresh
// look, not a permission to leave dangling.
const ALLOWLIST: Record<string, string> = {
  // --- genuine spec gaps: routes the extractor saw that the openapi spec never documented ---
  'onlyInSchema:/api/settings/semver':
    'Route exists in the upstream Dockhand SvelteKit tree but has no @openapi JSDoc block yet -- genuine gap in docs/dockhand-openapi.json, to be filed upstream.',
  'onlyInSchema:/api/stacks/{name}/validate':
    'Route exists in the upstream Dockhand SvelteKit tree but has no @openapi JSDoc block yet -- genuine gap in docs/dockhand-openapi.json, to be filed upstream.',

  // --- wider scope: openapi spec documents routes outside the old extractor's src/routes/api scan ---
  'onlyInOpenapi:/audit':
    'Not under /api -- the old extractor only scanned src/routes/api, so it structurally could never see this route. The openapi spec documents it; wider (more correct) coverage, not a bug.',
  'onlyInOpenapi:/audit/users':
    'Not under /api -- same as /audit above, outside the old extractor scan scope by construction.',
  'onlyInOpenapi:/metrics':
    'Not under /api -- same as /audit above, outside the old extractor scan scope by construction.',

  // --- openapi spec surfaces query params the old regex heuristic missed ---
  'mismatched:/api/backup/snapshots/{id}/dump:GET:queryParamNames':
    'Verified against docs/dockhand-openapi.json: GET has destinationId/path/type/download as real query params. The old regex-based extractor missed them (route reads them via a helper, not an inline url.searchParams.get() the old heuristic could see); the openapi spec is the more complete/correct source here.',

  // --- required-flag differences: the @openapi JSDoc annotates `required` more precisely
  //     than the old extractor's regex heuristic could. Each verified directly against the
  //     operation's `parameters[]` in docs/dockhand-openapi.json. ---
  'mismatched:/api/backup/snapshots/{id}/browse:GET:destinationId:required':
    'Spec marks destinationId required:false (it has a documented default-destination fallback); old heuristic guessed required:true. Spec is authoritative.',
  'mismatched:/api/backup/snapshots/{id}/metadata:GET:destinationId:required':
    'Same destinationId-has-a-default-fallback case as .../browse above; spec is authoritative.',
  'mismatched:/api/backup/snapshots/diff:GET:destinationId:required':
    'Same destinationId-has-a-default-fallback case as .../browse above; spec is authoritative.',
  'mismatched:/api/backup/snapshots/diff:GET:snapshotA:required':
    'Spec marks snapshotA required:false; old heuristic guessed required:true. Spec is authoritative.',
  'mismatched:/api/backup/snapshots/diff:GET:snapshotB:required':
    'Spec marks snapshotB required:false; old heuristic guessed required:true. Spec is authoritative.',
  'mismatched:/api/containers/{id}/version-notes:GET:versions:required':
    'Spec marks versions required:true; old heuristic missed the requiredness. Spec is authoritative.',
  'mismatched:/api/images/scan/export:GET:imageId:required':
    'Spec marks imageId required:true; old heuristic missed the requiredness. Spec is authoritative.',
  'mismatched:/api/logs/merged:GET:containers:required':
    'Spec marks containers required:true; old heuristic missed the requiredness. Spec is authoritative.',
  'mismatched:/api/settings/scanner:DELETE:removeImages:required':
    'Spec marks removeImages required:false; old heuristic guessed required:true. Spec is authoritative.',
  'mismatched:/api/users/{id}:DELETE:confirmDisableAuth:required':
    'Spec marks confirmDisableAuth required:false; old heuristic guessed required:true. Spec is authoritative.',
};

describe('diffRouteSources', () => {
  const diff = diffRouteSources();

  function allDeltaKeys() {
    return [
      ...diff.onlyInSchema.map((path) => `onlyInSchema:${path}`),
      ...diff.onlyInOpenapi.map((path) => `onlyInOpenapi:${path}`),
      ...(diff.mismatched as Array<{ key: string }>).map((m) => `mismatched:${m.key}`),
    ];
  }

  it('has no unexpected deltas between the old extractor and the openapi-derived source', () => {
    const unexpected = allDeltaKeys().filter((key) => !(key in ALLOWLIST));

    if (unexpected.length > 0) {
      console.error('Unexpected route-source deltas (not in ALLOWLIST):\n' + JSON.stringify(unexpected, null, 2));
    }

    expect(unexpected).toEqual([]);
  });

  it('has no stale allowlist entries (every entry matches a real, current delta)', () => {
    const present = new Set(allDeltaKeys());
    const stale = Object.keys(ALLOWLIST).filter((key) => !present.has(key));

    if (stale.length > 0) {
      console.error('Stale ALLOWLIST entries (no matching delta anymore):\n' + JSON.stringify(stale, null, 2));
    }

    expect(stale).toEqual([]);
  });
});
