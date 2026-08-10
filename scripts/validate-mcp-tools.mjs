#!/usr/bin/env node

/**
 * MCP Tool Validator
 *
 * Vergleicht die MCP-Tool-Definitionen in src/tools/*.ts mit dem
 * generierten API-Schema in docs/dockhand-api-schema.json.
 *
 * Prüft:
 * - COVERED: Endpunkt hat ein MCP-Tool
 * - MISSING_TOOL: Endpunkt existiert in API aber kein MCP-Tool
 * - ORPHANED_TOOL: MCP-Tool referenziert Endpunkt der nicht (mehr) existiert
 * - PARAM_MISMATCH: Path-Parameter stimmen nicht überein (Anzahl + Namens-Suffix)
 * - MISSING_ENCODE: Path-Parameter wird nicht mit encodePath() encoded
 * - QUERY_PARAM_MISSING_REQUIRED: der Endpunkt 400ed ohne diesen Query-Parameter
 *   (per-Methode required/optional aus dem Schema, siehe docs/dockhand-api-schema.json
 *   `queryParamsByMethod`), das Tool sendet ihn nicht
 * - QUERY_PARAM_UNKNOWN: Tool sendet einen Query-Parameter, den der Endpunkt nicht kennt
 *
 * Required vs. optional kommt aus dem Schema (von extract-dockhand-api.mjs anhand des
 * echten `if (!x) { ... status: 4xx ... }`-Guards im Handler klassifiziert) — es gibt
 * KEINEN manuellen Re-Check mehr. Ein fehlender REQUIRED Query-Param ist ein harter
 * Fehler (Exit 1); ein fehlender optionaler Query-Param wird gar nicht mehr gemeldet
 * (der frühere "QUERY_PARAM_MISSING (informativ)"-Eimer, der jeden fehlenden Query-Param
 * unabhängig von required/optional nur als Warnung auflistete, entfällt vollständig).
 *
 * Exit-Code 1 bei Mismatches (ORPHANED_TOOL, PARAM_MISMATCH, MISSING_ENCODE,
 * QUERY_PARAM_UNKNOWN oder QUERY_PARAM_MISSING_REQUIRED)
 * Exit-Code 0 wenn nur MISSING_TOOL (neue Endpunkte ohne Tool sind normal)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findMatchingClose, splitTopLevel, extractObjectKey } from './lib/js-scan.mjs';
import { resolveQueryParamKeys } from './lib/query-params.mjs';
import { getBodyContract, getOperationParamNames, loadOpenApiSpec } from './lib/openapi-contract-source.mjs';
import { computeBodyFindings } from './lib/body-checks.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const SCHEMA_FILE = join(PROJECT_ROOT, 'docs', 'dockhand-api-schema.json');
const TOOLS_DIR = join(PROJECT_ROOT, 'src', 'tools');
const REPORT_FILE = join(PROJECT_ROOT, 'validation-report.md');
const COLLECT_SHAPES_SCRIPT = join(__dirname, 'collect-tool-shapes.mjs');

/**
 * HTTP-Methoden, für die die Body-Contract-Checks (Task P1.4) überhaupt sinnvoll sind --
 * GET/DELETE-Aufrufe unserer Tools tragen (bis auf seltene Ausnahmen, die hier bewusst
 * nicht mitgeprüft werden) keinen JSON-Request-Body, ihr Zod-Shape enthält nur
 * Query-/Path-Parameter. Ein Body-Check gegen sie würde nur BODY_CONTRACT_UNRESOLVED-Rauschen
 * erzeugen (kein `requestBody` im Schema, obwohl gar keiner erwartet wird).
 */
const BODY_CARRYING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// HTTP-Methoden-Mapping: client.method → HTTP-Methode
const CLIENT_METHOD_MAP = {
  get: 'GET',
  getRaw: 'GET',
  post: 'POST',
  postSSE: 'POST',
  postMultipart: 'POST',
  put: 'PUT',
  putSSE: 'PUT',
  delete: 'DELETE',
  patch: 'PATCH',
};

// DockhandClient-Methoden bei denen der Query-Params-Record das 2. Argument ist:
// get(path, params?), getRaw(path, params?), delete(path, params?)
const GET_LIKE_METHODS = new Set(['get', 'getRaw', 'delete']);

// DockhandClient-Methoden bei denen der Query-Params-Record das 3. Argument ist
// (nach dem Body): post(path, body?, params?), put(path, body?, params?), ...
const BODY_LIKE_METHODS = new Set(['post', 'postSSE', 'postMultipart', 'put', 'putSSE', 'patch']);

/**
 * `env` ist der universelle Environment-Scoping-Query-Param, den fast jeder Tool-Call
 * mitschickt. extract-dockhand-api.mjs filtert ihn beim Schema-Bau bewusst heraus
 * (`if (!['env'].includes(param))`), taucht also NIE in ep.queryParams auf — er darf
 * deshalb nie als QUERY_PARAM_UNKNOWN markiert werden. `envId` und alle anderen
 * Query-Params werden normal geprüft (siehe Issue #95 / #81: dort erwartete das Schema
 * `envId`, das Tool sendete nur `env` — envId fehlte tatsächlich).
 */
const WHITELISTED_QUERY_PARAMS = new Set(['env']);

/**
 * Lädt das API-Schema
 * @returns {object}
 */
function loadSchema() {
  if (!existsSync(SCHEMA_FILE)) {
    console.error(`[validate] Schema-Datei nicht gefunden: ${SCHEMA_FILE}`);
    console.error('[validate] Bitte zuerst extract-dockhand-api.mjs ausführen');
    process.exit(2);
  }
  return JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'));
}

// --- Query-Param-Key-Extraktion für Aufruf-Argumente ---
//
// Die MCP-Tools rufen `client.<method>(path, body?, params?)` teils einzeilig, teils
// über mehrere Zeilen auf (siehe z.B. containers.ts get_container_logs), und der
// `params`-Ausdruck ist manchmal ein Objekt-Literal, manchmal ein Ternary
// (`cond ? {...} : undefined`, siehe get_registry_catalog). Der komplette
// Argument-Ausdruck muss deshalb geparst werden — nicht nur die eine Zeile mit dem
// Funktionsnamen. `findMatchingClose`/`splitTopLevel`/`extractObjectKey` kommen aus
// `lib/js-scan.mjs` (gemeinsam mit extract-dockhand-api.mjs genutzt), die eigentliche
// Objekt-/Ternary-Auflösung aus `lib/query-params.mjs`.

/**
 * Extrahiert die statisch bestimmbaren Query-Param-Keys eines `client.<method>(...)`
 * Aufrufs.
 * @param {string} content Gesamter Datei-Inhalt
 * @param {number} openParenIndex Index der öffnenden Klammer des Aufrufs
 * @param {string} clientMethod z.B. 'get', 'post', ...
 * @returns {string[]|null} Keys, oder `null` wenn nicht statisch analysierbar
 *   (z.B. Params als Variable übergeben statt als Objekt-Literal)
 */
function extractCallQueryParamKeys(content, openParenIndex, clientMethod) {
  let paramsIdx;
  if (GET_LIKE_METHODS.has(clientMethod)) {
    paramsIdx = 1;
  } else if (BODY_LIKE_METHODS.has(clientMethod)) {
    paramsIdx = 2;
  } else {
    return null;
  }

  const closeParenIndex = findMatchingClose(content, openParenIndex);
  if (closeParenIndex === -1) return null;

  const argsText = content.slice(openParenIndex + 1, closeParenIndex);
  const args = splitTopLevel(argsText);
  const paramsArgText = args[paramsIdx];

  // Kein Params-Argument im Aufruf (z.B. `client.delete('/api/settings/scanner')`) heißt
  // definitiv "sendet keine Query-Params" — kein Auflösungsproblem, sondern ein
  // eindeutiger Fakt. Das MUSS geprüft werden, nicht übersprungen werden: genau dieses
  // Muster ist real ein Bug (`reset_scanner_settings` ruft `client.delete(path)` ganz
  // ohne Params auf, der Handler verlangt aber `removeImages=true` — 400 garantiert).
  if (paramsArgText === undefined) return [];

  return resolveQueryParamKeys(paramsArgText);
}

/**
 * Extrahiert alle API-Aufrufe aus dem Inhalt EINER Tool-Datei.
 * @param {string} file Dateiname (nur für Reporting)
 * @param {string} content Datei-Inhalt
 * @returns {Array<{file: string, toolName: string, httpMethod: string, path: string, usesEncode: boolean, hasPathParams: boolean, queryParamKeys: string[]|null, line: number}>}
 */
function extractToolCallsFromSource(file, content) {
  const calls = [];
  const lines = content.split('\n');

  // Zeilen-Start-Offsets für die Umrechnung Zeile+Spalte → absoluter Index in `content`.
  const lineOffsets = [];
  {
    let offset = 0;
    for (const l of lines) {
      lineOffsets.push(offset);
      offset += l.length + 1; // +1 für das durch split('\n') entfernte '\n'
    }
  }

  let currentTool = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Erkenne Tool-Registrierungen
    const toolMatch = line.match(/registerTool\s*\(\s*server\s*,\s*['"]([^'"]+)['"]/);
    if (toolMatch) {
      currentTool = toolMatch[1];
    }

    // Erkenne API-Aufrufe: client.get('/api/...'), client.post(`/api/...`)
    const callMatch = line.match(
      /client\.(\w+)\s*\(\s*[`'"]([^`'"]*(?:\$\{[^}]+\}[^`'"]*)*)[`'"]/
    );
    if (callMatch && currentTool) {
      const [, clientMethod, rawPath] = callMatch;
      const httpMethod = CLIENT_METHOD_MAP[clientMethod];

      if (!httpMethod) continue; // Kein bekannter HTTP-Method-Aufruf

      // Konvertiere Template-Literale zu Schema-Pfad-Format
      // `/api/containers/${encodePath(id)}` → `/api/containers/{id}`
      let normalizedPath = rawPath
        .replace(/\$\{encodePath\((\w+)\)\}/g, '{$1}')
        .replace(/\$\{(\w+)\}/g, '{$1}');

      // Fix #30 (HIGH): Per-interpolation encodePath check (PR #25).
      // Each ${...} interpolation must use encodePath, not just any occurrence in the string.
      const interpolations = [...rawPath.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
      const hasPathParams = normalizedPath.includes('{');
      const usesEncode = hasPathParams
        ? interpolations.every((expr) => expr.includes('encodePath'))
        : true;

      // Query-Param-Keys: der komplette Aufruf kann über mehrere Zeilen gehen
      // (z.B. containers.ts get_container_logs), deshalb ab hier im Volltext weiterscannen.
      const absoluteMatchStart = lineOffsets[i] + callMatch.index;
      const openParenIndex = content.indexOf('(', absoluteMatchStart);
      const queryParamKeys =
        openParenIndex === -1 ? null : extractCallQueryParamKeys(content, openParenIndex, clientMethod);

      calls.push({
        file,
        toolName: currentTool,
        httpMethod,
        path: normalizedPath,
        usesEncode,
        hasPathParams,
        queryParamKeys,
        line: i + 1,
      });
    }
  }

  return calls;
}

/**
 * Extrahiert alle API-Aufrufe aus den MCP-Tool-Dateien
 * @returns {Array<{file: string, toolName: string, httpMethod: string, path: string, usesEncode: boolean, queryParamKeys: string[]|null, line: number}>}
 */
function extractToolCalls() {
  const calls = [];
  const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

  for (const file of files) {
    const filePath = join(TOOLS_DIR, file);
    const content = readFileSync(filePath, 'utf8');
    calls.push(...extractToolCallsFromSource(file, content));
  }

  return calls;
}

/**
 * Normalisiert einen API-Pfad für den Vergleich
 * Entfernt Variablennamen aus {param} und ersetzt durch generische Platzhalter
 * @param {string} path
 * @returns {string}
 */
function normalizePath(path) {
  return path.replace(/\{[^}]+\}/g, '{*}');
}

/**
 * Erstellt einen Lookup-Key aus Pfad + Methode
 * @param {string} path
 * @param {string} method
 * @returns {string}
 */
function endpointKey(path, method) {
  return `${method} ${normalizePath(path)}`;
}

/**
 * Vergleicht die Path-Parameter eines Tool-Aufrufs mit denen des Schema-Endpunkts.
 *
 * Nicht einfach String-Gleichheit: das Schema nutzt die generischen SvelteKit
 * Routen-Namen (z.B. `id`, `type`), die Tools verwenden bewusst sprechende
 * Variablennamen (z.B. `containerId`, `providerId`). Verifiziert gegen den echten
 * Bestand (Issue #95, 2026-08): von 141 Path-Param-Vergleichen matchen nur 20 exakt
 * als String — reine Namens-Identität wäre für dieses Repo also ein Dauer-Fehlalarm.
 * Stattdessen: gleiche Anzahl UND pro Position ist der Schema-Name (case-insensitiv)
 * ein Suffix des Tool-Variablennamens (`id` ⊂ `containerId`, `type` ⊂ `type`,
 * `notificationId` ⊂ `notificationId`) — das deckt alle 141 realen Fälle ab, ohne
 * echte Namensabweichungen (z.B. eine komplett falsche Variable an einer Position)
 * durchzulassen.
 * @param {string[]} callParams
 * @param {string[]} schemaParams
 * @returns {boolean} true wenn die Parameter als übereinstimmend gelten
 */
function pathParamsMatch(callParams, schemaParams) {
  if (callParams.length !== schemaParams.length) return false;
  for (let i = 0; i < callParams.length; i++) {
    const call = callParams[i].toLowerCase();
    const schema = schemaParams[i].toLowerCase();
    if (call !== schema && !call.endsWith(schema)) return false;
  }
  return true;
}

/**
 * Diffed die von einem Tool-Aufruf gesendeten Query-Param-Keys gegen die vom Schema
 * für den Endpunkt PRO METHODE bekannten Query-Params (inkl. required/optional).
 *
 * Required-vs-optional ersetzt den früheren manuellen Re-Check vollständig: ein
 * fehlender REQUIRED Param ist immer ein Bug (der Endpunkt 400ed nachweislich ohne ihn,
 * siehe route-handlers.mjs), ein fehlender optionaler Param wird gar nicht mehr
 * gemeldet — er war nie ein verlässliches Signal.
 * @param {string[]} sentKeys Roh extrahierte Keys (inkl. ggf. whitelisteter wie `env`)
 * @param {Array<{name: string, required: boolean}>|undefined} schemaParams
 *   `ep.queryParamsByMethod[method]`
 * @param {{ checkMissing: boolean }} options `checkMissing` bewusst weiterhin ein Flag
 *   (nicht fest `true`): Aufrufer, die den Endpunkt nicht method-genau auflösen können,
 *   sollen den Missing-Check gezielt abschalten können, ohne unknown mit abzuschalten.
 * @returns {{ missingRequired: string[], unknown: string[] }}
 */
function diffQueryParams(sentKeys, schemaParams, { checkMissing }) {
  const known = new Set((schemaParams ?? []).map((p) => p.name));
  const sent = sentKeys.filter((k) => !WHITELISTED_QUERY_PARAMS.has(k));

  const unknown = sent.filter((k) => !known.has(k));

  let missingRequired = [];
  if (checkMissing && schemaParams) {
    const sentSet = new Set(sent);
    missingRequired = schemaParams.filter((p) => p.required && !sentSet.has(p.name)).map((p) => p.name);
  }

  return { missingRequired, unknown };
}

// Endpunkte die wir bewusst ignorieren (Streams, Callbacks, interne)
const IGNORED_PATTERNS = [
  '/api/auth/login',           // Login wird nicht über MCP gemacht
  '/api/auth/oidc/callback',   // OAuth Callback
  '/stream',                   // SSE Streams (werden über postSSE abgedeckt)
  '/api/debug/',               // Debug-Endpunkte
  '/api/self-update',          // Self-Update (gefährlich über MCP)
  '/api/events',               // SSE Event-Stream
  '/api/jobs/',                // Interne Job-Verwaltung
  '/api/hawser/connect',       // Hawser Agent-Verbindung
  '/api/environments/{*}/icon',          // Icon-Upload (binary)
  '/api/environments/{*}/disk-warning',  // Disk-Warning (intern)
  '/api/profile/avatar',                 // Avatar-Upload (binary)
];

/**
 * Prüft, ob ein Pfad zu den bewusst ausgeschlossenen Endpunkten gehört (Streams,
 * Callbacks, interne Routen — siehe IGNORED_PATTERNS).
 * @param {string} path
 * @returns {boolean}
 */
function isIgnored(path) {
  const normalized = normalizePath(path);
  return IGNORED_PATTERNS.some((p) => normalized.includes(p) || normalized === normalizePath(p));
}

// --- Body-Contract-Checks (Task P1.4/P1.6, advisory) ---
//
// Die Body-Contract-Quelle (docs/dockhand-openapi.json, siehe scripts/lib/
// openapi-contract-source.mjs) indiziert Endpunkte per exaktem Pfad-String samt der
// dortigen Parameter-Namen (z.B. '/api/containers/{id}/rename'), unser eigenes
// dockhand-api-schema.json samt der Tool-Aufrufe kennt aber die SPRECHENDEN
// Variablennamen der Tools (z.B. '/api/containers/{containerId}/rename', siehe
// pathParamsMatch() oben). buildOpenApiPathIndex() überbrückt das über dieselbe
// normalizePath()-Normalisierung (alle {…} → {*}), die schon schemaEndpoints/
// toolEndpoints benutzen — kein zweiter Normalisierungs-Mechanismus.

/**
 * Baut einen Lookup von `endpointKey(normalisierter Pfad, METHODE)` auf den ECHTEN
 * OpenAPI-Pfad-String (mit den OpenAPI-eigenen Parameternamen), damit getBodyContract()/
 * getOperationParamNames() mit dem exakten Pfad aufgerufen werden können, den die Spec
 * kennt — unabhängig davon, wie unsere Tools ihre Path-Parameter benennen.
 * @returns {Map<string, string>|null} `null`, wenn docs/dockhand-openapi.json (noch) nicht
 *   existiert (z.B. lokal vor dem ersten `node scripts/fetch-openapi.mjs`) — Body-Checks
 *   werden dann komplett übersprungen, nicht mit einem Fehler abgebrochen.
 */
function buildOpenApiPathIndex() {
  let spec;
  try {
    spec = loadOpenApiSpec();
  } catch {
    return null;
  }

  const index = new Map();
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(methods)) {
      index.set(endpointKey(path, method.toUpperCase()), path);
    }
  }
  return index;
}

/**
 * Sammelt die Body-Shapes ALLER registrierten MCP-Tools, indem der eigenständige
 * `tsx`-Collector (scripts/collect-tool-shapes.mjs) als Subprozess ausgeführt wird — siehe
 * dessen Datei-Kopf-Kommentar für das WARUM (plain `node` kann `.ts`-Tool-Dateien nicht
 * importieren, `validate-mcp-tools.mjs` selbst bleibt bewusst `tsx`-frei).
 *
 * Body-Checks sind komplett advisory (Global Constraint des P1-Plans): schlägt der
 * Collector aus IRGENDEINEM Grund fehl (kein `tsx` installiert, ein Tool-File das nicht
 * importierbar ist, ...), gibt diese Funktion `null` zurück und computeValidation()
 * überspringt die Body-Checks komplett — der bestehende `node scripts/validate-mcp-tools.mjs`
 * Aufruf und sein Exit-Code bleiben davon unberührt.
 * @returns {Record<string, { sentFields: string[], requiredSent: string[], passthrough: boolean }>|null}
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
    console.error(`[validate] Body-Contract-Checks übersprungen (tsx-Collector fehlgeschlagen): ${err.message}`);
    return null;
  }
}

/**
 * Berechnet die Body-Contract-Findings für ALLE Tool-Aufrufe (Task P1.4), mit
 * Tool-/Endpunkt-Kontext für den Report angereichert.
 * @param {Array} toolCalls Rückgabe von extractToolCalls()
 * @param {Record<string, { sentFields: string[], requiredSent: string[], passthrough: boolean }>} toolBodyShapes
 * @param {Map<string, string>} openApiPathIndex Rückgabe von buildOpenApiPathIndex()
 * @returns {Array<{type: string, field?: string, toolName: string, httpMethod: string, path: string, file: string, line: number}>}
 */
/**
 * `environmentId` ist der universelle Environment-Scoping-Feldname, den praktisch jeder
 * mutierende Tool-Call für den OpenAPI Query-Param `env` mitschickt (dieselbe Konvention,
 * die `WHITELISTED_QUERY_PARAMS` oben für die Query-Diff-Prüfung nutzt) — er ist NIE
 * selbst ein Body-Feld und wird deshalb IMMER von BODY_PARAM_UNKNOWN ausgenommen,
 * unabhängig davon, wie die OpenAPI-Spec ihren eigenen `env`-Parameter benennt.
 */
const ENVIRONMENT_SCOPING_FIELD_NAMES = ['environmentId'];

/**
 * Extrahiert die Path-Parameter-NAMEN, wie unsere eigenen Tools sie nennen, direkt aus
 * `call.path` (z.B. `/api/containers/{containerId}/rename` → `['containerId']`).
 *
 * Bewusst NICHT aus `getOperationParamNames()` (der OpenAPI-Spec): die Spec kennt ihre
 * EIGENEN, oft anders lautenden Namen (SvelteKit-Routen-Konvention, z.B. `id`), unsere
 * Tools verwenden sprechendere Variablennamen (z.B. `containerId`) — exakt dasselbe
 * Namens-Mismatch, das `pathParamsMatch()` oben bereits über Suffix-Matching lösen muss,
 * dort aber für einen ANDEREN Zweck (Anzahl/Reihenfolge-Validierung). Da `call.path`s
 * `{…}`-Platzhalter denselben Bezeichner tragen wie das Zod-Shape-Feld (beides kommt aus
 * derselben TS-Quelle -- `${encodePath(containerId)}` im Template-Literal UND
 * `containerId: z.string()` im Zod-Schema verwenden dieselbe Variable), ist ein exakter
 * String-Vergleich hier ausreichend -- keine Suffix-Fuzziness nötig.
 * @param {string} path
 * @returns {string[]}
 */
function extractToolPathParamNames(path) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

function computeBodyFindingsForCalls(toolCalls, toolBodyShapes, openApiPathIndex) {
  const results = [];

  for (const call of toolCalls) {
    if (!BODY_CARRYING_HTTP_METHODS.has(call.httpMethod)) continue;
    if (isIgnored(call.path)) continue;

    const shape = toolBodyShapes[call.toolName];
    if (!shape) continue; // Tool nicht im Collector-Output (sollte nicht vorkommen)

    const realPath = openApiPathIndex.get(endpointKey(call.path, call.httpMethod));
    if (!realPath) continue; // Endpunkt (noch) nicht in der OpenAPI-Spec (P1341-Annotationsstand)

    const contract = getBodyContract(call.httpMethod, realPath);
    // Union aus: (1) unseren eigenen Path-Param-Namen (exakt, aus call.path), (2) dem
    // universellen `environmentId`, (3) den von der Spec selbst gemeldeten Namen (schadet
    // nicht, falls sie zufällig übereinstimmen) -- siehe Doc-Kommentare oben, WARUM (1)+(2)
    // nötig sind und nicht einfach (3) allein reicht.
    const opParams = [
      ...extractToolPathParamNames(call.path),
      ...ENVIRONMENT_SCOPING_FIELD_NAMES,
      ...getOperationParamNames(call.httpMethod, realPath),
    ];
    const findings = computeBodyFindings(contract, shape, opParams);

    for (const finding of findings) {
      results.push({
        ...finding,
        toolName: call.toolName,
        httpMethod: call.httpMethod,
        path: call.path,
        file: call.file,
        line: call.line,
      });
    }
  }

  return results;
}

/**
 * Reine Berechnung der Validierungs-Buckets aus Schema + extrahierten Tool-Aufrufen —
 * ohne I/O (kein Datei-Read, kein console.error). Wird sowohl von der CLI-Validierung
 * (`validate()`) als auch vom Coverage-Doc-Generator (`generate-coverage-doc.mjs`)
 * genutzt, damit beide garantiert dieselben Zahlen liefern.
 * @param {object} schema Geladenes docs/dockhand-api-schema.json
 * @param {Array} toolCalls Rückgabe von extractToolCalls()
 * @param {Record<string, {sentFields: string[], requiredSent: string[], passthrough: boolean}>|null} [toolBodyShapes]
 *   Rückgabe von loadToolBodyShapes() (Task P1.4/P1.6, advisory). `null`/`undefined`
 *   (Default) überspringt die Body-Contract-Checks komplett -- `bodyFindings` ist dann
 *   immer `[]`, alle bestehenden Buckets/Exit-Code-Verhalten bleiben UNVERÄNDERT. Damit
 *   bleiben bestehende Aufrufer wie generate-coverage-doc.mjs (2 Argumente) unverändert
 *   kompatibel.
 * @returns {{
 *   covered: Array, missingTool: Array, orphanedTool: Array, paramMismatch: Array,
 *   missingEncode: Array, queryParamMissingRequired: Array, queryParamUnknown: Array,
 *   bodyFindings: Array, excludedCount: number
 * }}
 */
function computeValidation(schema, toolCalls, toolBodyShapes = null) {
  // Baue Lookup-Maps
  const schemaEndpoints = new Map();
  for (const ep of schema.endpoints) {
    for (const method of ep.methods) {
      const key = endpointKey(ep.path, method);
      schemaEndpoints.set(key, ep);
    }
  }

  const toolEndpoints = new Map();
  for (const call of toolCalls) {
    const key = endpointKey(call.path, call.httpMethod);
    if (!toolEndpoints.has(key)) {
      toolEndpoints.set(key, []);
    }
    toolEndpoints.get(key).push(call);
  }

  // Ergebnisse
  const covered = [];
  const missingTool = [];
  const orphanedTool = [];
  const paramMismatch = [];
  const missingEncode = [];
  const queryParamMissingRequired = [];
  const queryParamUnknown = [];
  let excludedCount = 0;

  // 1. Prüfe Schema-Endpunkte → COVERED oder MISSING_TOOL
  for (const ep of schema.endpoints) {
    for (const method of ep.methods) {
      const key = endpointKey(ep.path, method);

      if (isIgnored(ep.path)) {
        excludedCount++;
        continue;
      }

      if (toolEndpoints.has(key)) {
        covered.push({ path: ep.path, method, tools: toolEndpoints.get(key).map(t => t.toolName) });
      } else {
        missingTool.push({ path: ep.path, method, pathParams: ep.pathParams });
      }
    }
  }

  // 2. Prüfe Tool-Aufrufe → ORPHANED_TOOL
  for (const call of toolCalls) {
    const key = endpointKey(call.path, call.httpMethod);
    if (!schemaEndpoints.has(key)) {
      // Prüfe ob es ein Stream-Endpunkt ist (postSSE → POST auf base-path)
      // batch-update vs batch-update-stream ist ein Sonderfall
      const baseKey = endpointKey(call.path, call.httpMethod);
      const streamKey = endpointKey(call.path + '-stream', call.httpMethod);
      if (!schemaEndpoints.has(baseKey) && !schemaEndpoints.has(streamKey)) {
        // Sonderfall: /api/metrics existiert nicht im Quellcode (Prometheus-Export ist kein SvelteKit-Route)
        if (!call.path.includes('/api/metrics')) {
          orphanedTool.push(call);
        }
      }
    }
  }

  // 3. Prüfe Parameter-Encoding
  for (const call of toolCalls) {
    if (call.hasPathParams && !call.usesEncode) {
      missingEncode.push(call);
    }
  }

  // 4. Prüfe Path-Parameter-Übereinstimmung (Anzahl + Namens-Suffix, siehe pathParamsMatch())
  for (const call of toolCalls) {
    const key = endpointKey(call.path, call.httpMethod);
    const schemaEp = schemaEndpoints.get(key);
    if (schemaEp && schemaEp.pathParams) {
      const callParams = [...call.path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
      const schemaParams = schemaEp.pathParams;
      if (!pathParamsMatch(callParams, schemaParams)) {
        paramMismatch.push({
          ...call,
          expected: schemaParams,
          actual: callParams,
        });
      }
    }
  }

  // 5. Prüfe Query-Parameter (fehlend / unbekannt) — Issue #95, required-aware seit
  // der queryParamsByMethod-Umstellung (kein manueller Re-Check mehr nötig).
  for (const call of toolCalls) {
    if (call.queryParamKeys === null) continue; // Params als Variable übergeben, nicht statisch analysierbar
    if (isIgnored(call.path)) continue;

    const key = endpointKey(call.path, call.httpMethod);
    const schemaEp = schemaEndpoints.get(key);
    if (!schemaEp) continue; // ORPHANED_TOOL deckt das schon ab

    // Query-Params sind jetzt PRO METHODE im Schema (extract-dockhand-api.mjs scannt
    // jeden Handler-Body einzeln, nicht mehr die ganze Datei) — der Missing-Check kann
    // deshalb für JEDEN Endpunkt laufen, nicht mehr nur bei Dateien mit genau einer
    // HTTP-Methode.
    const { missingRequired, unknown } = diffQueryParams(
      call.queryParamKeys,
      schemaEp.queryParamsByMethod?.[call.httpMethod],
      { checkMissing: true }
    );

    for (const p of missingRequired) {
      queryParamMissingRequired.push({ ...call, queryParam: p });
    }
    for (const p of unknown) {
      queryParamUnknown.push({ ...call, queryParam: p });
    }
  }

  // 6. Body-Contract-Checks (Task P1.4/P1.6) -- rein advisory, siehe JSDoc oben:
  // toolBodyShapes ist nur gesetzt, wenn der Aufrufer loadToolBodyShapes() erfolgreich
  // ausgeführt hat. Kein Effekt auf covered/missingTool/.../queryParamUnknown oder auf den
  // Exit-Code in validate() -- ein separater, nicht-fehler-auslösender Bucket.
  let bodyFindings = [];
  if (toolBodyShapes) {
    const openApiPathIndex = buildOpenApiPathIndex();
    if (openApiPathIndex) {
      bodyFindings = computeBodyFindingsForCalls(toolCalls, toolBodyShapes, openApiPathIndex);
    }
  }

  return {
    covered,
    missingTool,
    orphanedTool,
    paramMismatch,
    missingEncode,
    queryParamMissingRequired,
    queryParamUnknown,
    bodyFindings,
    excludedCount,
  };
}

/**
 * Hauptvalidierung (CLI-Einstiegspunkt: lädt Schema + Tool-Aufrufe von der Platte,
 * berechnet die Buckets über computeValidation(), schreibt den Report, setzt den
 * Exit-Code).
 */
function validate() {
  const schema = loadSchema();
  const toolCalls = extractToolCalls();

  console.error(`[validate] Schema: ${schema.endpointCount} Endpunkte (Commit: ${schema.sourceCommit.substring(0, 8)})`);
  console.error(`[validate] MCP Tools: ${toolCalls.length} API-Aufrufe gefunden`);

  // Body-Contract-Checks (Task P1.4/P1.6) sind advisory und optional: loadToolBodyShapes()
  // gibt `null` zurück, wenn der tsx-Collector aus irgendeinem Grund fehlschlägt (z.B. tsx
  // fehlt) -- computeValidation() überspringt die Checks dann komplett, alle bestehenden
  // Buckets und der Exit-Code bleiben unangetastet.
  const toolBodyShapes = loadToolBodyShapes();
  if (toolBodyShapes) {
    console.error(`[validate] Body-Shapes: ${Object.keys(toolBodyShapes).length} Tools erfasst (tsx-Collector)`);
  }

  const {
    covered,
    missingTool,
    orphanedTool,
    paramMismatch,
    missingEncode,
    queryParamMissingRequired,
    queryParamUnknown,
    bodyFindings,
  } = computeValidation(schema, toolCalls, toolBodyShapes);

  // Report generieren
  const report = generateReport({
    schema,
    covered,
    missingTool,
    orphanedTool,
    paramMismatch,
    missingEncode,
    queryParamMissingRequired,
    queryParamUnknown,
    bodyFindings,
  });

  writeFileSync(REPORT_FILE, report, 'utf8');
  console.error(`[validate] Report geschrieben: ${REPORT_FILE}`);

  // Zusammenfassung
  console.error('\n--- Validierungs-Ergebnis ---');
  console.error(`  COVERED:            ${covered.length} Endpunkte haben MCP-Tools`);
  console.error(`  MISSING_TOOL:       ${missingTool.length} Endpunkte ohne MCP-Tool`);
  console.error(`  ORPHANED_TOOL:      ${orphanedTool.length} MCP-Tools referenzieren nicht-existente Endpunkte`);
  console.error(`  PARAM_MISMATCH:     ${paramMismatch.length} Path-Parameter-Inkonsistenzen`);
  console.error(`  MISSING_ENCODE:     ${missingEncode.length} fehlende encodePath()-Aufrufe`);
  console.error(`  QUERY_PARAM_MISSING_REQUIRED: ${queryParamMissingRequired.length} vom Endpunkt zwingend erwartete (400 ohne sie), nicht gesendete Query-Params`);
  console.error(`  QUERY_PARAM_UNKNOWN: ${queryParamUnknown.length} gesendete, dem Endpunkt unbekannte Query-Params`);
  console.error(`  BODY_FINDINGS (informativ, kein Exit-Code-Effekt): ${bodyFindings.length}`);

  // Exit-Code: Fehler bei kritischen Problemen.
  // QUERY_PARAM_UNKNOWN ist wie ORPHANED_TOOL/PARAM_MISMATCH eindeutig ein Bug (das
  // Tool schickt einen Key, den die Route nachweislich nicht liest) — kritisch.
  // QUERY_PARAM_MISSING_REQUIRED ist jetzt GENAUSO kritisch: das Schema kennt required
  // vs. optional pro Methode aus dem echten `if (!x) { ... status: 4xx ... }`-Guard im
  // Handler (route-handlers.mjs) — ein fehlender required Param bedeutet, der Aufruf
  // 400ed garantiert. Fehlende OPTIONALE Params werden gar nicht erst in diesen Bucket
  // aufgenommen (diffQueryParams filtert per `p.required`), es gibt also keinen
  // informativen Nebeneimer mehr, der manuell nachgeprüft werden müsste.
  //
  // bodyFindings (Task P1.4) ist BEWUSST NICHT Teil von hasErrors -- advisory laut P1-Plan
  // (Global Constraints: "Checks starten advisory ... Beförderung ins Gate erst in P2").
  // Erst wenn P2.1 den Voll-Sweep FP-frei triagiert hat, wandert
  // BODY_PARAM_MISSING_REQUIRED hier in die hasErrors-Liste (P2.2).
  const hasErrors =
    orphanedTool.length > 0 ||
    paramMismatch.length > 0 ||
    missingEncode.length > 0 ||
    queryParamUnknown.length > 0 ||
    queryParamMissingRequired.length > 0;
  if (hasErrors) {
    console.error('\n[validate] FEHLER: Kritische Mismatches gefunden!');
    process.exit(1);
  }

  if (missingTool.length > 0) {
    console.error('\n[validate] WARNUNG: Neue Endpunkte ohne MCP-Tool erkannt');
    // Kein Fehler — neue Endpunkte sind normal
  }

  console.error('\n[validate] OK');
}

/**
 * Generiert den Markdown-Report
 */
function generateReport({ schema, covered, missingTool, orphanedTool, paramMismatch, missingEncode, queryParamMissingRequired, queryParamUnknown, bodyFindings = [] }) {
  const lines = [];
  const now = new Date().toISOString();

  lines.push('# MCP Tool Validation Report');
  lines.push('');
  lines.push(`**Generiert:** ${now}`);
  lines.push(`**Schema-Commit:** \`${schema.sourceCommit.substring(0, 8)}\``);
  lines.push(`**Schema-Endpunkte:** ${schema.endpointCount}`);
  lines.push('');

  // Zusammenfassung
  lines.push('## Zusammenfassung');
  lines.push('');
  lines.push('| Status | Anzahl |');
  lines.push('|--------|--------|');
  lines.push(`| COVERED | ${covered.length} |`);
  lines.push(`| MISSING_TOOL | ${missingTool.length} |`);
  lines.push(`| ORPHANED_TOOL | ${orphanedTool.length} |`);
  lines.push(`| PARAM_MISMATCH | ${paramMismatch.length} |`);
  lines.push(`| MISSING_ENCODE | ${missingEncode.length} |`);
  lines.push(`| QUERY_PARAM_MISSING_REQUIRED | ${queryParamMissingRequired.length} |`);
  lines.push(`| QUERY_PARAM_UNKNOWN | ${queryParamUnknown.length} |`);
  lines.push(`| BODY_FINDINGS (informativ) | ${bodyFindings.length} |`);
  lines.push('');

  // Kritische Probleme
  if (orphanedTool.length > 0) {
    lines.push('## ORPHANED_TOOL (Kritisch)');
    lines.push('');
    lines.push('Diese MCP-Tools referenzieren Endpunkte die nicht mehr in der Dockhand API existieren:');
    lines.push('');
    lines.push('| Tool | HTTP | Pfad | Datei |');
    lines.push('|------|------|------|-------|');
    for (const t of orphanedTool) {
      lines.push(`| \`${t.toolName}\` | ${t.httpMethod} | \`${t.path}\` | ${t.file}:${t.line} |`);
    }
    lines.push('');
  }

  if (paramMismatch.length > 0) {
    lines.push('## PARAM_MISMATCH (Kritisch)');
    lines.push('');
    lines.push('Path-Parameter stimmen nicht mit der API überein:');
    lines.push('');
    lines.push('| Tool | Pfad | Erwartet | Tatsächlich |');
    lines.push('|------|------|----------|-------------|');
    for (const t of paramMismatch) {
      lines.push(`| \`${t.toolName}\` | \`${t.path}\` | ${t.expected.join(', ')} | ${t.actual.join(', ')} |`);
    }
    lines.push('');
  }

  if (missingEncode.length > 0) {
    lines.push('## MISSING_ENCODE (Kritisch)');
    lines.push('');
    lines.push('Path-Parameter ohne `encodePath()` — Injection-Risiko:');
    lines.push('');
    lines.push('| Tool | Pfad | Datei |');
    lines.push('|------|------|-------|');
    for (const t of missingEncode) {
      lines.push(`| \`${t.toolName}\` | \`${t.path}\` | ${t.file}:${t.line} |`);
    }
    lines.push('');
  }

  if (queryParamUnknown.length > 0) {
    lines.push('## QUERY_PARAM_UNKNOWN (Kritisch)');
    lines.push('');
    lines.push('Das Tool sendet einen Query-Parameter, den der Endpunkt laut Schema nicht liest:');
    lines.push('');
    lines.push('| Tool | HTTP | Pfad | Unbekannter Parameter | Datei |');
    lines.push('|------|------|------|------------------------|-------|');
    for (const t of queryParamUnknown) {
      lines.push(`| \`${t.toolName}\` | ${t.httpMethod} | \`${t.path}\` | \`${t.queryParam}\` | ${t.file}:${t.line} |`);
    }
    lines.push('');
  }

  if (queryParamMissingRequired.length > 0) {
    lines.push('## QUERY_PARAM_MISSING_REQUIRED (Kritisch)');
    lines.push('');
    lines.push('Der Endpunkt verlangt diesen Query-Parameter zwingend (der Handler 400ed ohne ihn —');
    lines.push('siehe `queryParamsByMethod` im Schema), das Tool sendet ihn nicht. Der Aufruf schlägt');
    lines.push('garantiert fehl:');
    lines.push('');
    lines.push('| Tool | HTTP | Pfad | Fehlender Pflicht-Parameter | Datei |');
    lines.push('|------|------|------|------------------------------|-------|');
    for (const t of queryParamMissingRequired) {
      lines.push(`| \`${t.toolName}\` | ${t.httpMethod} | \`${t.path}\` | \`${t.queryParam}\` | ${t.file}:${t.line} |`);
    }
    lines.push('');
  }

  // Body-Contract-Findings (Task P1.4/P1.6, informativ/advisory -- KEIN Exit-Code-Effekt,
  // siehe hasErrors in validate(). Beförderung von BODY_PARAM_MISSING_REQUIRED zum harten
  // Gate erst nach dem P2.1-Voll-Sweep, siehe Task P2.2 im P1-Plan.)
  if (bodyFindings.length > 0) {
    lines.push('## BODY_FINDINGS (Informativ / Advisory)');
    lines.push('');
    lines.push(
      'Body-Contract-Abweichungen zwischen unseren MCP-Tools und der generierten ' +
        '`docs/dockhand-openapi.json` (Body-Contract-Quelle, siehe `scripts/fetch-openapi.mjs`). ' +
        '**Kein Gate** -- diese Findings beeinflussen den Exit-Code NICHT (Phase P1 im ' +
        'Body-Contract-Validierungs-Plan ist bewusst advisory-only; Beförderung ins Gate ist P2).'
    );
    lines.push('');
    lines.push('| Typ | Tool | HTTP | Pfad | Feld | Datei |');
    lines.push('|-----|------|------|------|------|-------|');
    for (const f of bodyFindings) {
      lines.push(
        `| ${f.type} | \`${f.toolName}\` | ${f.httpMethod} | \`${f.path}\` | ${f.field ? `\`${f.field}\`` : '-'} | ${f.file}:${f.line} |`
      );
    }
    lines.push('');
  }

  // Fehlende Tools (informativ)
  if (missingTool.length > 0) {
    lines.push('## MISSING_TOOL (Informativ)');
    lines.push('');
    lines.push('API-Endpunkte ohne MCP-Tool-Abdeckung:');
    lines.push('');
    lines.push('| HTTP | Pfad | Path-Parameter |');
    lines.push('|------|------|----------------|');
    for (const t of missingTool) {
      lines.push(`| ${t.method} | \`${t.path}\` | ${t.pathParams?.join(', ') || '-'} |`);
    }
    lines.push('');
  }

  // Coverage
  if (covered.length > 0) {
    lines.push('<details>');
    lines.push('<summary>COVERED Endpunkte (klicken zum Aufklappen)</summary>');
    lines.push('');
    lines.push('| HTTP | Pfad | MCP-Tools |');
    lines.push('|------|------|-----------|');
    for (const c of covered.sort((a, b) => a.path.localeCompare(b.path))) {
      lines.push(`| ${c.method} | \`${c.path}\` | ${c.tools.map(t => `\`${t}\``).join(', ')} |`);
    }
    lines.push('');
    lines.push('</details>');
  }

  return lines.join('\n') + '\n';
}

// Nur ausführen wenn direkt als CLI-Skript aufgerufen (nicht beim Import in Tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  validate();
}

export {
  WHITELISTED_QUERY_PARAMS,
  IGNORED_PATTERNS,
  BODY_CARRYING_HTTP_METHODS,
  splitTopLevel,
  extractObjectKey,
  findMatchingClose,
  extractCallQueryParamKeys,
  extractToolCallsFromSource,
  extractToolCalls,
  normalizePath,
  endpointKey,
  pathParamsMatch,
  diffQueryParams,
  isIgnored,
  buildOpenApiPathIndex,
  computeBodyFindingsForCalls,
  computeValidation,
  loadSchema,
};
