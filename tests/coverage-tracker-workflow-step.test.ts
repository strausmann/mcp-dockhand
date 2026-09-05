import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCoverageTrackerStep } from '../scripts/coverage-tracker-workflow-step.mjs';

/**
 * #227 Part 2 -- the "Create/update/close/reopen coverage tracker issue" step in
 * `.github/workflows/api-schema-sync.yml` talks to the live GitHub REST API via
 * `actions/github-script`'s injected `github`/`context`/`core` -- there is no way
 * to exercise the ACTUAL workflow step outside CI (the task's "kein Live-Test
 * möglich" note). Two things are tested here instead:
 *
 * 1. A drift guard: `scripts/coverage-tracker-workflow-step.mjs` claims to be a
 *    byte-for-byte copy of the YAML `script:` block (see its header comment) --
 *    this test proves that claim instead of leaving it as an unverified comment,
 *    by extracting both texts and comparing them structurally.
 * 2. The actual control-flow logic (create vs. update vs. close vs. reopen vs.
 *    the defensive multi-open-issue bail-out), run against a MOCKED
 *    github.rest.issues.* client -- this is the part that would silently regress
 *    without a live CI run to catch it.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKFLOW_PATH = resolve(__dirname, '..', '.github', 'workflows', 'api-schema-sync.yml');
const STEP_MODULE_PATH = resolve(__dirname, '..', 'scripts', 'coverage-tracker-workflow-step.mjs');

/**
 * Extracts the `script: |` block scalar body of the named step from the workflow
 * YAML, without needing a full YAML parser (avoids depending on the transitive,
 * undeclared `js-yaml` package a future dependency bump could remove or change --
 * a drift guard breaking because of an unrelated dependency change is exactly the
 * "test fails for the wrong reason" anti-pattern this repo's own
 * test-coverage-pflicht avoids elsewhere). Plain-text, indentation-based
 * extraction is sufficient for this one well-known, stable step.
 */
function extractWorkflowScript(stepName: string): string {
  const text = readFileSync(WORKFLOW_PATH, 'utf8');
  const lines = text.split('\n');
  const stepLineIdx = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (stepLineIdx === -1) {
    throw new Error(`Step "${stepName}" not found in ${WORKFLOW_PATH}`);
  }

  const scriptLineIdx = lines.findIndex(
    (l, i) => i > stepLineIdx && l.trim() === 'script: |',
  );
  if (scriptLineIdx === -1) {
    throw new Error(`No "script: |" block found after step "${stepName}"`);
  }
  const bodyIndent = lines[scriptLineIdx].match(/^\s*/)![0].length + 2;

  const bodyLines: string[] = [];
  for (let i = scriptLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // A blank line is part of the block scalar (JS allows blank lines); anything
    // indented LESS than bodyIndent ends the block.
    if (line.trim() !== '' && line.match(/^\s*/)![0].length < bodyIndent) break;
    bodyLines.push(line.length >= bodyIndent ? line.slice(bodyIndent) : '');
  }
  // Drop trailing blank lines (YAML block scalars normally end with exactly one
  // trailing newline; our line-based capture may pick up extra blanks before the
  // next step's `- name:`).
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
  return bodyLines.join('\n');
}

/**
 * Extracts the body of `async function runCoverageTrackerStep(...) { ... }` from
 * the .mjs file, dedented by one level (2 spaces) to match the YAML block's
 * indentation (which has no wrapping function).
 */
function extractModuleFunctionBody(): string {
  const text = readFileSync(STEP_MODULE_PATH, 'utf8');
  const startMarker = 'async function runCoverageTrackerStep(github, context, core, process) {';
  // lastIndexOf, not indexOf: the header comment above ALSO mentions this exact
  // string as literal code-quoted text (documenting what to strip when copying
  // into the YAML) -- indexOf would match that comment occurrence instead of the
  // real function definition and silently compare against the wrong (empty/
  // comment) text. Caught by this very test failing for the wrong reason on the
  // first run.
  const startIdx = text.lastIndexOf(startMarker);
  if (startIdx === -1) throw new Error('runCoverageTrackerStep() not found');
  const bodyStart = startIdx + startMarker.length;
  const endMarker = '\n}\n\nexport { runCoverageTrackerStep };';
  const endIdx = text.indexOf(endMarker, bodyStart);
  if (endIdx === -1) throw new Error('End of runCoverageTrackerStep() not found');
  const rawBody = text.slice(bodyStart, endIdx);
  const lines = rawBody.split('\n');
  // Drop the leading blank line right after the opening brace.
  if (lines[0] === '') lines.shift();
  const dedented = lines.map((l) => (l.startsWith('  ') ? l.slice(2) : l));
  while (dedented.length > 0 && dedented[dedented.length - 1] === '') dedented.pop();
  return dedented.join('\n');
}

describe('coverage tracker workflow step — drift guard', () => {
  it('the YAML script: block is identical to runCoverageTrackerStep()\'s body (see the header comment claiming this)', () => {
    const workflowScript = extractWorkflowScript('Create/update/close/reopen coverage tracker issue');
    const moduleBody = extractModuleFunctionBody();

    expect(workflowScript).toBe(moduleBody);
  });
});

/**
 * Minimal mock of the octokit surface this step uses. Each mocked method records
 * its calls so tests can assert exactly what happened -- and, crucially, what did
 * NOT happen (e.g. "no issue was created" when one should have been updated
 * instead).
 */
function mockGithub(issues: Array<{ number: number; state: 'open' | 'closed'; updated_at: string }>) {
  return {
    rest: {
      issues: {
        listForRepo: vi.fn().mockResolvedValue({ data: issues }),
        update: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({ data: { number: 999 } }),
      },
    },
  };
}

function mockCore() {
  return { info: vi.fn(), warning: vi.fn() };
}

const context = { repo: { owner: 'strausmann', repo: 'mcp-dockhand' } };

describe('runCoverageTrackerStep', () => {
  it('missing_count not numeric: warns and does nothing (defensive -- a broken upstream script must not crash the workflow)', async () => {
    const github = mockGithub([]);
    const core = mockCore();

    await runCoverageTrackerStep(github, context, core, { env: { MISSING_COUNT: 'not-a-number', TRACKER_BODY: 'x' } });

    expect(github.rest.issues.listForRepo).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledTimes(1);
  });

  it('no existing tracker issue at all, missingCount > 0: CREATES exactly one issue with the coverage-tracker label', async () => {
    const github = mockGithub([]);
    const core = mockCore();

    await runCoverageTrackerStep(github, context, core, { env: { MISSING_COUNT: '5', TRACKER_BODY: 'body-x' } });

    expect(github.rest.issues.create).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['coverage-tracker'], body: 'body-x' }),
    );
    expect(github.rest.issues.update).not.toHaveBeenCalled();
  });

  it('an OPEN tracker exists, missingCount > 0: UPDATES it (no create, no close/reopen)', async () => {
    const github = mockGithub([{ number: 42, state: 'open', updated_at: '2026-09-01T00:00:00Z' }]);
    const core = mockCore();

    await runCoverageTrackerStep(github, context, core, { env: { MISSING_COUNT: '3', TRACKER_BODY: 'body-y' } });

    expect(github.rest.issues.create).not.toHaveBeenCalled();
    expect(github.rest.issues.update).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 42, body: 'body-y' }),
    );
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('an OPEN tracker exists, missingCount === 0: CLOSES it (state_reason completed) with an explanatory comment', async () => {
    const github = mockGithub([{ number: 42, state: 'open', updated_at: '2026-09-01T00:00:00Z' }]);
    const core = mockCore();

    await runCoverageTrackerStep(github, context, core, { env: { MISSING_COUNT: '0', TRACKER_BODY: 'all clear' } });

    expect(github.rest.issues.create).not.toHaveBeenCalled();
    // Body update + the close-with-state-reason update: two update() calls.
    expect(github.rest.issues.update).toHaveBeenCalledTimes(2);
    expect(github.rest.issues.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ issue_number: 42, body: 'all clear' }),
    );
    expect(github.rest.issues.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ issue_number: 42, state: 'closed', state_reason: 'completed' }),
    );
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it('no OPEN tracker, missingCount === 0: does nothing (already resolved, nothing to close) -- this is the exact case the #60 mechanism could not distinguish from "should reopen"', async () => {
    const github = mockGithub([{ number: 42, state: 'closed', updated_at: '2026-08-01T00:00:00Z' }]);
    const core = mockCore();

    await runCoverageTrackerStep(github, context, core, { env: { MISSING_COUNT: '0', TRACKER_BODY: 'irrelevant' } });

    expect(github.rest.issues.update).not.toHaveBeenCalled();
    expect(github.rest.issues.create).not.toHaveBeenCalled();
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('a CLOSED tracker exists, missingCount > 0: REOPENS it instead of creating a duplicate -- this is the #165 fix (the old step only ever updated an OPEN issue and silently gave up once it was closed)', async () => {
    const github = mockGithub([{ number: 60, state: 'closed', updated_at: '2026-05-16T11:50:01Z' }]);
    const core = mockCore();

    await runCoverageTrackerStep(github, context, core, { env: { MISSING_COUNT: '2', TRACKER_BODY: 'new gaps' } });

    // Our mockGithub() ignores whatever `state` filter it was called with and
    // always returns the full fixture array -- so without this assertion, a
    // regression from state:'all' back to state:'open' (the exact #165/#60
    // bug: the real GitHub API would then never return a CLOSED issue at
    // all, so a closed tracker could never be found and reopened) would
    // still pass every other assertion below, because the mock's returned
    // data doesn't change. This is the one assertion that actually pins the
    // real-world-relevant call argument.
    expect(github.rest.issues.listForRepo).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'all' }),
    );
    expect(github.rest.issues.create).not.toHaveBeenCalled();
    expect(github.rest.issues.update).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 60, state: 'open', state_reason: 'reopened', body: 'new gaps' }),
    );
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(1);
  });

  it('multiple OPEN tracker issues (defensive, should never happen): warns and touches NOTHING, to avoid clobbering one arbitrarily', async () => {
    const github = mockGithub([
      { number: 10, state: 'open', updated_at: '2026-09-01T00:00:00Z' },
      { number: 11, state: 'open', updated_at: '2026-09-02T00:00:00Z' },
    ]);
    const core = mockCore();

    await runCoverageTrackerStep(github, context, core, { env: { MISSING_COUNT: '4', TRACKER_BODY: 'x' } });

    expect(core.warning).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.update).not.toHaveBeenCalled();
    expect(github.rest.issues.create).not.toHaveBeenCalled();
  });

  it('multiple issues with the label but only ONE open (the rest closed): reopening logic ignores the closed ones and updates the open one', async () => {
    const github = mockGithub([
      { number: 60, state: 'closed', updated_at: '2026-05-16T11:50:01Z' },
      { number: 200, state: 'open', updated_at: '2026-09-01T00:00:00Z' },
    ]);
    const core = mockCore();

    await runCoverageTrackerStep(github, context, core, { env: { MISSING_COUNT: '1', TRACKER_BODY: 'x' } });

    expect(github.rest.issues.update).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 200 }),
    );
    expect(github.rest.issues.create).not.toHaveBeenCalled();
  });
});
