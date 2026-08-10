#!/usr/bin/env node

/**
 * Body-Contract-Doc-Generator (Task P1.6)
 *
 * Erzeugt `docs/body-contract-report.md` — die eingecheckte, dauerhaft sichtbare
 * Übersicht der Body-Contract-Findings aus Task P1.4 (analog zu
 * `generate-coverage-doc.mjs`/`docs/coverage.md`).
 *
 * Nutzt dieselbe Berechnung wie `validate-mcp-tools.mjs` (`computeValidation()`s
 * `bodyFindings`-Bucket), damit die Zahlen garantiert übereinstimmen. Schreibt IMMER
 * (auch wenn validate-mcp-tools.mjs kritische Mismatches findet und mit Exit 1
 * abbricht) — Body-Contract-Sichtbarkeit soll nicht an einem unabhängigen Fehler
 * (z.B. ORPHANED_TOOL) hängen, genau wie bei coverage.md.
 *
 * Body-Shapes werden über den tsx-Collector (scripts/collect-tool-shapes.mjs, siehe
 * dessen Datei-Kopf-Kommentar) gesammelt -- schlägt das fehl (tsx fehlt,
 * docs/dockhand-openapi.json existiert noch nicht, ...), schreibt dieser Generator
 * trotzdem ein valides, leeres Dokument statt abzubrechen: fehlende Body-Findings sind
 * kein Fehlerzustand für ein rein informatives Dokument.
 *
 * Verwendung:
 *   node scripts/generate-body-contract-doc.mjs
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadSchema, extractToolCalls, computeValidation } from './validate-mcp-tools.mjs';
import { buildBodyContractDoc } from './lib/body-contract-report.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const BODY_CONTRACT_DOC = join(PROJECT_ROOT, 'docs', 'body-contract-report.md');
const COLLECT_SHAPES_SCRIPT = join(__dirname, 'collect-tool-shapes.mjs');

// Die Zeile mit dem Erzeugungs-Zeitstempel — beim Vergleich "hat sich der Inhalt
// wirklich geändert?" ausgeblendet, analog zu generate-coverage-doc.mjs, sonst würde
// JEDER Lauf (z.B. der tägliche Cron) einen Commit erzeugen, obwohl sich an den
// Findings nichts geändert hat.
const TIMESTAMP_LINE = /^\*\*Erzeugt:\*\* .*$/m;

function stripTimestamp(content) {
  return content.replace(TIMESTAMP_LINE, '**Erzeugt:** <normalized>');
}

/**
 * Siehe loadToolBodyShapes() in validate-mcp-tools.mjs für das ausführliche WARUM
 * (tsx-Subprozess statt direktem Import) — dieselbe Logik, hier dupliziert statt
 * importiert, damit dieser Generator eigenständig lauffähig bleibt und nicht an
 * validate-mcp-tools.mjs's CLI-Seiteneffekten (validate() läuft beim direkten Import
 * NICHT automatisch, siehe dessen `import.meta.url`-Guard -- unproblematisch, aber
 * eine unnötige Kopplung für ein reines Lese-Skript).
 * @returns {Record<string, {sentFields: string[], requiredSent: string[], passthrough: boolean}>|null}
 */
function loadToolBodyShapes() {
  try {
    const output = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', COLLECT_SHAPES_SCRIPT], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(output);
  } catch (err) {
    console.error(`[body-contract-doc] Body-Shapes nicht verfügbar (tsx-Collector fehlgeschlagen): ${err.message}`);
    return null;
  }
}

function main() {
  const schema = loadSchema();
  const toolCalls = extractToolCalls();
  const toolBodyShapes = loadToolBodyShapes();

  const { bodyFindings } = computeValidation(schema, toolCalls, toolBodyShapes);

  const doc = buildBodyContractDoc({
    generatedAt: new Date().toISOString(),
    bodyFindings,
  });

  if (existsSync(BODY_CONTRACT_DOC)) {
    const existing = readFileSync(BODY_CONTRACT_DOC, 'utf8');
    if (stripTimestamp(existing) === stripTimestamp(doc)) {
      console.error(`[body-contract-doc] Unverändert (${bodyFindings.length} Findings) — kein Schreibvorgang`);
      return;
    }
  }

  writeFileSync(BODY_CONTRACT_DOC, doc, 'utf8');
  console.error(`[body-contract-doc] Geschrieben: ${BODY_CONTRACT_DOC}`);
  console.error(`[body-contract-doc] ${bodyFindings.length} Findings (advisory, kein Gate)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, stripTimestamp };
