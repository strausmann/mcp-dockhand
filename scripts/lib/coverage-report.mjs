/**
 * Reine Markdown-Erzeugung für docs/coverage.md — die eingecheckte, dauerhaft
 * sichtbare Coverage-Übersicht (Gegenstück zum flüchtigen, gitignoreten
 * `validation-report.md`).
 *
 * Alle Funktionen hier sind reine Funktionen ohne I/O: sie nehmen die bereits von
 * `validate-mcp-tools.mjs` berechneten Buckets (`computeValidation()`) entgegen und
 * bauen daraus Markdown. Der eigentliche Datei-Schreib-Vorgang lebt in
 * `generate-coverage-doc.mjs`.
 */

/**
 * Extrahiert den "Bereich" (erstes Pfad-Segment nach /api/) aus einem Endpoint-Pfad,
 * z.B. `/api/backup/schedule` → `backup`, `/api/stacks/{id}/env` → `stacks`.
 * @param {string} path
 * @returns {string}
 */
/**
 * Tracking-Issue der grössten echten Lücke (Backup-API). Kanonisch in ADR-0001 gepflegt
 * (docs/adr/0001-omission-registry.md) — beim Ändern BEIDE Stellen nachziehen. Stand hier
 * als Literal im Fliesstext und blieb deshalb auf #164 stehen, als das Issue geschlossen
 * wurde: die ADR-Korrektur allein wirkte nicht, weil das erzeugte Dokument aus DIESER Datei
 * kommt. Genau deshalb jetzt eine benannte Konstante statt einer Zahl mitten im Satz.
 */
const BACKUP_GAP_ISSUE = '#202';

function areaOf(path) {
  const match = path.match(/^\/api\/([^/]+)/);
  return match ? match[1] : path;
}

/**
 * Gruppiert MISSING_TOOL-Einträge nach Bereich, alphabetisch sortiert. Innerhalb eines
 * Bereichs werden die Einträge nach Pfad, dann nach HTTP-Methode sortiert.
 * @param {Array<{path: string, method: string, pathParams?: string[]}>} missingTool
 * @returns {Array<{area: string, entries: Array}>}
 */
function groupMissingByArea(missingTool) {
  const byArea = new Map();
  for (const entry of missingTool) {
    const area = areaOf(entry.path);
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(entry);
  }

  const areas = [...byArea.keys()].sort((a, b) => a.localeCompare(b));
  return areas.map((area) => {
    const entries = byArea
      .get(area)
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    return { area, entries };
  });
}

/**
 * Baut den vollständigen Markdown-Inhalt von docs/coverage.md.
 * @param {object} input
 * @param {string} input.generatedAt ISO-Timestamp der Erzeugung
 * @param {string} input.sourceCommit Voller Dockhand-Upstream-Commit-Hash aus dem Schema
 * @param {number} input.schemaEndpointCount Gesamtzahl der Endpunkte im Schema (inkl. ausgeschlossener)
 * @param {Array<{path: string, method: string, tools: string[]}>} input.covered
 * @param {Array<{path: string, method: string, pathParams?: string[]}>} input.missingTool
 * @param {Array<{path: string, method: string, reason: string, adr?: string}>} [input.deliberatelyOmitted]
 *   Registry-Treffer aus `partitionMissingTools()` (Task P3.7, ADR
 *   docs/adr/0001-omission-registry.md) -- Endpunkte, die WIR BEWUSST NIE als Tool
 *   aufnehmen. `[]` (Default) rendert keinen zusätzlichen Abschnitt -- Aufrufer ohne
 *   Registry (z.B. bestehende Tests) bleiben unverändert kompatibel.
 * @param {Array<{toolName: string, httpMethod: string, path: string, file: string, line: number}>} input.orphanedTool
 * @param {number} input.excludedCount Anzahl bewusst ausgeschlossener Endpunkte (IGNORED_PATTERNS)
 * @returns {string}
 */
function buildCoverageDoc({
  generatedAt,
  sourceCommit,
  schemaEndpointCount,
  covered,
  missingTool,
  deliberatelyOmitted = [],
  orphanedTool,
  excludedCount,
}) {
  const inScope = covered.length + missingTool.length;
  const percent = inScope === 0 ? 0 : (covered.length / inScope) * 100;
  const percentStr = percent.toFixed(1);

  const lines = [];

  lines.push('# MCP-Dockhand — API-Coverage');
  lines.push('');
  lines.push(
    '> **Auto-generiert** von `scripts/generate-coverage-doc.mjs` — nicht von Hand editieren.'
  );
  lines.push(
    '> Wird täglich vom Workflow `.github/workflows/api-schema-sync.yml` neu erzeugt und bei'
  );
  lines.push('> Änderung committet. Grundlage: `docs/dockhand-api-schema.json`.');
  lines.push('');
  lines.push(`**Erzeugt:** ${generatedAt}`);
  lines.push(`**Dockhand-Upstream-Commit:** \`${sourceCommit}\``);
  lines.push(`**Schema-Endpunkte gesamt:** ${schemaEndpointCount}`);
  lines.push('');

  lines.push('## Coverage');
  lines.push('');
  lines.push(`**${percentStr}%** (${covered.length}/${inScope} in-Scope-Endpunkte haben ein MCP-Tool)`);
  lines.push('');
  lines.push('| Status | Anzahl |');
  lines.push('|--------|--------|');
  lines.push(`| COVERED | ${covered.length} |`);
  lines.push(`| MISSING_TOOL | ${missingTool.length} |`);
  lines.push(`| Deliberately omitted (Registry, siehe unten) | ${deliberatelyOmitted.length} |`);
  lines.push(`| ORPHANED_TOOL | ${orphanedTool.length} |`);
  lines.push(`| Bewusst ausgeschlossen (Streams, Callbacks, interne Routen) | ${excludedCount} |`);
  lines.push('');

  if (missingTool.length > 0) {
    lines.push('## MISSING_TOOL — nach Bereich');
    lines.push('');
    lines.push(
      'Endpunkte, die laut Schema existieren, aber (noch) kein MCP-Tool haben — gruppiert nach dem'
    );
    lines.push('ersten Pfad-Segment nach `/api/`:');
    lines.push('');

    const grouped = groupMissingByArea(missingTool);
    for (const { area, entries } of grouped) {
      lines.push(`### ${area} (${entries.length})`);
      lines.push('');
      lines.push('| HTTP | Pfad | Path-Parameter |');
      lines.push('|------|------|----------------|');
      for (const e of entries) {
        lines.push(`| ${e.method} | \`${e.path}\` | ${e.pathParams?.join(', ') || '-'} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('## MISSING_TOOL');
    lines.push('');
    lines.push('Keine — alle in-Scope-Endpunkte haben ein MCP-Tool.');
    lines.push('');
  }

  // Deliberately omitted (Task P3.7, ADR docs/adr/0001-omission-registry.md) --
  // Registry-Treffer, die NICHT unter MISSING_TOOL oben auftauchen (Endpunkte, die WIR
  // BEWUSST NIE als Tool exponieren, z.B. das in #171 entfernte
  // POST /api/git/stacks/{id}/env-files). Sichtbar mit Begründung + ADR-Verweis statt
  // kommentarlos zu verschwinden — unterscheidet sich damit von "Bewusst ausgeschlossen"
  // oben (IGNORED_PATTERNS, aggregierte Zahl ohne Einzel-Begründung).
  if (deliberatelyOmitted.length > 0) {
    lines.push('## Deliberately omitted (with reason)');
    lines.push('');
    lines.push(
      'Endpunkte, die laut Schema existieren, aber laut `docs/omitted-endpoints.json` bewusst'
    );
    lines.push(
      'NIE ein MCP-Tool bekommen sollen. Unterscheidet sich von MISSING_TOOL oben: dort stehen'
    );
    lines.push(`echte, noch offene Lücken (z.B. die Backup-API, siehe ${BACKUP_GAP_ISSUE}).`);
    lines.push('');
    lines.push('| HTTP | Pfad | Begründung | ADR |');
    lines.push('|------|------|------------|-----|');
    for (const e of deliberatelyOmitted
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))) {
      lines.push(`| ${e.method} | \`${e.path}\` | ${e.reason} | ${e.adr ?? '-'} |`);
    }
    lines.push('');
  }

  if (orphanedTool.length > 0) {
    lines.push('## ORPHANED_TOOL');
    lines.push('');
    lines.push(
      'MCP-Tools, die einen Endpunkt referenzieren, der laut Schema nicht (mehr) existiert:'
    );
    lines.push('');
    lines.push('| Tool | HTTP | Pfad | Datei |');
    lines.push('|------|------|------|-------|');
    for (const t of orphanedTool) {
      lines.push(`| \`${t.toolName}\` | ${t.httpMethod} | \`${t.path}\` | ${t.file}:${t.line} |`);
    }
    lines.push('');
  }

  lines.push('## Details');
  lines.push('');
  lines.push(
    'Der vollständige Report inkl. aller COVERED-Endpunkte und weiterer Prüfungen'
  );
  lines.push(
    '(PARAM_MISMATCH, MISSING_ENCODE, QUERY_PARAM_*) entsteht bei jedem Lauf von'
  );
  lines.push('`node scripts/validate-mcp-tools.mjs` als `validation-report.md` (nicht eingecheckt).');
  lines.push('');

  return lines.join('\n') + '\n';
}

export { areaOf, groupMissingByArea, buildCoverageDoc };
