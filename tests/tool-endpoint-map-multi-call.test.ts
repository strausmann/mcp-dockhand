/**
 * Regression guard for the "first client call wins" bug class (found in PR #177 code
 * review, 2026-08-10): scripts/generate-tool-endpoint-map.mjs auto-resolves a tool's
 * endpoint from the FIRST client.<method>(...) call the static extractor finds for it.
 * That is wrong whenever a tool makes an earlier, CONDITIONAL call (e.g. a performance-
 * shortcut read) before its real, unconditional mutating call — exactly what happened to
 * `update_environment` (picked its conditional GET instead of its always-executed PUT)
 * and `remove_stack_env_vars` (picked a PUT shared with `update_stack_env`, inheriting
 * that tool's "Save environment variables..." description for what is actually a
 * key-removal operation).
 *
 * This test does NOT try to guess which call is "the right one" for a new multi-call
 * tool — that requires reading the handler, exactly as the two fixes above did. It only
 * enforces that nobody can ship a NEW multi-call tool whose calls resolve to DIFFERENT
 * endpoints without an EXPLICIT_OVERRIDES entry forcing a human to make and document that
 * call. A tool whose multiple calls all resolve to the SAME endpoint (e.g.
 * update_stack_compose: client.putSSE(...) vs client.put(...), both PUT
 * /api/stacks/{name}/compose depending on a `restart` flag) is unambiguous and does not
 * need an override — first-wins is harmless there by construction.
 */
import { describe, it, expect } from 'vitest';
import { extractToolCalls, endpointKey } from '../scripts/validate-mcp-tools.mjs';
import { EXPLICIT_OVERRIDES } from '../scripts/generate-tool-endpoint-map.mjs';

describe('tool-endpoint-map: multi-endpoint tools require an explicit, reviewed override', () => {
  it('every tool whose extracted calls resolve to more than one distinct endpoint has an EXPLICIT_OVERRIDES entry', () => {
    const calls = extractToolCalls();
    const endpointsByTool = new Map<string, Set<string>>();
    for (const call of calls) {
      const key = endpointKey(call.path, call.httpMethod);
      if (!endpointsByTool.has(call.toolName)) endpointsByTool.set(call.toolName, new Set());
      endpointsByTool.get(call.toolName)!.add(key);
    }

    const unsafeMultiCall: string[] = [];
    for (const [toolName, endpoints] of endpointsByTool) {
      if (endpoints.size > 1 && !(toolName in EXPLICIT_OVERRIDES)) {
        unsafeMultiCall.push(`${toolName}: ${[...endpoints].join(' | ')}`);
      }
    }

    expect(unsafeMultiCall, `\n${unsafeMultiCall.join('\n')}`).toEqual([]);
  });

  it('known multi-endpoint tools are exactly update_environment and remove_stack_env_vars (update_stack_compose stays single-endpoint on purpose)', () => {
    const calls = extractToolCalls();
    const endpointsByTool = new Map<string, Set<string>>();
    for (const call of calls) {
      const key = endpointKey(call.path, call.httpMethod);
      if (!endpointsByTool.has(call.toolName)) endpointsByTool.set(call.toolName, new Set());
      endpointsByTool.get(call.toolName)!.add(key);
    }

    const multiEndpointTools = [...endpointsByTool.entries()]
      .filter(([, endpoints]) => endpoints.size > 1)
      .map(([toolName]) => toolName)
      .sort();

    expect(multiEndpointTools).toEqual(['remove_stack_env_vars', 'update_environment']);
  });
});
