import { describe, it, expect } from 'vitest';
import { getBodyContract } from '../scripts/lib/openapi-contract-source.mjs';
import { createCapturingServer, getToolBodyShape } from '../scripts/lib/tool-body-shape.mjs';
import { computeBodyFindings, WHITELISTED_BODY_PASSTHROUGH } from '../scripts/lib/body-checks.mjs';
import { registerSystemTools } from '../src/tools/system.js';
import { registerLabelTools } from '../src/tools/labels.js';
import { registerStackTools } from '../src/tools/stacks.js';
import { registerUserTools } from '../src/tools/users.js';

/**
 * Task P2.1 Fix 2 -- anti-orphaning proof for WHITELISTED_BODY_PASSTHROUGH.
 *
 * A whitelist entry is only justified while it actually suppresses a real, currently-firing
 * BODY_PARAM_MISSING_REQUIRED candidate. If a future tool refactor makes the underlying Zod
 * shape send the field under its real name (or the endpoint contract drops the requirement),
 * the whitelist entry becomes a silent no-op -- nobody would notice, because "nothing fires"
 * looks identical to "a stale entry masks nothing". This file proves, against the REAL
 * registered tool shapes (via createCapturingServer(), the same fixture the P1.5 regression
 * test already established) and the REAL committed docs/dockhand-openapi.json (no fixture
 * spec), that every entry:
 *
 *   1. targets a field the real contract genuinely lists as required for that endpoint,
 *   2. would fire BODY_PARAM_MISSING_REQUIRED WITHOUT the whitelist (toolName omitted --
 *      proves there is still something real to suppress), and
 *   3. is actually suppressed WITH the whitelist active (toolName passed).
 *
 * If any of the 7 entries stops satisfying (1)+(2), this test fails loudly instead of the
 * whitelist quietly rotting into dead weight.
 */

const { server, shapes } = createCapturingServer();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerSystemTools(server as any, {} as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerLabelTools(server as any, {} as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerStackTools(server as any, {} as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
registerUserTools(server as any, {} as any);

/** One row per WHITELISTED_BODY_PASSTHROUGH entry -- the real endpoint each targets. */
const CASES = [
  { toolName: 'activate_license', field: 'key', method: 'POST', path: '/api/license' },
  { toolName: 'add_label', field: 'action', method: 'POST', path: '/api/labels' },
  { toolName: 'adopt_stack', field: 'stacks', method: 'POST', path: '/api/stacks/adopt' },
  { toolName: 'remove_stack_env_vars', field: 'variables', method: 'PUT', path: '/api/stacks/{name}/env' },
  { toolName: 'remove_stack_env_vars', field: 'content', method: 'PUT', path: '/api/stacks/{name}/env/raw' },
  { toolName: 'set_favorite_groups', field: 'action', method: 'POST', path: '/api/preferences/favorite-groups' },
  { toolName: 'set_favorites', field: 'action', method: 'POST', path: '/api/preferences/favorites' },
];

describe('WHITELISTED_BODY_PASSTHROUGH — every entry has a key in the set', () => {
  it.each(CASES)('$toolName:$field is present in WHITELISTED_BODY_PASSTHROUGH', ({ toolName, field }) => {
    expect(WHITELISTED_BODY_PASSTHROUGH.has(`${toolName}:${field}`)).toBe(true);
  });
});

describe('WHITELISTED_BODY_PASSTHROUGH — anti-orphaning proof (real contract + real tool shapes)', () => {
  it.each(CASES)(
    '$toolName:$field targets a genuinely required field, fires unfiltered, and is suppressed with the whitelist active',
    ({ toolName, field, method, path }) => {
      const contract = getBodyContract(method, path);
      expect(contract.hasSchema).toBe(true);
      expect(contract.requiredFields).toContain(field);

      const shape = getToolBodyShape(toolName, shapes);

      // (2) Without the whitelist (toolName omitted), the real shape genuinely does NOT
      // send this field under its contract name -- the candidate is real, not hypothetical.
      const unfiltered = computeBodyFindings(contract, shape, []);
      expect(unfiltered).toContainEqual({ type: 'BODY_PARAM_MISSING_REQUIRED', field });

      // (3) With the whitelist active (real toolName passed), this specific field is
      // suppressed -- proves the filter actually reaches this tool:field pair end-to-end.
      const filtered = computeBodyFindings(contract, shape, [], toolName);
      expect(filtered).not.toContainEqual({ type: 'BODY_PARAM_MISSING_REQUIRED', field });
    }
  );
});
