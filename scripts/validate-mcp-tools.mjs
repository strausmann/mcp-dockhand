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
 * - QUERY_PARAM_MISSING: Endpunkt erwartet einen Query-Parameter, das Tool sendet ihn nicht
 * - QUERY_PARAM_UNKNOWN: Tool sendet einen Query-Parameter, den der Endpunkt nicht kennt
 *
 * Exit-Code 1 bei Mismatches (ORPHANED_TOOL, PARAM_MISMATCH, MISSING_ENCODE oder QUERY_PARAM_UNKNOWN)
 * Exit-Code 0 wenn nur MISSING_TOOL oder QUERY_PARAM_MISSING (siehe Begründung unten)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const SCHEMA_FILE = join(PROJECT_ROOT, 'docs', 'dockhand-api-schema.json');
const TOOLS_DIR = join(PROJECT_ROOT, 'src', 'tools');
const REPORT_FILE = join(PROJECT_ROOT, 'validation-report.md');

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

// --- Balancierter Mini-Parser für Aufruf-Argumente & Objekt-Keys ---
//
// Die MCP-Tools rufen `client.<method>(path, body?, params?)` teils einzeilig, teils
// über mehrere Zeilen auf (siehe z.B. containers.ts get_container_logs). Um die
// tatsächlich gesendeten Query-Param-Keys zu extrahieren, muss der komplette
// Argument-Ausdruck geparst werden — nicht nur die eine Zeile mit dem Funktionsnamen.
// Die folgenden Helfer sind ein absichtlich einfacher, aber string/template/comment
// bewusster Klammer-Scanner (kein vollständiger JS-Parser, reicht aber für die in
// diesem Repo verwendeten einfachen Objekt-Literale).

/**
 * Überspringt einen String-Literal-Body ab dem öffnenden Quote-Zeichen.
 * @param {string} text
 * @param {number} i Index des öffnenden Quote-Zeichens
 * @param {string} quote `'` oder `"`
 * @returns {number} Index direkt nach dem schließenden Quote
 */
function skipString(text, i, quote) {
  i++;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * Überspringt ein Template-Literal (Backtick-String) inkl. verschachtelter `${...}`
 * Ausdrücke ab dem öffnenden Backtick.
 * @param {string} text
 * @param {number} i Index des öffnenden Backtick
 * @returns {number} Index direkt nach dem schließenden Backtick
 */
function skipTemplate(text, i) {
  i++;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '`') {
      return i + 1;
    }
    if (text[i] === '$' && text[i + 1] === '{') {
      i += 2;
      let depth = 1;
      while (i < text.length && depth > 0) {
        const c = text[i];
        if (c === "'" || c === '"') {
          i = skipString(text, i, c);
          continue;
        }
        if (c === '`') {
          i = skipTemplate(text, i);
          continue;
        }
        if (c === '{') {
          depth++;
          i++;
          continue;
        }
        if (c === '}') {
          depth--;
          i++;
          continue;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Findet den Index der zu `content[openIndex]` passenden schließenden Klammer
 * (respektiert Strings, Template-Literale und Kommentare).
 * @param {string} content
 * @param {number} openIndex Index von `(`, `{` oder `[`
 * @returns {number} Index der passenden schließenden Klammer, oder -1 bei unbalanciertem Input
 */
function findMatchingClose(content, openIndex) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const openChar = content[openIndex];
  const closeChar = pairs[openChar];
  if (!closeChar) return -1;

  let depth = 1;
  let i = openIndex + 1;
  while (i < content.length) {
    const ch = content[i];
    if (ch === "'" || ch === '"') {
      i = skipString(content, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(content, i);
      continue;
    }
    if (ch === '/' && content[i + 1] === '/') {
      const nl = content.indexOf('\n', i);
      i = nl === -1 ? content.length : nl;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i);
      i = end === -1 ? content.length : end + 2;
      continue;
    }
    if (ch === openChar) {
      depth++;
      i++;
      continue;
    }
    if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Splittet einen Ausdruck an Top-Level-Kommas (Tiefe 0), respektiert dabei
 * verschachtelte Klammern/Objekte/Arrays, Strings, Template-Literale und Kommentare.
 * @param {string} text
 * @returns {string[]} getrimmte Teil-Ausdrücke
 */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipString(text, i, ch);
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(text, i);
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if ('([{'.includes(ch)) {
      depth++;
      i++;
      continue;
    }
    if (')]}'.includes(ch)) {
      depth--;
      i++;
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
  const last = text.slice(start);
  if (last.trim().length > 0) parts.push(last);
  return parts.map((p) => p.trim());
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Ermittelt den Property-Key eines Objekt-Literal-Segments (`key: value` oder
 * Shorthand `key`). Gibt `null` zurück wenn kein statisch bestimmbarer Key vorliegt
 * (Spread `...x`, computed key `[expr]: ...`).
 * @param {string} segment Ein Top-Level-Segment aus splitTopLevel() über den Objekt-Inhalt
 * @returns {string|null}
 */
function extractObjectKey(segment) {
  const seg = segment.trim();
  if (!seg || seg.startsWith('...')) return null;
  if (seg.startsWith('[')) return null; // computed key, statisch nicht auflösbar

  const quotedMatch = seg.match(/^(['"])((?:\\.|(?!\1).)*)\1\s*:/);
  if (quotedMatch) return quotedMatch[2];

  let depth = 0;
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === "'" || ch === '"') {
      i = skipString(seg, i, ch) - 1;
      continue;
    }
    if (ch === '`') {
      i = skipTemplate(seg, i) - 1;
      continue;
    }
    if ('([{'.includes(ch)) {
      depth++;
      continue;
    }
    if (')]}'.includes(ch)) {
      depth--;
      continue;
    }
    if (ch === ':' && depth === 0) {
      const key = seg.slice(0, i).trim();
      return IDENTIFIER_RE.test(key) ? key : null;
    }
  }

  // Kein Top-Level-Doppelpunkt → Shorthand-Property `{ foo }`
  return IDENTIFIER_RE.test(seg) ? seg : null;
}

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
  if (!paramsArgText) return null;

  const trimmed = paramsArgText.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null; // nicht statisch analysierbar

  const inner = trimmed.slice(1, -1);
  const keys = [];
  for (const segment of splitTopLevel(inner)) {
    const key = extractObjectKey(segment);
    if (key) keys.push(key);
  }
  return keys;
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
 * für den Endpunkt bekannten Query-Params.
 * @param {string[]} sentKeys Roh extrahierte Keys (inkl. ggf. whitelisteter wie `env`)
 * @param {string[]|undefined} schemaQueryParams `ep.queryParams`
 * @param {{ checkMissing: boolean }} options `checkMissing` nur bei Endpunkten mit
 *   genau einer HTTP-Methode setzen (siehe Kommentar in validate())
 * @returns {{ missing: string[], unknown: string[] }}
 */
function diffQueryParams(sentKeys, schemaQueryParams, { checkMissing }) {
  const known = new Set(schemaQueryParams ?? []);
  const sent = sentKeys.filter((k) => !WHITELISTED_QUERY_PARAMS.has(k));

  const unknown = sent.filter((k) => !known.has(k));

  let missing = [];
  if (checkMissing && schemaQueryParams) {
    const sentSet = new Set(sent);
    missing = schemaQueryParams.filter((p) => !sentSet.has(p));
  }

  return { missing, unknown };
}

/**
 * Hauptvalidierung
 */
function validate() {
  const schema = loadSchema();
  const toolCalls = extractToolCalls();

  console.error(`[validate] Schema: ${schema.endpointCount} Endpunkte (Commit: ${schema.sourceCommit.substring(0, 8)})`);
  console.error(`[validate] MCP Tools: ${toolCalls.length} API-Aufrufe gefunden`);

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
  const queryParamMissing = [];
  const queryParamUnknown = [];

  // Endpunkte die wir bewusst ignorieren (Streams, Callbacks, interne)
  const ignoredPatterns = [
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

  function isIgnored(path) {
    const normalized = normalizePath(path);
    return ignoredPatterns.some(p => normalized.includes(p) || normalized === normalizePath(p));
  }

  // 1. Prüfe Schema-Endpunkte → COVERED oder MISSING_TOOL
  for (const ep of schema.endpoints) {
    for (const method of ep.methods) {
      const key = endpointKey(ep.path, method);

      if (isIgnored(ep.path)) continue;

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

  // 5. Prüfe Query-Parameter (fehlend / unbekannt) — Issue #95
  for (const call of toolCalls) {
    if (call.queryParamKeys === null) continue; // Params als Variable übergeben, nicht statisch analysierbar
    if (isIgnored(call.path)) continue;

    const key = endpointKey(call.path, call.httpMethod);
    const schemaEp = schemaEndpoints.get(key);
    if (!schemaEp) continue; // ORPHANED_TOOL deckt das schon ab

    // "Fehlend" nur bei Endpunkten mit GENAU EINER HTTP-Methode prüfen: das Schema
    // fasst queryParams pro Route-DATEI zusammen (extract-dockhand-api.mjs liest jeden
    // url.searchParams.get() im ganzen +server.ts), nicht pro Methode. Bei einer Datei
    // mit z.B. GET+POST kann ein Param nur für die GET-Variante gelten — eine
    // Fehlend-Prüfung würde dort legitime POST-Aufrufe fälschlich flaggen.
    const { missing, unknown } = diffQueryParams(call.queryParamKeys, schemaEp.queryParams, {
      checkMissing: schemaEp.methods.length === 1,
    });

    for (const p of missing) {
      queryParamMissing.push({ ...call, queryParam: p });
    }
    for (const p of unknown) {
      queryParamUnknown.push({ ...call, queryParam: p });
    }
  }

  // Report generieren
  const report = generateReport({
    schema,
    covered,
    missingTool,
    orphanedTool,
    paramMismatch,
    missingEncode,
    queryParamMissing,
    queryParamUnknown,
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
  console.error(`  QUERY_PARAM_MISSING: ${queryParamMissing.length} vom Endpunkt erwartete, nicht gesendete Query-Params`);
  console.error(`  QUERY_PARAM_UNKNOWN: ${queryParamUnknown.length} gesendete, dem Endpunkt unbekannte Query-Params`);

  // Exit-Code: Fehler nur bei kritischen Problemen.
  // QUERY_PARAM_UNKNOWN ist wie ORPHANED_TOOL/PARAM_MISMATCH eindeutig ein Bug (das
  // Tool schickt einen Key, den die Route nachweislich nicht liest) — kritisch.
  // QUERY_PARAM_MISSING ist wie MISSING_TOOL informativ: da praktisch alle Query-Params
  // dieser API optionale Filter sind (url.searchParams.get() ohne Pflicht-Fallback),
  // ist "dieser eine Aufruf nutzt einen optionalen Filter nicht" oft kein Bug.
  const hasErrors = orphanedTool.length > 0 || paramMismatch.length > 0 || missingEncode.length > 0 || queryParamUnknown.length > 0;
  if (hasErrors) {
    console.error('\n[validate] FEHLER: Kritische Mismatches gefunden!');
    process.exit(1);
  }

  if (missingTool.length > 0) {
    console.error('\n[validate] WARNUNG: Neue Endpunkte ohne MCP-Tool erkannt');
    // Kein Fehler — neue Endpunkte sind normal
  }

  if (queryParamMissing.length > 0) {
    console.error('\n[validate] WARNUNG: Tools nutzen bekannte Query-Params des Endpunkts nicht');
    // Kein Fehler — siehe Begründung oben (optionale Filter)
  }

  console.error('\n[validate] OK');
}

/**
 * Generiert den Markdown-Report
 */
function generateReport({ schema, covered, missingTool, orphanedTool, paramMismatch, missingEncode, queryParamMissing, queryParamUnknown }) {
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
  lines.push(`| QUERY_PARAM_MISSING | ${queryParamMissing.length} |`);
  lines.push(`| QUERY_PARAM_UNKNOWN | ${queryParamUnknown.length} |`);
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

  if (queryParamMissing.length > 0) {
    lines.push('## QUERY_PARAM_MISSING (Informativ)');
    lines.push('');
    lines.push('Der Endpunkt kennt diesen Query-Parameter, das Tool sendet ihn nicht — bei den meisten');
    lines.push('Query-Params dieser API ist das ein optionaler Filter und kein Bug; im Einzelfall prüfen:');
    lines.push('');
    lines.push('| Tool | HTTP | Pfad | Fehlender Parameter | Datei |');
    lines.push('|------|------|------|----------------------|-------|');
    for (const t of queryParamMissing) {
      lines.push(`| \`${t.toolName}\` | ${t.httpMethod} | \`${t.path}\` | \`${t.queryParam}\` | ${t.file}:${t.line} |`);
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
};
