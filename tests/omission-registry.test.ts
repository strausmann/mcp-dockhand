import { describe, it, expect } from 'vitest';
import { partitionMissingTools } from '../scripts/lib/omission-registry.mjs';

/**
 * Omission-Governance (P3 Task 7, ADR docs/adr/0001-omission-registry.md, Refs #57).
 *
 * `partitionMissingTools()` trennt die rohen MISSING_TOOL-Funde von
 * `computeValidation()` (scripts/validate-mcp-tools.mjs) in zwei Eimer:
 * - `realGaps` — Endpunkte ohne Tool, die NICHT in der Registry stehen (echte Lücke,
 *   z.B. die Backup-API #202 — geplant, nur noch nicht implementiert)
 * - `deliberatelyOmitted` — Endpunkte, die bewusst nie ein MCP-Tool bekommen sollen
 *   (docs/omitted-endpoints.json), inkl. der Begründung aus dem Registry-Eintrag
 */

describe('partitionMissingTools', () => {
  it('unterdrückt MISSING_TOOL für registrierte Auslassungen', () => {
    const registry = [
      {
        method: 'POST',
        path: '/api/git/stacks/{id}/env-files',
        reason: 'Entfernt in #171 — redundant zu get_git_stack_env_files + update_stack_env.',
        adr: 'docs/adr/0001-omission-registry.md',
        date: '2026-08-10',
      },
    ];
    const missing = partitionMissingTools(
      [
        { method: 'POST', path: '/api/git/stacks/{id}/env-files' },
        { method: 'POST', path: '/api/really/missing' },
      ],
      registry
    );

    expect(missing.realGaps.map((g) => g.path)).toEqual(['/api/really/missing']);
    expect(missing.deliberatelyOmitted).toHaveLength(1);
  });

  it('lässt einen Backup-Endpunkt (echte Lücke, nicht in der Registry) in realGaps', () => {
    const registry = [
      {
        method: 'POST',
        path: '/api/self-update',
        reason: 'Self-Update ist gefährlich über MCP auszulösen.',
        adr: 'docs/adr/0001-omission-registry.md',
        date: '2026-08-10',
      },
    ];
    const missing = partitionMissingTools(
      [{ method: 'GET', path: '/api/backup/configs' }],
      registry
    );

    expect(missing.realGaps).toHaveLength(1);
    expect(missing.realGaps[0].path).toBe('/api/backup/configs');
    expect(missing.deliberatelyOmitted).toHaveLength(0);
  });

  it('behandelt eine leere Registry als Nicht-Fund (alles bleibt realGaps)', () => {
    const missing = partitionMissingTools(
      [
        { method: 'GET', path: '/api/backup/configs' },
        { method: 'POST', path: '/api/backup/configs' },
      ],
      []
    );

    expect(missing.realGaps).toHaveLength(2);
    expect(missing.deliberatelyOmitted).toHaveLength(0);
  });

  it('behandelt eine leere Missing-Liste als Nicht-Fund', () => {
    expect(
      partitionMissingTools([], [{ method: 'GET', path: '/api/x', reason: 'Test fixture, content irrelevant here.' }]),
    ).toEqual({
      realGaps: [],
      deliberatelyOmitted: [],
    });
  });

  it('matcht Methode case-insensitiv, Pfad aber exakt (nach Normalisierung)', () => {
    const registry = [
      {
        method: 'post',
        path: '/api/git/stacks/{id}/env-files',
        reason: 'x',
        adr: 'docs/adr/0001-omission-registry.md',
        date: '2026-08-10',
      },
    ];
    const missing = partitionMissingTools(
      [{ method: 'POST', path: '/api/git/stacks/{stackId}/env-files' }],
      registry
    );

    // Unterschiedlicher Platzhaltername (stackId vs. id) darf den Match nicht verhindern —
    // dieselbe {*}-Normalisierung wie endpointKey()/normalizePath() in validate-mcp-tools.mjs.
    expect(missing.deliberatelyOmitted).toHaveLength(1);
    expect(missing.realGaps).toHaveLength(0);
  });

  it('reichert deliberatelyOmitted-Einträge mit reason und adr aus der Registry an', () => {
    const registry = [
      {
        method: 'POST',
        path: '/api/self-update',
        reason: 'Self-Update ist gefährlich über MCP auszulösen.',
        adr: 'docs/adr/0001-omission-registry.md',
        date: '2026-08-10',
      },
    ];
    const missing = partitionMissingTools(
      [{ method: 'POST', path: '/api/self-update', pathParams: [] }],
      registry
    );

    expect(missing.deliberatelyOmitted[0]).toMatchObject({
      path: '/api/self-update',
      method: 'POST',
      reason: 'Self-Update ist gefährlich über MCP auszulösen.',
      adr: 'docs/adr/0001-omission-registry.md',
    });
  });
});
