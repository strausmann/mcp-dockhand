/**
 * Omission-Governance (P3 Task 7, ADR docs/adr/0001-omission-registry.md, Refs #57).
 *
 * `docs/omitted-endpoints.json` listet Dockhand-Endpunkte, die WIR bewusst NIE als
 * MCP-Tool aufnehmen (z.B. das in #171 entfernte `POST /api/git/stacks/{id}/env-files`,
 * oder `POST /api/self-update` — gefährlich über MCP). Das ist etwas ANDERES als eine
 * echte Lücke: die Backup-API (`/api/backup/*`, #202, 30 fehlende Tools) ist geplant,
 * nur noch nicht implementiert -- sie gehört NIE in diese Registry, sonst würde
 * `MISSING_TOOL` sie fälschlich unterdrücken.
 *
 * `partitionMissingTools()` ist die reine Trenn-Funktion: sie bekommt die rohen
 * MISSING_TOOL-Funde von `computeValidation()` (scripts/validate-mcp-tools.mjs) und die
 * geladene Registry, und liefert zwei Eimer zurück -- `realGaps` (bleibt MISSING_TOOL,
 * feuert wie bisher) und `deliberatelyOmitted` (wird sichtbar in `docs/coverage.md`
 * unter "Deliberately omitted", aber nicht mehr als Lücke gemeldet).
 *
 * WARUM ein eigenes, dupliziertes normalizePath() statt Import aus
 * validate-mcp-tools.mjs: validate-mcp-tools.mjs importiert seinerseits
 * partitionMissingTools() aus diesem Modul (für die MISSING_TOOL-Berechnung in
 * computeValidation()) -- ein Re-Import von dort würde einen ES-Modul-Zirkelbezug
 * erzeugen. Die Normalisierung selbst ist eine reine, zustandslose Ein-Zeilen-Regel
 * (Platzhalter `{name}` -> `{*}`, identisch zu normalizePath() dort), die Duplizierung
 * ist risikofrei und macht dieses Modul unabhängig importierbar/testbar.
 */

/**
 * Normalisiert einen API-Pfad für den Vergleich: ersetzt jeden `{name}`-Platzhalter
 * durch den generischen Platzhalter `{*}`, damit unterschiedliche Parameter-Namen
 * (Schema `{id}` vs. Tool-Aufruf `{stackId}`) denselben Match ergeben -- exakt dieselbe
 * Regel wie `normalizePath()` in scripts/validate-mcp-tools.mjs (siehe Datei-Kopf-Kommentar
 * für das WARUM der Duplizierung statt Import).
 * @param {string} path
 * @returns {string}
 */
function normalizePath(path) {
  return path.replace(/\{[^}]+\}/g, '{*}');
}

/**
 * Baut den Lookup-Key aus HTTP-Methode + normalisiertem Pfad.
 * @param {string} method
 * @param {string} path
 * @returns {string}
 */
function registryKey(method, path) {
  return `${method.toUpperCase()} ${normalizePath(path)}`;
}

/**
 * Baut einen `registryKey() -> Registry-Eintrag`-Lookup aus der geladenen Registry
 * (Array aus `docs/omitted-endpoints.json`).
 * @param {Array<{method: string, path: string, reason: string, adr?: string, date?: string}>} registry
 * @returns {Map<string, object>}
 */
function buildRegistryIndex(registry) {
  const index = new Map();
  for (const entry of registry ?? []) {
    index.set(registryKey(entry.method, entry.path), entry);
  }
  return index;
}

/**
 * Trennt die rohen MISSING_TOOL-Funde in `realGaps` (kein Registry-Eintrag -- bleibt
 * eine echte Lücke, z.B. die Backup-API #202) und `deliberatelyOmitted` (Registry-Treffer
 * -- bewusste Auslassung, mit `reason`/`adr` aus dem Registry-Eintrag angereichert, damit
 * `docs/coverage.md` sie SICHTBAR unter "Deliberately omitted" auflisten kann statt sie
 * kommentarlos verschwinden zu lassen).
 *
 * Reine Funktion, kein I/O -- `missingToolEntries` und `registry` sind beide
 * caller-supplied (siehe `scripts/validate-mcp-tools.mjs` für das Laden von
 * `docs/omitted-endpoints.json` und die Verdrahtung in `computeValidation()`).
 * @param {Array<{method: string, path: string, [key: string]: any}>} missingToolEntries
 *   Rückgabeform von `computeValidation()`s bisherigem `missingTool`-Bucket -- Achtung,
 *   DORT heißt das Feld `method`, nicht `httpMethod` (siehe dessen `missingTool.push({
 *   path: ep.path, method, pathParams: ep.pathParams })`).
 * @param {Array<{method: string, path: string, reason: string, adr?: string, date?: string}>} registry
 *   Rückgabe von `docs/omitted-endpoints.json` (bzw. `[]`, wenn die Datei fehlt).
 * @returns {{ realGaps: Array, deliberatelyOmitted: Array }}
 */
function partitionMissingTools(missingToolEntries, registry) {
  const registryIndex = buildRegistryIndex(registry);

  const realGaps = [];
  const deliberatelyOmitted = [];

  for (const finding of missingToolEntries ?? []) {
    const registryEntry = registryIndex.get(registryKey(finding.method, finding.path));
    if (registryEntry) {
      deliberatelyOmitted.push({
        ...finding,
        reason: registryEntry.reason,
        adr: registryEntry.adr,
      });
    } else {
      realGaps.push(finding);
    }
  }

  return { realGaps, deliberatelyOmitted };
}

export { normalizePath, registryKey, buildRegistryIndex, partitionMissingTools };
