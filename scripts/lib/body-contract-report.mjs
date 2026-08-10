/**
 * Reine Markdown-Erzeugung für docs/body-contract-report.md — die eingecheckte, dauerhaft
 * sichtbare Übersicht der Body-Contract-Findings aus Task P1.4 (Gegenstück zum flüchtigen,
 * gitignoreten `validation-report.md`, analog zu docs/coverage.md/coverage-report.mjs).
 *
 * Alle Funktionen hier sind reine Funktionen ohne I/O: sie nehmen `bodyFindings`
 * entgegen (Rückgabe von computeValidation()s `bodyFindings`-Bucket, siehe
 * validate-mcp-tools.mjs) und bauen daraus Markdown. Der eigentliche Datei-Schreib-
 * Vorgang lebt in `generate-body-contract-doc.mjs`.
 *
 * BEWUSST ADVISORY (Task P1.6 / P1-Plan Global Constraints): dieses Dokument ist eine
 * Übersicht, kein Gate. Die Beförderung von BODY_PARAM_MISSING_REQUIRED zu einem harten
 * CI-Fail ist Phase P2 (erst nach FP-freier Voll-Sweep-Triage, siehe Task P2.1/P2.2 im
 * Body-Contract-Validierungs-Plan) — bis dahin ist dieses Dokument rein informativ.
 */

const FINDING_ORDER = ['BODY_PARAM_MISSING_REQUIRED', 'BODY_PARAM_UNKNOWN', 'UNTYPED_PASSTHROUGH', 'BODY_CONTRACT_UNRESOLVED'];

const FINDING_DESCRIPTIONS = {
  BODY_PARAM_MISSING_REQUIRED:
    'Ein laut OpenAPI-Contract required Body-Feld wird vom Tool nicht als required gesendet — der Aufruf kann am echten Endpunkt fehlschlagen (siehe #142).',
  BODY_PARAM_UNKNOWN:
    'Das Tool sendet ein Body-Feld, das der OpenAPI-Contract nicht kennt (nach Ausschluss der Query-/Path-Parameter der Operation).',
  UNTYPED_PASSTHROUGH:
    'Das Tool hat ein untypisiertes `z.record(...)`-Feld (z.B. `settings`), obwohl der Endpunkt einen aufgelösten Contract hat — statisch nicht vollständig prüfbar.',
  BODY_CONTRACT_UNRESOLVED:
    'Für diesen body-tragenden Endpunkt liegt (noch) kein OpenAPI-Contract vor (fehlende `@openapi`-JSDoc-Annotation im Dockhand-Fork).',
};

/**
 * Gruppiert die Findings nach Typ, in der festen FINDING_ORDER-Reihenfolge (kritischste
 * zuerst), jede Gruppe intern nach Tool-Name sortiert.
 * @param {Array<{type: string, field?: string, toolName: string, httpMethod: string, path: string, file: string, line: number}>} bodyFindings
 * @returns {Array<{type: string, entries: Array}>}
 */
function groupFindingsByType(bodyFindings) {
  const byType = new Map();
  for (const finding of bodyFindings) {
    if (!byType.has(finding.type)) byType.set(finding.type, []);
    byType.get(finding.type).push(finding);
  }

  const types = FINDING_ORDER.filter((t) => byType.has(t));
  // Unbekannte/neue Finding-Typen (falls computeBodyFindings() künftig erweitert wird)
  // trotzdem anzeigen, statt sie stillschweigend zu verschlucken -- ans Ende gehängt.
  for (const t of byType.keys()) {
    if (!types.includes(t)) types.push(t);
  }

  return types.map((type) => ({
    type,
    entries: byType.get(type).slice().sort((a, b) => a.toolName.localeCompare(b.toolName)),
  }));
}

/**
 * Baut den vollständigen Markdown-Inhalt von docs/body-contract-report.md.
 * @param {object} input
 * @param {string} input.generatedAt ISO-Timestamp der Erzeugung
 * @param {Array<{type: string, field?: string, toolName: string, httpMethod: string, path: string, file: string, line: number}>} input.bodyFindings
 * @returns {string}
 */
function buildBodyContractDoc({ generatedAt, bodyFindings }) {
  const lines = [];

  lines.push('# MCP-Dockhand — Body-Contract-Findings');
  lines.push('');
  lines.push(
    '> **Auto-generiert** von `scripts/generate-body-contract-doc.mjs` — nicht von Hand editieren.'
  );
  lines.push(
    '> Wird täglich vom Workflow `.github/workflows/api-schema-sync.yml` neu erzeugt und bei'
  );
  lines.push(
    '> Änderung committet. Grundlage: `docs/dockhand-openapi.json` (Body-Contract-Quelle,'
  );
  lines.push('> siehe `scripts/fetch-openapi.mjs`) gegen die registrierten Zod-Shapes unserer MCP-Tools.');
  lines.push('');
  lines.push(
    '> **ADVISORY — kein CI-Gate.** Diese Findings beeinflussen keinen Exit-Code. Phase P1 des'
  );
  lines.push(
    '> Body-Contract-Validierungs-Plans ist bewusst informativ; die Beförderung ins Gate (mindestens'
  );
  lines.push('> `BODY_PARAM_MISSING_REQUIRED`) ist Phase P2, nach einer FP-freien Voll-Sweep-Triage.');
  lines.push('');
  lines.push(`**Erzeugt:** ${generatedAt}`);
  lines.push('');

  lines.push('## Zusammenfassung');
  lines.push('');
  lines.push('| Typ | Anzahl | Bedeutung |');
  lines.push('|-----|--------|-----------|');
  const grouped = groupFindingsByType(bodyFindings);
  for (const { type, entries } of grouped) {
    lines.push(`| ${type} | ${entries.length} | ${FINDING_DESCRIPTIONS[type] ?? '-'} |`);
  }
  if (grouped.length === 0) {
    lines.push('| *(keine)* | 0 | Keine Body-Contract-Abweichungen gefunden. |');
  }
  lines.push('');

  if (grouped.length === 0) {
    lines.push('Keine Findings — alle geprüften Tools stimmen mit ihrem OpenAPI-Body-Contract überein.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  for (const { type, entries } of grouped) {
    lines.push(`## ${type} (${entries.length})`);
    lines.push('');
    lines.push(FINDING_DESCRIPTIONS[type] ?? '');
    lines.push('');
    lines.push('| Tool | HTTP | Pfad | Feld | Datei |');
    lines.push('|------|------|------|------|-------|');
    for (const e of entries) {
      lines.push(`| \`${e.toolName}\` | ${e.httpMethod} | \`${e.path}\` | ${e.field ? `\`${e.field}\`` : '-'} | ${e.file}:${e.line} |`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

export { FINDING_ORDER, FINDING_DESCRIPTIONS, groupFindingsByType, buildBodyContractDoc };
