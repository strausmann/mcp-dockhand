#!/usr/bin/env node

/**
 * Body-Contract-Quelle: holt die von Dockhand mitgelieferte OpenAPI-Spec aus dem ECHTEN
 * Upstream Finsys/dockhand und kopiert sie nach docs/dockhand-openapi.json — der Eingang,
 * den scripts/lib/openapi-contract-source.mjs (Task P1.2) konsumiert.
 *
 * Der Quell-Commit ist bewusst GEPINNT (nicht "aktueller Branch-Head"): Body-Contract-
 * Checks sollen reproduzierbar sein und nicht bei jedem fremden Push auf den Branch
 * driften. Eine Aktualisierung auf einen neueren Commit ist ein expliziter, nachvollzieh-
 * barer Schritt (die Konstante unten ändern) — kein automatisches "immer die neueste Ref".
 *
 * Ablauf:
 *   1. Shallow-Fetch GENAU des gepinnten Commits (kein voller Branch-Klon nötig — GitHub
 *      erlaubt das Fetchen einzelner erreichbarer SHAs über die Smart-HTTP-Protokoll).
 *   2. Liest die vom Upstream MITGELIEFERTE `src/lib/openapi.generated.json`. Früher wurde
 *      hier `npm install` + `npx tsx scripts/generate-openapi.ts` ausgeführt; das entfällt
 *      (schneller, keine Netz-/Toolchain-Abhängigkeit im Quell-Klon) und geht upstream
 *      ohnehin nicht mehr — dort fehlen die Generator-Dateien.
 *   3. Kopiert die Spec nach `docs/dockhand-openapi.json` in DIESEM Repo, mit
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

// Body-Contract-Quelle: der ECHTE Upstream Finsys/dockhand.
//
// Bis 2026-08-17 stand hier strausmann/dockhand (unser Fork), Branch feat/openapi-refresh
// -- damals richtig, weil die @openapi-Annotationen nur in unserem PR-Branch existierten.
// Inzwischen hat der Maintainer sie uebernommen (Commit da26f7f, "OpenAPI spec at /api/docs
// with a Scalar viewer") UND liefert die erzeugte Spec als src/lib/openapi.generated.json
// mit. Der Fork ist seitdem eingefroren; solange diese Konstante auf ihn zeigte, blieb
// docs/dockhand-openapi.json auf 1.0.41 stehen und kannte weder die secret-providers-Familie
// noch /api/images/load. Genau diese Fork-Falle hat am selben Tag schon einmal zugeschlagen
// (falsches "neuestes Release" aus veralteten Tags).
//
// GEPINNT auf einen festen Commit -- siehe Datei-Kopf-Kommentar. Aktualisieren = bewusster
// Schritt, nicht "immer der aktuelle Branch-Head".
const SOURCE_REPO = 'https://github.com/Finsys/dockhand.git';
const SOURCE_BRANCH = 'main';
const SOURCE_COMMIT = 'da26f7f764563a35dacc970cc0196e6aa7828384';

// Die vom Maintainer MITGELIEFERTE Spec -- nicht mehr selbst generiert.
//
// Frueher lief hier `npm install` + `npx tsx scripts/generate-openapi.ts` im Quell-Klon.
// Das geht upstream nicht mehr: der Cherry-Pick hat scripts/generate-openapi.ts sowie
// scripts/openapi/{lib,build-spec}.ts NICHT mitgenommen (verifiziert -- `npm run prebuild`
// bricht dort mit Exit 1 ab). Selbst generieren waere ausserdem schlechter: unsere Fassung
// des Generators kennt das Top-Level-Feld `description:` nicht und verschluckt es
// stillschweigend -- 73 Operationsbeschreibungen wuerden verlorengehen.
const GENERATED_RELATIVE_PATH = join('src', 'lib', 'openapi.generated.json');
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
  const generatedFile = join(cloneDir, GENERATED_RELATIVE_PATH);
  if (!existsSync(generatedFile)) {
    throw new Error(
      `[fetch-openapi] ${GENERATED_RELATIVE_PATH} fehlt im Quell-Klon. Liefert der gepinnte ` +
        'Commit die erzeugte Spec nicht (mehr) mit? Nicht auf Selbst-Generieren ausweichen — ' +
        'unser Generator verschluckt das Feld "description" und liefert eine aermere Spec.'
    );
  }

  console.error(`[fetch-openapi] Uebernehme mitgelieferte Spec ${GENERATED_RELATIVE_PATH}...`);
  const spec = JSON.parse(readFileSync(generatedFile, 'utf8'));

  // Der Upstream committet die Spec aus seinem AKTUELLEN main-Baum, nicht aus dem Stand des
  // jeweiligen Commits — sie kann also Pfade enthalten, die es im laufenden Release noch
  // nicht gibt (belegt 17.08.2026: /api/containers/{id}/version-notes stammt aus ba8670a,
  // erschien aber schon in der Spec von da26f7f). Solche Pfade werden NICHT entfernt: die
  // Spec dient der Beschreibung, und ein Tool entsteht ohnehin nur bewusst und nur fuer
  // einen Endpunkt, den die deployte Version hat. Der Hinweis steht hier, damit ein
  // Abgleich "Spec-Pfad ohne Tool" nicht als Luecke fehlgedeutet wird.
  return spec;
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
