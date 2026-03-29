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
 * - PARAM_MISMATCH: Parameter stimmen nicht überein
 * - MISSING_ENCODE: Path-Parameter wird nicht mit encodePath() encoded
 *
 * Exit-Code 1 bei Mismatches (ORPHANED_TOOL oder PARAM_MISMATCH)
 * Exit-Code 0 wenn nur MISSING_TOOL (neue Endpunkte sind normal)
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

/**
 * Extrahiert alle API-Aufrufe aus den MCP-Tool-Dateien
 * @returns {Array<{file: string, toolName: string, httpMethod: string, path: string, usesEncode: boolean, line: number}>}
 */
function extractToolCalls() {
  const calls = [];
  const files = readdirSync(TOOLS_DIR).filter(f => f.endsWith('.ts') && f !== 'index.ts');

  for (const file of files) {
    const filePath = join(TOOLS_DIR, file);
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

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
        const interpolations = [...rawPath.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1]);
        const hasPathParams = normalizedPath.includes('{');
        const usesEncode = hasPathParams
          ? interpolations.every(expr => expr.includes('encodePath'))
          : true;

        calls.push({
          file,
          toolName: currentTool,
          httpMethod,
          path: normalizedPath,
          usesEncode,
          hasPathParams,
          line: i + 1,
        });
      }
    }
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

  // 4. Prüfe Path-Parameter-Übereinstimmung
  for (const call of toolCalls) {
    const key = endpointKey(call.path, call.httpMethod);
    const schemaEp = schemaEndpoints.get(key);
    if (schemaEp && schemaEp.pathParams) {
      const callParams = [...call.path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
      const schemaParams = schemaEp.pathParams;
      if (callParams.length !== schemaParams.length) {
        paramMismatch.push({
          ...call,
          expected: schemaParams,
          actual: callParams,
        });
      }
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
  });

  writeFileSync(REPORT_FILE, report, 'utf8');
  console.error(`[validate] Report geschrieben: ${REPORT_FILE}`);

  // Zusammenfassung
  console.error('\n--- Validierungs-Ergebnis ---');
  console.error(`  COVERED:        ${covered.length} Endpunkte haben MCP-Tools`);
  console.error(`  MISSING_TOOL:   ${missingTool.length} Endpunkte ohne MCP-Tool`);
  console.error(`  ORPHANED_TOOL:  ${orphanedTool.length} MCP-Tools referenzieren nicht-existente Endpunkte`);
  console.error(`  PARAM_MISMATCH: ${paramMismatch.length} Parameter-Inkonsistenzen`);
  console.error(`  MISSING_ENCODE: ${missingEncode.length} fehlende encodePath()-Aufrufe`);

  // Exit-Code: Fehler nur bei kritischen Problemen
  const hasErrors = orphanedTool.length > 0 || paramMismatch.length > 0 || missingEncode.length > 0;
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
function generateReport({ schema, covered, missingTool, orphanedTool, paramMismatch, missingEncode }) {
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

validate();
