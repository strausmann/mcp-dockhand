/**
 * TOOL_DESCRIPTION_OVERRIDES (description-overrides.ts) — two structural invariants that
 * do not depend on the current wording of any individual entry:
 *   1. Every key is a real, registered MCP tool name (typo-proofing — an override for a
 *      tool that does not exist would silently do nothing, forever). Checked against the
 *      full set of tools `registerAllTools()` actually registers, NOT just
 *      `TOOL_ENDPOINT_MAP` — six of the ten current overrides (the self-help/meta tools,
 *      see description-overrides.ts's "category 2") have no Dockhand endpoint by design and
 *      are therefore never present in `TOOL_ENDPOINT_MAP`; checking against that map alone
 *      would make every one of them fail this invariant.
 *   2. Every value is non-empty prose (an empty override would defeat `describeTool()`'s
 *      "never return an empty string" contract — see describe-tool.ts).
 * Wording-specific assertions (does the override text avoid the exact wrong field/behavior
 * it was added to fix, or — for the meta tools — actually surface instead of the fallback)
 * live in tests/describe-tool.test.ts, next to the `describeTool()` call that surfaces them.
 */
import { describe, it, expect } from 'vitest';
import { TOOL_DESCRIPTION_OVERRIDES } from '../src/openapi/description-overrides.js';
import { registerAllTools } from '../src/tools/index.js';

/**
 * The full set of MCP tool names `registerAllTools()` actually registers — the same
 * capturing-fixture pattern tests/tool-descriptions-derived.test.ts uses, trimmed to just
 * the names since that is all this file needs. Registration-only: no handler is ever
 * invoked (same fixture already proven safe with an empty `{}` client stand-in there).
 */
function collectRegisteredToolNames(): Set<string> {
  const names = new Set<string>();
  const server = {
    tool(name: string) {
      names.add(name);
    },
  };
  registerAllTools(server as never, {} as never);
  return names;
}

const SHARED_ENDPOINT_MISMATCH_OVERRIDES = [
  'check_stack_env_collisions',
  'clear_user_roles',
  'get_git_stack_webhook',
  'remove_stack_env_vars',
];

const NO_ENDPOINT_META_TOOL_OVERRIDES = [
  'get_server_info',
  'check_for_update',
  'get_tool_manifest',
  'self_check',
  'validate_config',
  'get_runtime_stats',
];

describe('TOOL_DESCRIPTION_OVERRIDES', () => {
  const registeredNames = collectRegisteredToolNames();

  it('every override key is a real, registered MCP tool name', () => {
    for (const name of Object.keys(TOOL_DESCRIPTION_OVERRIDES)) {
      expect(registeredNames.has(name), `override key "${name}" is not a registered tool`).toBe(
        true,
      );
    }
  });

  it('every override value is non-empty prose', () => {
    for (const [name, text] of Object.entries(TOOL_DESCRIPTION_OVERRIDES)) {
      expect(text.trim().length, `override for "${name}" is empty`).toBeGreaterThan(0);
    }
  });

  it('covers exactly the four known shared-endpoint mismatches plus the six no-endpoint meta tools (P3 + Self-Help Final Fix Wave, Refs #57)', () => {
    // Not a hard ceiling on future overrides — a regression guard so a new entry is a
    // deliberate, reviewed addition rather than an accidental duplicate/typo key.
    expect(Object.keys(TOOL_DESCRIPTION_OVERRIDES).sort()).toEqual(
      [...SHARED_ENDPOINT_MISMATCH_OVERRIDES, ...NO_ENDPOINT_META_TOOL_OVERRIDES].sort(),
    );
  });
});
