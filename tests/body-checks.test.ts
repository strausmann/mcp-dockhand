import { describe, it, expect } from 'vitest';
import { computeBodyFindings, WHITELISTED_BODY_PASSTHROUGH } from '../scripts/lib/body-checks.mjs';

/**
 * computeBodyFindings() korreliert die Soll-Seite (getBodyContract()) mit der Ist-Seite
 * (getToolBodyShape()) und meldet vier advisory Finding-Typen. Alle Fälle hier arbeiten
 * mit handgeschriebenen Contract-/Shape-Fixtures (keine echte openapi.json nötig -- das
 * ist bereits in tests/openapi-contract-source.test.ts abgedeckt), damit dieser Test
 * ausschließlich die Korrelationslogik selbst prüft.
 */

describe('computeBodyFindings — BODY_PARAM_MISSING_REQUIRED', () => {
  it('flags a contract-required field the tool never sends as required', () => {
    const contract = { hasSchema: true, requiredFields: ['name', 'compose'], knownFields: ['name', 'compose', 'start'] };
    const toolShape = { sentFields: ['name', 'compose'], requiredSent: ['name'], passthrough: false };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings).toContainEqual({ type: 'BODY_PARAM_MISSING_REQUIRED', field: 'compose' });
  });

  it('reports one finding per missing required field, not just the first', () => {
    const contract = { hasSchema: true, requiredFields: ['a', 'b', 'c'], knownFields: ['a', 'b', 'c'] };
    const toolShape = { sentFields: ['a'], requiredSent: ['a'], passthrough: false };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings.filter((f) => f.type === 'BODY_PARAM_MISSING_REQUIRED')).toEqual([
      { type: 'BODY_PARAM_MISSING_REQUIRED', field: 'b' },
      { type: 'BODY_PARAM_MISSING_REQUIRED', field: 'c' },
    ]);
  });

  it('reports nothing when every required field is sent as required', () => {
    const contract = { hasSchema: true, requiredFields: ['name'], knownFields: ['name'] };
    const toolShape = { sentFields: ['name'], requiredSent: ['name'], passthrough: false };

    expect(computeBodyFindings(contract, toolShape)).toEqual([]);
  });
});

describe('computeBodyFindings — BODY_PARAM_UNKNOWN', () => {
  it('flags a sent field the contract does not know', () => {
    const contract = { hasSchema: true, requiredFields: [], knownFields: ['name', 'compose'] };
    const toolShape = { sentFields: ['name', 'compose', 'bogusField'], requiredSent: [], passthrough: false };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings).toContainEqual({ type: 'BODY_PARAM_UNKNOWN', field: 'bogusField' });
  });

  it('does NOT flag a query/path parameter that is not a body field (the opParams exclusion)', () => {
    const contract = { hasSchema: true, requiredFields: ['name'], knownFields: ['name'] };
    // environmentId/containerId come from the same Zod shape as the body fields, but they
    // are path/query params of the operation -- never part of the body schema.
    const toolShape = { sentFields: ['environmentId', 'containerId', 'name'], requiredSent: ['environmentId', 'containerId', 'name'], passthrough: false };

    const findings = computeBodyFindings(contract, toolShape, ['environmentId', 'containerId']);

    expect(findings.filter((f) => f.type === 'BODY_PARAM_UNKNOWN')).toEqual([]);
  });

  it('still flags a genuinely unknown field even when opParams are present', () => {
    const contract = { hasSchema: true, requiredFields: [], knownFields: ['name'] };
    const toolShape = { sentFields: ['environmentId', 'name', 'typo'], requiredSent: [], passthrough: false };

    const findings = computeBodyFindings(contract, toolShape, ['environmentId']);

    expect(findings).toEqual([{ type: 'BODY_PARAM_UNKNOWN', field: 'typo' }]);
  });
});

describe('computeBodyFindings — UNTYPED_PASSTHROUGH', () => {
  it('flags passthrough:true when the contract has a resolvable schema', () => {
    const contract = { hasSchema: true, requiredFields: [], knownFields: ['name'] };
    const toolShape = { sentFields: ['name', 'settings'], requiredSent: [], passthrough: true };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings).toContainEqual({ type: 'UNTYPED_PASSTHROUGH' });
  });

  it('suppresses BODY_PARAM_UNKNOWN entirely for a passthrough tool (container field name has no API equivalent)', () => {
    const contract = { hasSchema: true, requiredFields: [], knownFields: ['image', 'name'] };
    const toolShape = { sentFields: ['settings'], requiredSent: [], passthrough: true };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings).toEqual([{ type: 'UNTYPED_PASSTHROUGH' }]);
  });

  it('does NOT flag BODY_PARAM_MISSING_REQUIRED for a whole-body z.record(...) passthrough tool (Collector-Fix, P2.1) -- the collector cannot see field names nested inside the record, so every contract-required field would otherwise be a guaranteed false positive', () => {
    const contract = { hasSchema: true, requiredFields: ['name'], knownFields: ['name'] };
    const toolShape = { sentFields: ['settings'], requiredSent: [], passthrough: true };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings).toEqual([{ type: 'UNTYPED_PASSTHROUGH', expectedRequired: ['name'] }]);
  });

  it('attaches expectedRequired with ALL contract-required fields to the UNTYPED_PASSTHROUGH finding, so the report still shows what to watch for', () => {
    const contract = { hasSchema: true, requiredFields: ['name', 'compose'], knownFields: ['name', 'compose'] };
    const toolShape = { sentFields: ['config'], requiredSent: ['config'], passthrough: true };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings).toEqual([{ type: 'UNTYPED_PASSTHROUGH', expectedRequired: ['name', 'compose'] }]);
  });

  it('omits expectedRequired entirely when the contract has no required fields at all (nothing to watch for)', () => {
    const contract = { hasSchema: true, requiredFields: [], knownFields: ['name'] };
    const toolShape = { sentFields: ['settings'], requiredSent: [], passthrough: true };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings).toEqual([{ type: 'UNTYPED_PASSTHROUGH' }]);
    expect(findings[0]).not.toHaveProperty('expectedRequired');
  });
});

describe('computeBodyFindings — BODY_CONTRACT_UNRESOLVED', () => {
  it('reports only BODY_CONTRACT_UNRESOLVED when the endpoint has no resolvable schema at all', () => {
    const contract = { hasSchema: false, requiredFields: [], knownFields: [] };
    const toolShape = { sentFields: ['anything'], requiredSent: ['anything'], passthrough: false };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings).toEqual([{ type: 'BODY_CONTRACT_UNRESOLVED' }]);
  });

  it('does not additionally report BODY_PARAM_UNKNOWN noise against an empty knownFields list', () => {
    const contract = { hasSchema: false, requiredFields: [], knownFields: [] };
    const toolShape = { sentFields: ['a', 'b', 'c'], requiredSent: [], passthrough: false };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('BODY_CONTRACT_UNRESOLVED');
  });
});

describe('computeBodyFindings — happy path', () => {
  it('reports nothing for a fully contract-compliant, non-passthrough tool', () => {
    const contract = { hasSchema: true, requiredFields: ['name', 'compose'], knownFields: ['name', 'compose', 'start'] };
    const toolShape = { sentFields: ['environmentId', 'name', 'compose', 'start'], requiredSent: ['environmentId', 'name', 'compose'], passthrough: false };

    expect(computeBodyFindings(contract, toolShape, ['environmentId'])).toEqual([]);
  });

  it('defaults opParams to an empty list when omitted', () => {
    const contract = { hasSchema: true, requiredFields: ['name'], knownFields: ['name'] };
    const toolShape = { sentFields: ['name'], requiredSent: ['name'], passthrough: false };

    expect(computeBodyFindings(contract, toolShape)).toEqual([]);
  });
});

describe('computeBodyFindings — WHITELISTED_BODY_PASSTHROUGH (Task P2.1 Fix 2, FP_COMPUTED_BODY)', () => {
  /**
   * These fixtures model tools whose Zod input shape does NOT match the wire body 1:1
   * because the callback computes/renames/hardcodes a field before sending it (e.g.
   * `add_label` never declares `action` in its Zod shape, but its callback always sends
   * `{ action: 'add', ... }` on the wire) -- NOT the z.record(...) Ganzkörper-passthrough
   * case covered above (toolShape.passthrough stays false here). The collector can only
   * see the declared Zod shape, so these are statically unprovable and need a real,
   * per-tool:field whitelist instead of a structural fix.
   */

  it('suppresses BODY_PARAM_MISSING_REQUIRED for a whitelisted tool:field pair (activate_license sends the required "key" field, just renamed from its Zod field "licenseKey")', () => {
    const contract = { hasSchema: true, requiredFields: ['name', 'key'], knownFields: ['name', 'key', 'licenseKey'] };
    const toolShape = { sentFields: ['licenseKey'], requiredSent: ['licenseKey'], passthrough: false };

    const findings = computeBodyFindings(contract, toolShape, [], 'activate_license');

    // "key" is whitelisted (renamed on the wire) and must NOT appear; "name" is a genuine
    // gap (activate_license never sends it at all, under any name) and must still fire.
    expect(findings.filter((f) => f.type === 'BODY_PARAM_MISSING_REQUIRED')).toEqual([
      { type: 'BODY_PARAM_MISSING_REQUIRED', field: 'name' },
    ]);
  });

  it('does NOT suppress the same field name for a DIFFERENT, non-whitelisted tool -- the filter is a tool:field pair, not a bare field name', () => {
    const contract = { hasSchema: true, requiredFields: ['key'], knownFields: ['key'] };
    const toolShape = { sentFields: [], requiredSent: [], passthrough: false };

    const findings = computeBodyFindings(contract, toolShape, [], 'some_other_tool');

    expect(findings).toEqual([{ type: 'BODY_PARAM_MISSING_REQUIRED', field: 'key' }]);
  });

  it('does not suppress anything when toolName is omitted (backward-compatible default)', () => {
    const contract = { hasSchema: true, requiredFields: ['action'], knownFields: ['action', 'label', 'environmentIds'] };
    const toolShape = { sentFields: ['label', 'environmentIds'], requiredSent: ['label', 'environmentIds'], passthrough: false };

    expect(computeBodyFindings(contract, toolShape)).toEqual([{ type: 'BODY_PARAM_MISSING_REQUIRED', field: 'action' }]);
  });

  it('exposes exactly the 7 verified tool:field pairs documented in the P2.1 triage', () => {
    // Guards against silent drift of the whitelist set itself (accidental additions/
    // removals) -- the anti-orphaning proof against the REAL contract + REAL tool shapes
    // lives in tests/body-checks-whitelist-anti-orphan.test.ts.
    expect([...WHITELISTED_BODY_PASSTHROUGH].sort()).toEqual([
      'activate_license:key',
      'add_label:action',
      'adopt_stack:stacks',
      'remove_stack_env_vars:content',
      'remove_stack_env_vars:variables',
      'set_favorite_groups:action',
      'set_favorites:action',
    ]);
  });
});
