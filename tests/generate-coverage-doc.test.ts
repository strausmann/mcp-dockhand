import { describe, it, expect } from 'vitest';
import { stripTimestamp } from '../scripts/generate-coverage-doc.mjs';
import { buildCoverageDoc } from '../scripts/lib/coverage-report.mjs';

/**
 * generate-coverage-doc.mjs schreibt docs/coverage.md nur, wenn sich der Inhalt
 * (ignoriert man den Erzeugungs-Zeitstempel) tatsächlich geändert hat — sonst würde
 * jeder tägliche Cron-Lauf einen leeren Commit erzeugen, obwohl sich an
 * Coverage/Endpunkten nichts geändert hat. Diese Tests decken die dafür genutzte
 * `stripTimestamp()`-Normalisierung ab (das eigentliche main() macht Datei-I/O gegen
 * die echten Projektdateien und wird deshalb nicht direkt unit-getestet).
 */

const baseInput = {
  sourceCommit: '905c4a004dafe1cbad4ed2babc2c532d7f4018b8',
  schemaEndpointCount: 235,
  covered: [{ path: '/api/containers', method: 'GET', tools: ['list_containers'] }],
  missingTool: [{ path: '/api/backup/schedule', method: 'GET', pathParams: [] }],
  orphanedTool: [],
  excludedCount: 11,
};

describe('stripTimestamp', () => {
  it('treats two docs that only differ in the "Erzeugt" timestamp as identical', () => {
    const docA = buildCoverageDoc({ ...baseInput, generatedAt: '2026-08-10T09:00:00.000Z' });
    const docB = buildCoverageDoc({ ...baseInput, generatedAt: '2026-08-11T05:00:00.000Z' });

    expect(docA).not.toBe(docB); // sanity: they really do differ before normalization
    expect(stripTimestamp(docA)).toBe(stripTimestamp(docB));
  });

  it('still treats docs as different when the actual coverage data changed', () => {
    const docA = buildCoverageDoc({ ...baseInput, generatedAt: '2026-08-10T09:00:00.000Z' });
    const docB = buildCoverageDoc({
      ...baseInput,
      generatedAt: '2026-08-10T09:00:00.000Z',
      missingTool: [],
    });

    expect(stripTimestamp(docA)).not.toBe(stripTimestamp(docB));
  });
});
