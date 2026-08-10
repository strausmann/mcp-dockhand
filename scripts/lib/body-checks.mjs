/**
 * Body-Contract-Checks (advisory, Task P1.4).
 *
 * Korreliert die Soll-Seite (OpenApiContractSource.getBodyContract() -- welche Felder ein
 * Endpunkt kennt und welche davon required sind) mit der Ist-Seite (tool-body-shape.mjs
 * getToolBodyShape() -- welche Felder unser MCP-Tool tatsächlich sendet) und meldet vier
 * Finding-Typen. Bewusst advisory: computeBodyFindings() liefert nur eine Liste, sie
 * beeinflusst KEINEN Exit-Code -- das bleibt Sache des Aufrufers (validate-mcp-tools.mjs
 * computeValidation()), der die Ergebnisse in einen eigenen, nicht-fehler-auslösenden
 * Report-Bucket einsortiert (siehe dortige `bodyFindings`).
 *
 * `opParams` ist die dritte, notwendige Eingabe: getToolBodyShape() liefert die GESAMTE
 * Tool-Eingabe inkl. Query-/Path-Parametern (z.B. `environmentId`, `containerId`) -- die
 * gehören nicht in den Body und dürfen deshalb NIE als BODY_PARAM_UNKNOWN auffallen. Ohne
 * diesen Ausschluss würde praktisch jedes Tool sofort einen Fehlalarm produzieren, weil
 * `environmentId`/`containerId` nie Teil des OpenAPI-Body-Schemas sind (sie stehen im
 * `parameters`-Abschnitt der Operation, nicht im `requestBody`).
 */

/**
 * @typedef {{ hasSchema: boolean, requiredFields: string[], knownFields: string[] }} BodyContract
 *   Rückgabeform von getBodyContract() (openapi-contract-source.mjs).
 * @typedef {{ sentFields: string[], requiredSent: string[], passthrough: boolean }} ToolBodyShape
 *   Rückgabeform von computeBodyShape()/getToolBodyShape() (tool-body-shape.mjs).
 * @typedef {{ type: string, field?: string, expectedRequired?: string[] }} BodyFinding
 */

/**
 * FP_COMPUTED_BODY-Whitelist (Task P2.1 Fix 2, `tool:field`-Keys).
 *
 * Diese Tools sind NICHT `z.record(...)`-Ganzkörper-Passthrough (das behandelt Fix 1 unten
 * strukturell/self-maintaining) -- ihr Zod-Input-Shape ist vollständig getypt, aber der
 * TATSÄCHLICH gesendete Wire-Body weicht davon ab, weil der Callback ein Feld umbenennt,
 * hartcodiert oder aus anderen Eingabefeldern berechnet, BEVOR er sendet. Der Collector
 * (tool-body-shape.mjs) sieht ausschließlich das deklarierte Zod-Input-Schema, nie den
 * tatsächlich konstruierten Request-Body -- diese Fälle sind daher statisch NICHT
 * erkennbar und brauchen eine echte, einzeln verifizierte Ausnahme statt einer
 * strukturellen Regel. Jeder Eintrag ist gegen den echten Tool-Callback UND den echten
 * OpenAPI-Contract verifiziert (siehe tests/body-checks-whitelist-anti-orphan.test.ts).
 *
 * Name bewusst "…PASSTHROUGH" (konsistent mit `WHITELISTED_QUERY_PARAMS` in
 * validate-mcp-tools.mjs), obwohl es hier nicht um z.record(...)-Passthrough geht, sondern
 * um einen im Callback abweichend konstruierten Body -- die Kategorie heißt im P2.1-Plan
 * FP_COMPUTED_BODY.
 */
const WHITELISTED_BODY_PASSTHROUGH = new Set([
  // system.ts:138 -- Callback sendet { key: licenseKey }; Zod-Feld heißt `licenseKey`, der
  // Contract kennt nur `key`. Reine Umbenennung, kein fehlendes Feld.
  'activate_license:key',
  // labels.ts:25 -- Callback sendet immer { action: 'add', label, environmentIds };
  // `action` ist im Zod-Shape gar nicht deklariert, weil add_label EINE feste Aktion ist.
  'add_label:action',
  // stacks.ts:467 -- Callback baut `stacks: [{ name, composePath, ... }]` aus den
  // Einzelfeldern `name`/`composePath`/`envPath`/`sourceDir`; das Zod-Shape kennt kein
  // eigenes `stacks`-Feld.
  'adopt_stack:stacks',
  // stacks.ts:390 -- Callback berechnet einen Diff (verbleibende DB-Variablen nach Entfernen
  // der Ziel-Keys) und sendet das Ergebnis als `variables`; das Zod-Shape kennt nur `keys`
  // (die zu entfernenden Namen), nie den fertig berechneten Rest-Zustand.
  'remove_stack_env_vars:variables',
  // stacks.ts:398 -- derselbe Diff-Mechanismus für die .env-Datei, gesendet als `content`
  // (neu zusammengesetzter Dateiinhalt); ebenfalls nicht im Zod-Shape (nur `keys`).
  'remove_stack_env_vars:content',
  // users.ts:214 -- Callback sendet immer { environmentId, action: 'reorder', groups };
  // `action` ist im Zod-Shape (`environmentId`, `groups`) nicht deklariert, weil
  // set_favorite_groups den Voll-Replace-Pfad IMMER mit `action:"reorder"` fährt (siehe
  // dockhand-mcp-dev-Skill, Abschnitt "favorites/favorite-groups action-Enum").
  'set_favorite_groups:action',
  // users.ts:193 -- derselbe Mechanismus für set_favorites: { environmentId, action:
  // 'reorder', favorites }; `action` ist im Zod-Shape (`environmentId`, `favorites`) nicht
  // deklariert.
  'set_favorites:action',
]);

/**
 * Berechnet die Body-Contract-Findings für EINEN Endpunkt/Tool-Paar.
 *
 * Reihenfolge/Kurzschluss bewusst gewählt:
 *   - Ohne Schema (`hasSchema:false`) gibt es keine verlässliche Soll-Seite -- alle
 *     weiteren Vergleiche (missing/unknown) würden nur Rauschen erzeugen (jedes gesendete
 *     Feld wäre trivial "unknown" gegen eine leere knownFields-Liste). Deshalb NUR
 *     BODY_CONTRACT_UNRESOLVED und sofortiger Rückgabe.
 *   - BODY_PARAM_MISSING_REQUIRED und BODY_PARAM_UNKNOWN werden BEIDE bei
 *     `passthrough:true` komplett übersprungen (Task P2.1 Fix 1, Collector-Bug-Korrektur):
 *     computeBodyShape() liefert keine Information darüber, WELCHE Feldnamen innerhalb
 *     eines `z.record(...)`-Ganzkörper-Bodys tatsächlich auf die Leitung gehen -- weder für
 *     den Unknown- noch für den Required-Vergleich. Vor diesem Fix wurde
 *     `missingRequired` VOR der passthrough-Weiche berechnet und dadurch bei jedem
 *     Ganzkörper-Passthrough-Tool (z.B. `create_oidc_provider`, `{ config:
 *     z.record(...) }`) JEDES contract-required Feld fälschlich als "fehlt" gemeldet --
 *     der Collector sieht die verschachtelten Feldnamen innerhalb des Records schlicht
 *     nicht, unabhängig davon, ob sie zur Laufzeit tatsächlich gesendet werden (P2.1-Sweep:
 *     22 von 38 BODY_PARAM_MISSING_REQUIRED-Funden waren genau dieser strukturelle
 *     Fehlalarm). Stattdessen macht UNTYPED_PASSTHROUGH sichtbar, dass dieses Tool statisch
 *     nicht vollständig prüfbar ist -- ergänzt um `expectedRequired`, damit der Report
 *     weiterhin zeigt, WELCHE Felder beim manuellen Gegenlesen zu prüfen sind, ohne die
 *     Fehlalarme zurückzubringen.
 *   - `WHITELISTED_BODY_PASSTHROUGH` (Task P2.1 Fix 2, FP_COMPUTED_BODY) greift NUR im
 *     Nicht-Passthrough-Zweig, auf einzelne `tool:field`-Paare -- diese Tools sind
 *     vollständig getypt (kein `z.record`), aber ihr Callback verändert den Body vor dem
 *     Senden (Umbenennung/Hardcoding/Berechnung), was der Collector strukturell nicht
 *     sehen kann. Siehe die Set-Definition oben für den Beleg je Eintrag.
 *
 * @param {BodyContract} contract
 * @param {ToolBodyShape} toolShape
 * @param {string[]} [opParams] Namen der Query-/Path-Parameter dieser Operation (aus dem
 *   OpenAPI `parameters`-Abschnitt, siehe getOperationParamNames()) -- werden von der
 *   BODY_PARAM_UNKNOWN-Prüfung ausgenommen.
 * @param {string} [toolName] Name des MCP-Tools (z.B. `call.toolName` in
 *   validate-mcp-tools.mjs) -- nötig, um `WHITELISTED_BODY_PASSTHROUGH`-Einträge korrekt
 *   als `tool:field` zu matchen. Ohne Angabe (Default `''`) matcht kein Whitelist-Eintrag
 *   (kein Key beginnt mit `:`), das Verhalten ist damit rückwärtskompatibel zu Aufrufern,
 *   die noch keinen Tool-Namen mitgeben.
 * @returns {BodyFinding[]}
 */
function computeBodyFindings(contract, toolShape, opParams = [], toolName = '') {
  if (!contract.hasSchema) {
    return [{ type: 'BODY_CONTRACT_UNRESOLVED' }];
  }

  const findings = [];

  if (toolShape.passthrough) {
    const finding = { type: 'UNTYPED_PASSTHROUGH' };
    if (contract.requiredFields.length > 0) {
      finding.expectedRequired = contract.requiredFields;
    }
    findings.push(finding);
    return findings;
  }

  const missingRequired = contract.requiredFields.filter(
    (field) =>
      !toolShape.requiredSent.includes(field) &&
      !WHITELISTED_BODY_PASSTHROUGH.has(`${toolName}:${field}`)
  );
  for (const field of missingRequired) {
    findings.push({ type: 'BODY_PARAM_MISSING_REQUIRED', field });
  }

  const known = new Set(contract.knownFields);
  const params = new Set(opParams);
  const unknown = toolShape.sentFields.filter(
    (field) => !known.has(field) && !params.has(field)
  );
  for (const field of unknown) {
    findings.push({ type: 'BODY_PARAM_UNKNOWN', field });
  }

  return findings;
}

export { computeBodyFindings, WHITELISTED_BODY_PASSTHROUGH };
