import { describe, it, expect } from 'vitest';
import { matchRoute } from '../../src/openapi/match-route.js';

/**
 * `matchRoute()` reverse-matches a concrete request (method + pathname) against the KNOWN
 * set of templates in the pinned spec (`docs/dockhand-openapi.json`) — these tests run
 * against that real spec, not a mock, so a match here is evidence the fix works against
 * what actually ships.
 */
describe('matchRoute', () => {
  it('distinguishes /env from /env/raw — the core bug this fixes', () => {
    // remove_stack_env_vars hits both endpoints; before this fix both debug lines said
    // "…/env/raw" because the route came from the tool's single TOOL_ENDPOINT_MAP entry.
    expect(matchRoute('/api/stacks/paperless/env/raw', 'GET')).toBe('/api/stacks/{name}/env/raw');
    expect(matchRoute('/api/stacks/paperless/env', 'GET')).toBe('/api/stacks/{name}/env');
  });

  it('prefers the literal template over the parameterised one it also matches', () => {
    // POST /api/stacks/adopt matches BOTH the literal /api/stacks/adopt (which the spec
    // defines for POST) and the parameterised /api/stacks/{name} (with {name} = "adopt").
    // For the method the literal defines, the literal one wins.
    expect(matchRoute('/api/stacks/adopt', 'POST')).toBe('/api/stacks/adopt');
  });

  /**
   * METHOD DECIDES FIRST (Codex, PR #219). The pinned spec defines POST on the literal
   * /api/stacks/adopt but DELETE only on /api/stacks/{name}. `delete_stack` acting on a
   * stack literally named "adopt" sends DELETE /api/stacks/adopt — which must resolve to
   * /api/stacks/{name} (where DELETE lives), NOT the literal /api/stacks/adopt (a
   * nonexistent DELETE combination). A method-blind most-literal rule gets this wrong.
   */
  it('picks the template that actually defines the request method, not just the most literal one', () => {
    expect(matchRoute('/api/stacks/adopt', 'DELETE')).toBe('/api/stacks/{name}');
    // The same collision on images: POST /api/images/pull is the literal; DELETE is on
    // /api/images/{id}. An image literally identified as "pull" under DELETE must resolve
    // to the {id} template.
    expect(matchRoute('/api/images/pull', 'DELETE')).toBe('/api/images/{id}');
    expect(matchRoute('/api/images/pull', 'POST')).toBe('/api/images/pull');
  });

  it('returns undefined for a pathname that matches no known template', () => {
    expect(matchRoute('/api/totally-unknown-endpoint/xyz', 'GET')).toBeUndefined();
  });

  /**
   * SAFETY COUNTER-CHECK (the property this whole approach exists to guarantee): a stack
   * literally named "env" must not leak through as a literal path segment. The pathname
   * has an "env" segment TWICE — once as the caller's stack name (position 3, where the
   * template has `{name}`) and once as the literal "env" sub-resource (position 4, where
   * the template has the literal "env"). Only a matcher that compares by POSITION against
   * the template — not by "is this word one I recognise as a keyword" — gets this right.
   *
   * A heuristic ("approach B", rejected by design) that instead walks segments and treats
   * any segment matching a known route keyword (env, raw, stacks, ...) as literal
   * regardless of position would treat BOTH "env" segments as the literal keyword and
   * return the caller's own path unchanged (`/api/stacks/env/env/raw`) instead of
   * substituting the first one for `{name}` — silently leaking the caller's stack name.
   * This assertion is what would catch that: it requires the FIRST "env" to have become
   * `{name}` and the result to equal the template exactly, nothing else.
   */
  it('never leaks a caller value that collides with a template keyword (stack named "env")', () => {
    const result = matchRoute('/api/stacks/env/env/raw', 'GET');
    expect(result).toBe('/api/stacks/{name}/env/raw');
    // Anchor the safety property explicitly, not just via toBe: the RETURNED string must
    // be the template, not the caller's own path re-emitted unchanged.
    expect(result).not.toBe('/api/stacks/env/env/raw');
  });
});
