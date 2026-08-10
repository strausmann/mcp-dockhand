/**
 * TOOL_DESCRIPTION_OVERRIDES (description-overrides.ts) — two structural invariants that
 * do not depend on the current wording of any individual entry:
 *   1. Every key is a real, registered MCP tool name (typo-proofing — an override for a
 *      tool that does not exist would silently do nothing, forever).
 *   2. Every value is non-empty prose (an empty override would defeat `describeTool()`'s
 *      "never return an empty string" contract — see describe-tool.ts).
 * Wording-specific assertions (does the override text avoid the exact wrong field/behavior
 * it was added to fix) live in tests/describe-tool.test.ts, next to the `describeTool()`
 * call that surfaces them.
 */
import { describe, it, expect } from 'vitest';
import { TOOL_DESCRIPTION_OVERRIDES } from '../src/openapi/description-overrides.js';
import { TOOL_ENDPOINT_MAP } from '../src/openapi/tool-endpoint-map.js';

describe('TOOL_DESCRIPTION_OVERRIDES', () => {
  it('every override key is a registered tool name in TOOL_ENDPOINT_MAP', () => {
    for (const name of Object.keys(TOOL_DESCRIPTION_OVERRIDES)) {
      expect(TOOL_ENDPOINT_MAP, `override key "${name}" is not a registered tool`).toHaveProperty(
        name,
      );
    }
  });

  it('every override value is non-empty prose', () => {
    for (const [name, text] of Object.entries(TOOL_DESCRIPTION_OVERRIDES)) {
      expect(text.trim().length, `override for "${name}" is empty`).toBeGreaterThan(0);
    }
  });

  it('covers exactly the four known shared-endpoint mismatches (P3 Final Fix Wave, Refs #57)', () => {
    // Not a hard ceiling on future overrides — a regression guard so a new entry is a
    // deliberate, reviewed addition rather than an accidental duplicate/typo key.
    expect(Object.keys(TOOL_DESCRIPTION_OVERRIDES).sort()).toEqual(
      ['check_stack_env_collisions', 'clear_user_roles', 'get_git_stack_webhook', 'remove_stack_env_vars'].sort(),
    );
  });
});
