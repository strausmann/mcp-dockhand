import { describe, it, expect } from 'vitest';
import { computeBodyFindings } from '../scripts/lib/body-checks.mjs';

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

  it('still flags BODY_PARAM_MISSING_REQUIRED alongside UNTYPED_PASSTHROUGH -- passthrough does not excuse a missing explicit required field', () => {
    const contract = { hasSchema: true, requiredFields: ['name'], knownFields: ['name'] };
    const toolShape = { sentFields: ['settings'], requiredSent: [], passthrough: true };

    const findings = computeBodyFindings(contract, toolShape);

    expect(findings).toEqual([
      { type: 'BODY_PARAM_MISSING_REQUIRED', field: 'name' },
      { type: 'UNTYPED_PASSTHROUGH' },
    ]);
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
