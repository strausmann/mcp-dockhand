#!/usr/bin/env node

/**
 * Body-Contract-Quelle: holt die generierte openapi.json aus dem JSDoc-annotierten
 * strausmann/dockhand-Branch `feat/openapi-refresh` (= Finsys/dockhand#1341) und kopiert
 * sie nach docs/dockhand-openapi.json — der Eingang, den
 * scripts/lib/openapi-contract-source.mjs (Task P1.2) konsumiert.
 *
 * Der Quell-Commit ist bewusst GEPINNT (nicht "aktueller Branch-Head"): Body-Contract-
 * Checks sollen reproduzierbar sein und nicht bei jedem fremden Push auf den Branch
 * driften. Eine Aktualisierung auf einen neueren Commit ist ein expliziter, nachvollzieh-
 * barer Schritt (die Konstante unten ändern) — kein automatisches "immer die neueste Ref".
 *
 * Ablauf:
 *   1. Shallow-Fetch GENAU des gepinnten Commits (kein voller Branch-Klon nötig — GitHub
 *      erlaubt das Fetchen einzelner erreichbarer SHAs über die Smart-HTTP-Protokoll).
 *   2. `npm install` (bewusst NICHT `npm ci` — der Quell-Branch/-Klon hat für diesen
 *      Fetch-Zweck keine relevante, committete Lockfile-Erwartung an uns).
 *   3. `npx tsx scripts/generate-openapi.ts` — Dockhands eigener Generator (standalone,
 *      kein Docker/DB nötig), schreibt `static/openapi.json`.
 *   4. Kopiert die erzeugte Spec nach `docs/dockhand-openapi.json` in DIESEM Repo, mit
 *      No-op-Schutz (ignoriert ein eventuelles `generatedAt`-Feld beim Vergleich, analog
 *      `generate-coverage-doc.mjs`/`extract-dockhand-api.mjs`), damit ein inhaltlich
 *      unveränderter Contract keinen Leer-Commit erzeugt.
 *   5. Räumt das Temp-Verzeichnis wieder auf.
 *
 * Verwendung:
 *   node scripts/fetch-openapi.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// Body-Contract-Quelle: strausmann/dockhand, Branch feat/openapi-refresh (= Finsys/dockhand#1341).
// GEPINNT auf einen festen Commit -- siehe Datei-Kopf-Kommentar. Aktualisieren = bewusster Schritt,
// nicht "immer der aktuelle Branch-Head".
const SOURCE_REPO = 'https://github.com/strausmann/dockhand.git';
const SOURCE_BRANCH = 'feat/openapi-refresh';
const SOURCE_COMMIT = 'db2a196f7241c12faf693cf7b2bc2e26df8dc75c';

// Wo Dockhands eigener Generator die Spec im Quell-Klon ablegt (scripts/generate-openapi.ts).
const GENERATED_RELATIVE_PATH = join('static', 'openapi.json');
const OUTPUT_FILE = join(PROJECT_ROOT, 'docs', 'dockhand-openapi.json');

/**
 * Klont genau den gepinnten Commit (Shallow-Fetch einer einzelnen SHA, kein voller
 * Branch-Klon) in ein frisches Temp-Verzeichnis.
 * @returns {string} Pfad zum Klon
 */
function fetchPinnedCommit() {
  const cloneDir = mkdtempSync(join(tmpdir(), 'dockhand-openapi-fetch-'));
  console.error(
    `[fetch-openapi] Hole ${SOURCE_REPO}@${SOURCE_COMMIT} (Branch ${SOURCE_BRANCH}) nach ${cloneDir}...`
  );

  execFileSync('git', ['init', '-q', cloneDir], { stdio: 'pipe' });
  execFileSync('git', ['-C', cloneDir, 'fetch', '--depth', '1', SOURCE_REPO, SOURCE_COMMIT], {
    stdio: 'pipe',
  });
  execFileSync('git', ['-C', cloneDir, 'checkout', '-q', 'FETCH_HEAD'], { stdio: 'pipe' });

  return cloneDir;
}

/**
 * Installiert die Dependencies des Quell-Klons und lässt Dockhands eigenen
 * OpenAPI-Generator laufen.
 * @param {string} cloneDir
 * @returns {object} Der geparste Inhalt der erzeugten `static/openapi.json`
 */
function generateSpec(cloneDir) {
  console.error('[fetch-openapi] npm install im Quell-Klon...');
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: cloneDir, stdio: 'pipe' });

  console.error('[fetch-openapi] npx tsx scripts/generate-openapi.ts...');
  execFileSync('npx', ['tsx', 'scripts/generate-openapi.ts'], { cwd: cloneDir, stdio: 'pipe' });

  const generatedFile = join(cloneDir, GENERATED_RELATIVE_PATH);
  if (!existsSync(generatedFile)) {
    throw new Error(
      `[fetch-openapi] Generator hat ${GENERATED_RELATIVE_PATH} nicht erzeugt (Ausgabepfad im Quell-Repo geändert?)`
    );
  }

  return JSON.parse(readFileSync(generatedFile, 'utf8'));
}

/**
 * Normalisiert eine Spec für den Inhalts-Vergleich — entfernt ein eventuelles Top-Level-
 * `generatedAt`-Feld, das sich bei jedem Lauf ändern kann, ohne dass sich der eigentliche
 * Contract geändert hat (analog `stripTimestamp()` in generate-coverage-doc.mjs). Die
 * aktuell erzeugte Dockhand-Spec (2026-08-10, Commit db2a196) enthält kein solches Feld —
 * diese Funktion ist trotzdem defensiv für den Fall, dass ein künftiger Generator-Lauf
 * eines ergänzt.
 * @param {object} spec
 * @returns {string}
 */
function stableStringify(spec) {
  const { generatedAt: _generatedAt, ...comparable } = spec ?? {};
  return JSON.stringify(comparable);
}

/**
 * Reine Entscheidungsfunktion (kein I/O): muss die neue Spec geschrieben werden, oder ist
 * der bestehende Datei-Inhalt (roher Text, `null` wenn die Datei nicht existiert) bereits
 * inhaltsgleich?
 * @param {string|null} existingRaw Roher Inhalt der bestehenden Ausgabedatei, oder `null`
 * @param {object} spec Die neu erzeugte Spec
 * @returns {boolean} `true` wenn geschrieben werden muss
 */
function needsWrite(existingRaw, spec) {
  if (existingRaw === null) return true;

  let existing;
  try {
    existing = JSON.parse(existingRaw);
  } catch {
    return true; // Bestehende Datei ist kein valides JSON -- lieber überschreiben als raten
  }

  return stableStringify(existing) !== stableStringify(spec);
}

function main() {
  let cloneDir;
  try {
    cloneDir = fetchPinnedCommit();
    const spec = generateSpec(cloneDir);

    const existingRaw = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, 'utf8') : null;
    if (!needsWrite(existingRaw, spec)) {
      console.error('[fetch-openapi] Unverändert -- kein Schreibvorgang');
      return;
    }

    writeFileSync(OUTPUT_FILE, JSON.stringify(spec, null, 2) + '\n', 'utf8');
    console.error(`[fetch-openapi] Geschrieben: ${OUTPUT_FILE}`);
  } finally {
    if (cloneDir && existsSync(cloneDir)) {
      rmSync(cloneDir, { recursive: true, force: true });
      console.error('[fetch-openapi] Temp-Verzeichnis aufgeräumt');
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  main,
  stableStringify,
  needsWrite,
  SOURCE_REPO,
  SOURCE_BRANCH,
  SOURCE_COMMIT,
  GENERATED_RELATIVE_PATH,
  OUTPUT_FILE,
};
