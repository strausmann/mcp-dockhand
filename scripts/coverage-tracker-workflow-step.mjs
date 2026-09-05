/**
 * The `github-script` body of the "Create/update/close/reopen coverage tracker
 * issue" step in `.github/workflows/api-schema-sync.yml` (#227 Part 2), factored
 * out into its own function so it can be exercised by
 * `tests/coverage-tracker-workflow-step.test.ts` with a MOCKED `github`/`context`/
 * `core` — this workflow step talks to the live GitHub REST API and therefore
 * cannot be tested any other way (no CI run available here, see the task's
 * "kein Live-Test möglich" note).
 *
 * IMPORTANT: this file is NOT what actually runs in CI. `actions/github-script`
 * only accepts an inline `script:` block, not an importable module — the
 * workflow's `script:` is meant to be a byte-for-byte copy of this function's
 * body (minus the wrapping `async function ... { }` / export). If you change the
 * logic here, copy the SAME change into the workflow YAML, and vice versa —
 * `tests/coverage-tracker-workflow-step.test.ts` ("drift guard" describe block)
 * extracts both texts and fails the build if they diverge, so a missed copy
 * cannot silently ship.
 */

async function runCoverageTrackerStep(github, context, core, process) {
  const TRACKER_LABEL = 'coverage-tracker';
  const TRACKER_TITLE = 'MCP API coverage tracker (auto-maintained)';
  const missingCount = parseInt(process.env.MISSING_COUNT, 10);
  const body = process.env.TRACKER_BODY;

  if (Number.isNaN(missingCount)) {
    core.warning('coverage-tracker-summary.mjs did not report a numeric missing_count -- skipping tracker update.');
    return;
  }

  // state: 'all' -- a previously CLOSED tracker must be found too, so it
  // can be reopened instead of a duplicate being created (the #60/#165 bug
  // was specifically about a closed issue never getting revisited).
  const existing = await github.rest.issues.listForRepo({
    owner: context.repo.owner,
    repo: context.repo.repo,
    labels: TRACKER_LABEL,
    state: 'all',
    per_page: 10,
  });

  const openIssues = existing.data.filter((i) => i.state === 'open');
  if (openIssues.length > 1) {
    const nums = openIssues.map((i) => `#${i.number}`).join(', ');
    core.warning(`Multiple OPEN issues carry label "${TRACKER_LABEL}" (${nums}) -- skipping update to avoid clobbering.`);
    return;
  }

  const openIssue = openIssues[0];
  // Most recently updated (closed or open) issue with the label, if any --
  // the one candidate to reopen when a fresh tracker is needed.
  const anyIssue = existing.data.length > 0
    ? existing.data.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0]
    : undefined;

  if (missingCount === 0) {
    if (!openIssue) {
      core.info('MISSING_TOOL is 0 and no open tracker issue exists -- nothing to close.');
      return;
    }
    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: openIssue.number,
      body,
    });
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: openIssue.number,
      body: 'MISSING_TOOL reached 0 -- closing this tracker automatically. It will reopen if a future Dockhand release introduces an endpoint without an MCP tool.',
    });
    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: openIssue.number,
      state: 'closed',
      state_reason: 'completed',
    });
    core.info(`Closed coverage tracker issue #${openIssue.number} (MISSING_TOOL: 0).`);
    return;
  }

  // missingCount > 0 from here on.
  if (openIssue) {
    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: openIssue.number,
      body,
    });
    core.info(`Updated open coverage tracker issue #${openIssue.number} (MISSING_TOOL: ${missingCount}).`);
    return;
  }

  if (anyIssue) {
    // A tracker exists but is CLOSED (either it was resolved before, or a
    // human closed it manually) -- reopen it instead of creating a
    // duplicate. This is the exact step the #60 mechanism never took.
    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: anyIssue.number,
      body,
      state: 'open',
      state_reason: 'reopened',
    });
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: anyIssue.number,
      body: `Reopened automatically: MISSING_TOOL is ${missingCount} again.`,
    });
    core.info(`Reopened coverage tracker issue #${anyIssue.number} (MISSING_TOOL: ${missingCount}).`);
    return;
  }

  const created = await github.rest.issues.create({
    owner: context.repo.owner,
    repo: context.repo.repo,
    title: TRACKER_TITLE,
    labels: [TRACKER_LABEL],
    body,
  });
  core.info(`Created coverage tracker issue #${created.data.number} (MISSING_TOOL: ${missingCount}).`);
}

export { runCoverageTrackerStep };
