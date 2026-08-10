import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { getBodyContract } from '../scripts/lib/openapi-contract-source.mjs';
import { computeBodyShape, createCapturingServer, getToolBodyShape } from '../scripts/lib/tool-body-shape.mjs';
import { computeBodyFindings } from '../scripts/lib/body-checks.mjs';
import { registerContainerTools } from '../src/tools/containers.js';

/**
 * Task P1.5 -- regression proof: would the Task P1.4 body-contract checks have caught
 * Finsys/dockhand issue #142?
 *
 * #142 (`fix(tools): make update_container require a body and validate settings keys`,
 * commit ba4e142) fixed `update_container`'s pre-fix shape:
 *
 *   {
 *     environmentId: z.number(),
 *     containerId: z.string(),
 *     settings: z.record(z.string(), z.unknown()).optional(),
 *   }
 *
 * (verified against `git show ba4e142~1:src/tools/containers.ts` -- the parent commit's
 * actual shape, not a guess). A no-argument call was schema-valid but sent NO settings at
 * all, which Dockhand's handler (unconditional `await request.json()`) turned into a
 * guaranteed 500 ("Unexpected end of JSON input") instead of a clear client-side error.
 *
 * IMPORTANT, VERIFIED FINDING (see first `describe` block below): `POST
 * /api/containers/{id}/update`'s REAL, committed openapi contract
 * (docs/dockhand-openapi.json, generated from Finsys/dockhand's own JSDoc annotations) has
 * `requiredFields: []` -- NO individual body field is documented as required for this
 * endpoint (only `requestBody.required: true`, i.e. "send *a* body", which OpenApiContractSource
 * intentionally does not surface as a field-level requirement -- see getBodyContract()'s
 * JSDoc). That means BODY_PARAM_MISSING_REQUIRED structurally CANNOT fire for this specific
 * endpoint, for ANY tool shape -- there is no required field in the contract to compare
 * against. #142's actual failure mode (a technically-valid-but-empty request) is a
 * different class of bug than what BODY_PARAM_MISSING_REQUIRED checks for.
 *
 * Per the P1 plan's own contingency ("falls update_container keinen required-Body hat,
 * nimm einen anderen realen Endpunkt mit required-Body als #142-analogen Beleg und
 * begründe"), this file therefore proves the check on the closest real analog instead:
 * `POST /api/containers/{id}/rename` (`rename_container`, same file, same "container
 * mutation that Dockhand's handler will act on without further validation" bug class),
 * whose real contract DOES have a required body field (`name`). The second `describe`
 * block below constructs a #142-PATTERN naive shape for it (a field the real backend
 * requires modeled as Zod-optional -- the exact shape of the #142 bug, generalized) and
 * proves BODY_PARAM_MISSING_REQUIRED fires against the real, committed openapi contract.
 * The third block proves the CURRENT actual rename_container registration does NOT trigger
 * it -- the check discriminates correctly between the buggy and the fixed shape, not just
 * between arbitrary inputs.
 */

describe('#142 endpoint check: does the real update_container contract even have a required field?', () => {
  it('confirms POST /api/containers/{id}/update has NO individually required body field in the real, committed spec', () => {
    // This is why BODY_PARAM_MISSING_REQUIRED cannot be demonstrated against
    // update_container itself -- see the file-level comment above for the full
    // reasoning. Asserted here (not just claimed in prose) so a future openapi refresh
    // that DOES add a required field to this endpoint fails this test loudly instead of
    // silently leaving the reasoning below stale.
    const contract = getBodyContract('POST', '/api/containers/{id}/update');

    expect(contract.hasSchema).toBe(true);
    expect(contract.requiredFields).toEqual([]);
  });

  it('the reconstructed pre-#142 update_container shape produces UNTYPED_PASSTHROUGH, not BODY_PARAM_MISSING_REQUIRED, against the real contract', () => {
    // Reconstructed verbatim from `git show ba4e142~1:src/tools/containers.ts` (the parent
    // commit, i.e. the actual shape #142 fixed) -- not a guess.
    const preFixShape = computeBodyShape({
      environmentId: z.number(),
      containerId: z.string(),
      settings: z.record(z.string(), z.unknown()).optional(),
    });

    const contract = getBodyContract('POST', '/api/containers/{id}/update');
    const findings = computeBodyFindings(contract, preFixShape, ['environmentId', 'containerId']);

    // Confirms the negative: this endpoint's real contract gives the P1.4 checks nothing
    // to catch the #142 failure mode with, beyond flagging that the tool is statically
    // unverifiable (UNTYPED_PASSTHROUGH) -- which is true, but not a "missing required
    // field" finding. Hence the substitution to rename_container below.
    expect(findings).toEqual([{ type: 'UNTYPED_PASSTHROUGH' }]);
  });
});

describe('#142-pattern regression proof on the real analog: POST /api/containers/{id}/rename', () => {
  it('flags BODY_PARAM_MISSING_REQUIRED for a #142-pattern naive shape (backend-required field modeled as optional) against the REAL committed contract', () => {
    // The #142 bug pattern, generalized: an MCP tool schema under-constrains a field the
    // real backend requires, guaranteeing the request fails once it reaches Dockhand. Here
    // that pattern is applied to rename_container's real required field (`name`) instead
    // of update_container's `settings` (which has no OpenAPI-documented required field to
    // violate, see above) -- same bug class, real required field to demonstrate it with.
    const naiveShape = computeBodyShape({
      environmentId: z.number(),
      containerId: z.string(),
      name: z.string().optional(), // bug: real backend requires this
    });

    // No fixture override -- getBodyContract() reads the real, committed
    // docs/dockhand-openapi.json, exactly as validate-mcp-tools.mjs does at runtime.
    const contract = getBodyContract('POST', '/api/containers/{id}/rename');
    expect(contract.hasSchema).toBe(true);
    expect(contract.requiredFields).toEqual(['name']); // the real backend requirement

    const findings = computeBodyFindings(contract, naiveShape, ['environmentId', 'containerId']);

    expect(findings).toContainEqual({ type: 'BODY_PARAM_MISSING_REQUIRED', field: 'name' });
  });

  it('does NOT flag the current, actual rename_container registration -- proves the check discriminates, not just always fires', () => {
    const { server, shapes } = createCapturingServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerContainerTools(server as any, {} as any);

    const currentShape = getToolBodyShape('rename_container', shapes);
    expect(currentShape.requiredSent).toContain('name'); // the fix: name is NOT optional today

    const contract = getBodyContract('POST', '/api/containers/{id}/rename');
    const findings = computeBodyFindings(contract, currentShape, ['environmentId', 'containerId']);

    expect(findings.filter((f) => f.type === 'BODY_PARAM_MISSING_REQUIRED')).toEqual([]);
  });
});
