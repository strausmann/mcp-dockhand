#!/usr/bin/env node
/**
 * Emits what `.github/workflows/api-schema-sync.yml` needs to create / update /
 * close / reopen the single, self-healing `coverage-tracker` issue (#227 Part 2).
 *
 * Reuses the SAME `computeValidation()` numbers `scripts/generate-coverage-doc.mjs`
 * builds `docs/coverage.md` from (via the exports of `validate-mcp-tools.mjs`), so
 * the tracker issue and `docs/coverage.md` can never disagree on the count — this
 * script does not recompute or re-derive anything, only reads the same inputs a
 * second time and hands the result to `buildTrackerBody()`
 * (scripts/lib/coverage-tracker.mjs, unit-tested in tests/coverage-tracker.test.ts).
 *
 * Run this AFTER `node scripts/fetch-openapi.mjs` in the workflow (same precondition
 * `generate-coverage-doc.mjs` has: the pinned `docs/dockhand-openapi.json` on disk) —
 * see api-schema-sync.yml step ordering.
 *
 * Writes two GitHub Actions step outputs to `$GITHUB_OUTPUT` (a later `github-script`
 * step reads `steps.coverage-tracker.outputs.missing_count` /
 * `.outputs.body` to talk to the GitHub REST API — that part is intentionally NOT in
 * this script: creating/closing/reopening issues needs the workflow's `github-token`
 * auth context, which a plain node script run via `actions/setup-node` does not have):
 *
 *   missing_count  -- integer, MISSING_TOOL count
 *   body           -- the full issue body (multi-line, GITHUB_OUTPUT heredoc form)
 *
 * When $GITHUB_OUTPUT is unset (local/manual run), prints both to stdout instead —
 * lets a maintainer preview the exact body a workflow run would produce/post,
 * without needing CI (this is the "kein Live-Test möglich" case called out in the
 * task: the workflow YAML integration itself can only be exercised in CI, but this
 * script's OWN output is inspectable locally).
 *
 * Usage:
 *   node scripts/coverage-tracker-summary.mjs
 */

import { appendFileSync } from 'node:fs';
import {
  loadSchema,
  extractToolCalls,
  computeValidation,
  loadOmissionRegistry,
} from './validate-mcp-tools.mjs';
import { buildTrackerBody } from './lib/coverage-tracker.mjs';

function main() {
  const schema = loadSchema();
  const toolCalls = extractToolCalls();
  const registry = loadOmissionRegistry();
  // toolBodyShapes=null: same as generate-coverage-doc.mjs — the tracker only needs
  // the MISSING_TOOL bucket, not the body-contract findings.
  const { missingTool } = computeValidation(schema, toolCalls, null, registry);

  const workflowRunUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;

  const body = buildTrackerBody({
    missingCount: missingTool.length,
    missingTool,
    sourceCommit: schema.sourceCommit,
    workflowRunUrl,
  });

  const outPath = process.env.GITHUB_OUTPUT;
  if (outPath) {
    // Heredoc form (GitHub Actions "multiline string" convention) — a delimiter
    // that cannot plausibly appear inside the body itself, since the body is
    // markdown built entirely from schema data (paths/methods/commit hash).
    const delimiter = `COVERAGE_TRACKER_BODY_EOF_${Date.now()}`;
    appendFileSync(outPath, `missing_count=${missingTool.length}\n`);
    appendFileSync(outPath, `body<<${delimiter}\n${body}\n${delimiter}\n`);
    console.error(`[coverage-tracker-summary] missing_count=${missingTool.length} — outputs written to $GITHUB_OUTPUT`);
  } else {
    console.log(`missing_count=${missingTool.length}`);
    console.log('--- body ---');
    console.log(body);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
