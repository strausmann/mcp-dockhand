#!/usr/bin/env node

/**
 * Coverage-Doc-Generator
 *
 * Erzeugt `docs/coverage.md` — die eingecheckte, dauerhaft sichtbare API-Coverage-
 * Übersicht (Ablösung des toten Sticky-Issue-#60-Mechanismus, siehe api-schema-sync.yml).
 *
 * Nutzt dieselbe Berechnung wie `validate-mcp-tools.mjs` (`computeValidation()`), damit
 * die Zahlen garantiert übereinstimmen. Schreibt IMMER (auch wenn validate-mcp-tools.mjs
 * kritische Mismatches findet und mit Exit 1 abbricht) — Coverage-Sichtbarkeit soll nicht
 * an einem unabhängigen Fehler (z.B. ORPHANED_TOOL) hängen.
 *
 * Verwendung:
 *   node scripts/generate-coverage-doc.mjs
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchema, extractToolCalls, computeValidation } from './validate-mcp-tools.mjs';
import { buildCoverageDoc } from './lib/coverage-report.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const COVERAGE_DOC = join(PROJECT_ROOT, 'docs', 'coverage.md');

// Die Zeile mit dem Erzeugungs-Zeitstempel — beim Vergleich "hat sich der Inhalt
// wirklich geändert?" ausgeblendet, analog zu extract-dockhand-api.mjs (dort
// `generatedAt: ''`), sonst würde JEDER Lauf (z.B. der tägliche Cron) einen Commit
// erzeugen, obwohl sich an Coverage/Endpunkten nichts geändert hat.
const TIMESTAMP_LINE = /^\*\*Erzeugt:\*\* .*$/m;

function stripTimestamp(content) {
  return content.replace(TIMESTAMP_LINE, '**Erzeugt:** <normalized>');
}

function main() {
  const schema = loadSchema();
  const toolCalls = extractToolCalls();
  const { covered, missingTool, orphanedTool, excludedCount } = computeValidation(schema, toolCalls);

  const doc = buildCoverageDoc({
    generatedAt: new Date().toISOString(),
    sourceCommit: schema.sourceCommit,
    schemaEndpointCount: schema.endpointCount,
    covered,
    missingTool,
    orphanedTool,
    excludedCount,
  });

  const inScope = covered.length + missingTool.length;
  const percent = inScope === 0 ? '0.0' : ((covered.length / inScope) * 100).toFixed(1);

  if (existsSync(COVERAGE_DOC)) {
    const existing = readFileSync(COVERAGE_DOC, 'utf8');
    if (stripTimestamp(existing) === stripTimestamp(doc)) {
      console.error(`[coverage-doc] Unverändert (${percent}%, ${covered.length}/${inScope}) — kein Schreibvorgang`);
      return;
    }
  }

  writeFileSync(COVERAGE_DOC, doc, 'utf8');
  console.error(`[coverage-doc] Geschrieben: ${COVERAGE_DOC}`);
  console.error(`[coverage-doc] Coverage: ${percent}% (${covered.length}/${inScope})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, stripTimestamp };
