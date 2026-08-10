import { describe, it, expect } from 'vitest';
import { stripTimestamp } from '../scripts/generate-body-contract-doc.mjs';
import { buildBodyContractDoc } from '../scripts/lib/body-contract-report.mjs';

/**
 * generate-body-contract-doc.mjs schreibt docs/body-contract-report.md nur, wenn sich
 * der Inhalt (ignoriert man den Erzeugungs-Zeitstempel) tatsächlich geändert hat — sonst
 * würde jeder tägliche Cron-Lauf einen leeren Commit erzeugen, obwohl sich an den
 * Findings nichts geändert hat. Diese Tests decken die dafür genutzte
 * stripTimestamp()-Normalisierung ab (analog tests/generate-coverage-doc.test.ts; das
 * eigentliche main() macht Datei-I/O + einen tsx-Subprozess gegen die echten
 * Projektdateien und wird deshalb nicht direkt unit-getestet).
 */

const baseFindings = [
  { type: 'UNTYPED_PASSTHROUGH', toolName: 'update_container', httpMethod: 'POST', path: '/api/containers/{containerId}/update', file: 'containers.ts', line: 209 },
];

describe('stripTimestamp', () => {
  it('treats two docs that only differ in the "Erzeugt" timestamp as identical', () => {
    const docA = buildBodyContractDoc({ generatedAt: '2026-08-10T09:00:00.000Z', bodyFindings: baseFindings });
    const docB = buildBodyContractDoc({ generatedAt: '2026-08-11T05:00:00.000Z', bodyFindings: baseFindings });

    expect(docA).not.toBe(docB); // sanity: they really do differ before normalization
    expect(stripTimestamp(docA)).toBe(stripTimestamp(docB));
  });

  it('still treats docs as different when the actual findings changed', () => {
    const docA = buildBodyContractDoc({ generatedAt: '2026-08-10T09:00:00.000Z', bodyFindings: baseFindings });
    const docB = buildBodyContractDoc({ generatedAt: '2026-08-10T09:00:00.000Z', bodyFindings: [] });

    expect(stripTimestamp(docA)).not.toBe(stripTimestamp(docB));
  });
});
