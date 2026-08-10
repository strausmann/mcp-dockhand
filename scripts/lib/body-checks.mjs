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
 * @typedef {{ type: string, field?: string }} BodyFinding
 */

/**
 * Berechnet die Body-Contract-Findings für EINEN Endpunkt/Tool-Paar.
 *
 * Reihenfolge/Kurzschluss bewusst gewählt:
 *   - Ohne Schema (`hasSchema:false`) gibt es keine verlässliche Soll-Seite -- alle
 *     weiteren Vergleiche (missing/unknown) würden nur Rauschen erzeugen (jedes gesendete
 *     Feld wäre trivial "unknown" gegen eine leere knownFields-Liste). Deshalb NUR
 *     BODY_CONTRACT_UNRESOLVED und sofortiger Rückgabe.
 *   - BODY_PARAM_UNKNOWN wird bei `passthrough:true` komplett übersprungen (nicht nur für
 *     das Passthrough-Feld selbst): computeBodyShape() liefert keine Information darüber,
 *     WELCHES sentFields-Element der Record-Typ ist, und der Feld-NAME eines
 *     Passthrough-Containers (z.B. `settings`) hat ohnehin keine Entsprechung unter den
 *     echten API-Property-Namen -- ein Per-Feld-Vergleich würde bei jedem
 *     Passthrough-Tool einen garantierten Fehlalarm auf den Container-Feldnamen selbst
 *     erzeugen. Stattdessen macht UNTYPED_PASSTHROUGH sichtbar, dass dieses Tool
 *     statisch nicht vollständig prüfbar ist.
 *
 * @param {BodyContract} contract
 * @param {ToolBodyShape} toolShape
 * @param {string[]} [opParams] Namen der Query-/Path-Parameter dieser Operation (aus dem
 *   OpenAPI `parameters`-Abschnitt, siehe getOperationParamNames()) -- werden von der
 *   BODY_PARAM_UNKNOWN-Prüfung ausgenommen.
 * @returns {BodyFinding[]}
 */
function computeBodyFindings(contract, toolShape, opParams = []) {
  if (!contract.hasSchema) {
    return [{ type: 'BODY_CONTRACT_UNRESOLVED' }];
  }

  const findings = [];

  const missingRequired = contract.requiredFields.filter(
    (field) => !toolShape.requiredSent.includes(field)
  );
  for (const field of missingRequired) {
    findings.push({ type: 'BODY_PARAM_MISSING_REQUIRED', field });
  }

  if (toolShape.passthrough) {
    findings.push({ type: 'UNTYPED_PASSTHROUGH' });
  } else {
    const known = new Set(contract.knownFields);
    const params = new Set(opParams);
    const unknown = toolShape.sentFields.filter(
      (field) => !known.has(field) && !params.has(field)
    );
    for (const field of unknown) {
      findings.push({ type: 'BODY_PARAM_UNKNOWN', field });
    }
  }

  return findings;
}

export { computeBodyFindings };
