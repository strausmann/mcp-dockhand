import { describe, it, expect } from 'vitest';
import { TRACKER_LABEL, buildTrackerBody } from '../scripts/lib/coverage-tracker.mjs';

/**
 * #227 Part 2 — pure body-builder for the self-healing `coverage-tracker` issue.
 * The workflow-side I/O (finding/creating/updating/closing/reopening the actual
 * GitHub issue) lives in `.github/workflows/api-schema-sync.yml` and cannot be unit
 * tested without a live GitHub API — see `scripts/coverage-tracker-summary.mjs`
 * header comment. This file covers everything that CAN be tested: the markdown the
 * workflow feeds into that API call.
 */

describe('TRACKER_LABEL', () => {
  it('matches the label the previous mechanism (#60) used, so an existing tracker issue is found, not duplicated', () => {
    expect(TRACKER_LABEL).toBe('coverage-tracker');
  });
});

describe('buildTrackerBody', () => {
  it('missingCount 0: reports "no gaps" and does NOT render a MISSING_TOOL section', () => {
    const body = buildTrackerBody({
      missingCount: 0,
      missingTool: [],
      sourceCommit: 'abc123',
    });

    expect(body).toContain('No open gaps');
    expect(body).toContain('**MISSING_TOOL:** 0');
    expect(body).not.toContain('## MISSING_TOOL — by area');
  });

  it('missingCount > 0: renders a MISSING_TOOL section grouped by area, one table per area', () => {
    const body = buildTrackerBody({
      missingCount: 3,
      missingTool: [
        { path: '/api/backup/schedule', method: 'GET', pathParams: [] },
        { path: '/api/backup/jobs', method: 'POST', pathParams: [] },
        { path: '/api/registry/image', method: 'DELETE', pathParams: [] },
      ],
      sourceCommit: 'abc123',
    });

    expect(body).toContain('**MISSING_TOOL:** 3');
    expect(body).toContain('## MISSING_TOOL — by area');
    expect(body).toContain('### backup (2)');
    expect(body).toContain('### registry (1)');
    expect(body).toContain('| GET | `/api/backup/schedule` |');
    expect(body).toContain('| POST | `/api/backup/jobs` |');
    expect(body).toContain('| DELETE | `/api/registry/image` |');
    expect(body).not.toContain('No open gaps');
  });

  it('always includes the source commit and the count, so the tracker can never silently disagree with docs/coverage.md', () => {
    const body = buildTrackerBody({
      missingCount: 1,
      missingTool: [{ path: '/api/x/y', method: 'GET', pathParams: [] }],
      sourceCommit: 'deadbeef',
    });

    expect(body).toContain('`deadbeef`');
    expect(body).toContain('**MISSING_TOOL:** 1');
  });

  it('includes a run-log link only when workflowRunUrl is given (manual/local invocation omits it)', () => {
    const withUrl = buildTrackerBody({
      missingCount: 0,
      missingTool: [],
      sourceCommit: 'abc123',
      workflowRunUrl: 'https://github.com/strausmann/mcp-dockhand/actions/runs/1',
    });
    const withoutUrl = buildTrackerBody({
      missingCount: 0,
      missingTool: [],
      sourceCommit: 'abc123',
    });

    expect(withUrl).toContain('[run log](https://github.com/strausmann/mcp-dockhand/actions/runs/1)');
    expect(withoutUrl).not.toContain('run log');
  });

  it('never instructs a human to edit the body by hand (the workflow fully replaces it every run)', () => {
    const body = buildTrackerBody({ missingCount: 0, missingTool: [], sourceCommit: 'abc123' });
    expect(body).toContain('Do not edit this body by hand');
  });
});
