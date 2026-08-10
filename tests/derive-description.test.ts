/**
 * deriveToolDescription — derives the slim MCP tool description (summary +
 * curated, tool-name-resolved cross-references) from an OpenAPI operation.
 *
 * Does NOT surface the full prose `description` block; only the extracted
 * cross-reference fragments (see docs/openapi-annotations.md Section 3 in
 * the Dockhand repo for the upstream `<field> from <METHOD> /api/<path>`
 * string contract this parses).
 */
import { describe, it, expect } from 'vitest';
import { deriveToolDescription } from '../src/openapi/derive-description.js';

describe('deriveToolDescription', () => {
  it('uses summary as the core and never surfaces the full description prose', () => {
    const out = deriveToolDescription(
      {
        summary: 'List the .env files present in a git stack repo',
        description: 'long human prose that should not appear …',
      },
      () => undefined,
    );
    expect(out).toContain('List the .env files present in a git stack repo');
    expect(out).not.toContain('long human prose');
  });

  it('resolves a body cross-reference from the description prose to a tool name', () => {
    const out = deriveToolDescription(
      {
        summary: 'Create a git-backed stack',
        description: 'Create a git-backed stack. environmentId from GET /api/environments.',
      },
      (m, p) => (m === 'GET' && p === '/api/environments' ? 'list_environments' : undefined),
    );
    expect(out).toMatch(/environmentId from list_environments/);
  });

  it('resolves a path/query parameter cross-reference to a tool name', () => {
    const out = deriveToolDescription(
      {
        summary: 'Read env files',
        parameters: [
          { in: 'path', name: 'id', description: 'Git stack ID (from GET /api/git/stacks)' },
        ],
      },
      (_m, p) => (p === '/api/git/stacks' ? 'list_git_stacks' : undefined),
    );
    expect(out).toMatch(/id.*from list_git_stacks/);
  });

  it('leaves an unresolvable cross-reference as the raw endpoint, without crashing', () => {
    const out = deriveToolDescription(
      { summary: 'X', description: 'X. fooId from GET /api/foo.' },
      () => undefined,
    );
    expect(out).toMatch(/from GET \/api\/foo/);
  });

  it('falls back to a defined, non-empty description when summary is missing', () => {
    const out = deriveToolDescription({}, () => undefined);
    expect(out).toBeDefined();
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('falls back to a defined, non-empty description when summary is an empty string', () => {
    const out = deriveToolDescription({ summary: '' }, () => undefined);
    expect(out.length).toBeGreaterThan(0);
  });
});
