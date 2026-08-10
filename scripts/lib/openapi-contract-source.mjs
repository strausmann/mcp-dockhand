/**
 * OpenApiContractSource
 *
 * Liest Request-Body-Contracts (welche Felder ein Endpunkt kennt, welche davon required
 * sind) aus der generierten `docs/dockhand-openapi.json` (siehe scripts/fetch-openapi.mjs
 * -- die Body-Contract-Quelle: eine aus JSDoc-Annotationen im strausmann/dockhand-Branch
 * `feat/openapi-refresh` gebaute OpenAPI-3-Spec).
 *
 * Bewusst KEIN Static-Body-Parser (siehe Design-Entscheidung in
 * docs/superpowers/specs/2026-08-10-mcp-dockhand-body-contract-validation-design.md,
 * Abschnitt "Entscheidung"): required/optional und Feld-Typen kommen ausschließlich aus
 * den handgeschriebenen `@openapi`-JSDoc-Blöcken, nicht aus einer eigenen Heuristik auf
 * den Dockhand-Handler-Quelltexten.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const SPEC_FILE = join(PROJECT_ROOT, 'docs', 'dockhand-openapi.json');

let cachedSpec = null;

/**
 * Lädt die generierte openapi.json von der Platte (gecached -- die Datei ändert sich
 * innerhalb eines Prozesslaufs nicht).
 * @returns {object}
 */
function loadOpenApiSpec() {
  if (cachedSpec) return cachedSpec;

  if (!existsSync(SPEC_FILE)) {
    throw new Error(
      `[openapi-contract-source] ${SPEC_FILE} nicht gefunden. Bitte zuerst ` +
        '`node scripts/fetch-openapi.mjs` ausführen.'
    );
  }

  cachedSpec = JSON.parse(readFileSync(SPEC_FILE, 'utf8'));
  return cachedSpec;
}

/**
 * Löst ein `$ref` (z.B. `#/components/schemas/Foo`) gegen die Spec auf. Gibt das Schema
 * unverändert zurück, wenn es kein `$ref` ist. Nur lokale `#/...`-Refs innerhalb
 * derselben Spec werden unterstützt (das ist alles, was Dockhands Generator erzeugt).
 * @param {object} spec Die vollständige OpenAPI-Spec
 * @param {object} schema Ein Schema-Objekt, ggf. mit `$ref`
 * @returns {object} Das aufgelöste Schema (niemals selbst wieder ein `$ref`)
 */
function resolveSchemaRef(spec, schema) {
  if (!schema || typeof schema !== 'object' || typeof schema['$ref'] !== 'string') {
    return schema;
  }

  const ref = schema['$ref'];
  if (!ref.startsWith('#/')) {
    throw new Error(`[openapi-contract-source] Nicht unterstützter $ref (kein lokaler Anker): ${ref}`);
  }

  const segments = ref.slice(2).split('/');
  let resolved = spec;
  for (const segment of segments) {
    resolved = resolved?.[segment];
  }

  if (!resolved) {
    throw new Error(`[openapi-contract-source] $ref konnte nicht aufgelöst werden: ${ref}`);
  }

  // Ein aufgelöstes Schema kann theoretisch selbst wieder ein $ref sein -- rekursiv auflösen.
  return resolveSchemaRef(spec, resolved);
}

/**
 * Liefert den Request-Body-Contract eines Endpunkts.
 * @param {string} method HTTP-Methode, z.B. 'POST' (case-insensitiv)
 * @param {string} path OpenAPI-Pfad, z.B. '/api/stacks/{name}'
 * @param {{ spec?: object }} [options] `spec` überschreibt die von der Platte geladene
 *   Spec -- nur für Tests gedacht (Fixture-Spec statt der echten Datei). Ohne diese
 *   Option wird `docs/dockhand-openapi.json` geladen.
 * @returns {{ hasSchema: boolean, requiredFields: string[], knownFields: string[] }}
 */
function getBodyContract(method, path, options = {}) {
  const spec = options.spec ?? loadOpenApiSpec();

  const operation = spec.paths?.[path]?.[method.toLowerCase()];
  const rawSchema = operation?.requestBody?.content?.['application/json']?.schema;

  if (!rawSchema) {
    return { hasSchema: false, requiredFields: [], knownFields: [] };
  }

  const schema = resolveSchemaRef(spec, rawSchema);

  return {
    hasSchema: true,
    requiredFields: schema.required ?? [],
    knownFields: Object.keys(schema.properties ?? {}),
  };
}

/**
 * Liefert die Namen der Query-/Path-Parameter eines Endpunkts (der OpenAPI
 * `parameters`-Abschnitt der Operation) -- Task P1.4 braucht diese Liste, um
 * Query-/Path-Felder (z.B. `environmentId`, `containerId`), die unsere MCP-Tools über
 * dasselbe Zod-Shape-Objekt wie die Body-Felder senden, von der BODY_PARAM_UNKNOWN-Prüfung
 * auszunehmen -- sie sind nie Teil des `requestBody`-Schemas, tauchen aber trotzdem in
 * `getToolBodyShape()`s `sentFields` auf, weil das Zod-Schema Body- und
 * Query-/Path-Parameter nicht unterscheidet.
 * @param {string} method HTTP-Methode, z.B. 'POST' (case-insensitiv)
 * @param {string} path OpenAPI-Pfad, z.B. '/api/containers/{id}/rename'
 * @param {{ spec?: object }} [options] siehe getBodyContract()
 * @returns {string[]} Namen aller `in: "path"`/`in: "query"`-Parameter der Operation,
 *   oder ein leeres Array, wenn der Endpunkt nicht existiert oder keine Parameter hat.
 */
function getOperationParamNames(method, path, options = {}) {
  const spec = options.spec ?? loadOpenApiSpec();

  const operation = spec.paths?.[path]?.[method.toLowerCase()];
  const parameters = operation?.parameters ?? [];

  return parameters
    .filter((p) => p?.in === 'path' || p?.in === 'query')
    .map((p) => p.name);
}

export { getBodyContract, getOperationParamNames, loadOpenApiSpec, resolveSchemaRef, SPEC_FILE };
