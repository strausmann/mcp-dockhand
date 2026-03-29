#!/usr/bin/env node

/**
 * Dockhand API Schema Extractor
 *
 * Klont das finsys/dockhand Repo (shallow) und extrahiert alle SvelteKit
 * API-Routen aus der Verzeichnisstruktur + exportierten HTTP-Methoden.
 *
 * Ausgabe: docs/dockhand-api-schema.json
 *
 * Benötigt: Node.js 22+, git
 * Auth: NICHT erforderlich (public Repo)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const CLONE_DIR = join('/tmp', 'dockhand-api-extract');
const REPO_URL = 'https://github.com/finsys/dockhand.git';
const OUTPUT_FILE = join(PROJECT_ROOT, 'docs', 'dockhand-api-schema.json');
const API_BASE = 'src/routes/api';

// SvelteKit HTTP-Methoden die in +server.ts exportiert werden können
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

/**
 * Klont das Dockhand-Repo (shallow, nur API-Routen)
 * @returns {string} Commit-Hash des geklonten Repos
 */
function cloneRepo() {
  console.error('[extract] Klone finsys/dockhand (shallow, sparse)...');

  if (existsSync(CLONE_DIR)) {
    rmSync(CLONE_DIR, { recursive: true, force: true });
  }

  execSync(
    `git clone --depth 1 --filter=blob:none --sparse "${REPO_URL}" "${CLONE_DIR}"`,
    { stdio: 'pipe' }
  );

  execSync(
    `git -C "${CLONE_DIR}" sparse-checkout set ${API_BASE}`,
    { stdio: 'pipe' }
  );

  const commitHash = execSync(
    `git -C "${CLONE_DIR}" rev-parse HEAD`,
    { encoding: 'utf8' }
  ).trim();

  console.error(`[extract] Commit: ${commitHash}`);
  return commitHash;
}

/**
 * Findet rekursiv alle +server.ts Dateien unter dem API-Verzeichnis
 * @param {string} dir
 * @returns {string[]}
 */
function findServerFiles(dir) {
  const results = [];

  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findServerFiles(fullPath));
    } else if (entry.name === '+server.ts') {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Konvertiert SvelteKit-Verzeichnispfad in API-Pfad
 * src/routes/api/containers/[id]/files/download → /api/containers/{id}/files/download
 * @param {string} filePath
 * @returns {string}
 */
function pathFromFile(filePath) {
  const rel = relative(join(CLONE_DIR, 'src/routes'), filePath);
  // Entferne +server.ts vom Ende
  const dir = dirname(rel);
  // Konvertiere [param] → {param}
  return '/' + dir.replace(/\[([^\]]+)\]/g, '{$1}');
}

/**
 * Extrahiert path-Parameter aus dem Pfad
 * /api/containers/{id}/files → ["id"]
 * @param {string} apiPath
 * @returns {string[]}
 */
function extractPathParams(apiPath) {
  const matches = apiPath.matchAll(/\{([^}]+)\}/g);
  return [...matches].map(m => m[1]);
}

/**
 * Extrahiert exportierte HTTP-Methoden aus einer +server.ts Datei
 * Sucht nach: export const GET, export const POST, etc.
 * @param {string} filePath
 * @returns {string[]}
 */
function extractMethods(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const methods = [];

  for (const method of HTTP_METHODS) {
    // Matcht: export const GET, export const GET:, export { GET }
    const patterns = [
      new RegExp(`export\\s+const\\s+${method}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`),
    ];

    if (patterns.some(p => p.test(content))) {
      methods.push(method);
    }
  }

  return methods;
}

/**
 * Extrahiert query-Parameter aus dem Quellcode (url.searchParams.get)
 * @param {string} filePath
 * @returns {string[]}
 */
function extractQueryParams(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const params = new Set();

  // Matcht: url.searchParams.get('param')
  const matches = content.matchAll(/url\.searchParams\.get\(['"]([^'"]+)['"]\)/g);
  for (const match of matches) {
    // Filtere interne/generische Parameter
    const param = match[1];
    if (!['env'].includes(param)) {
      params.add(param);
    }
  }

  return [...params].sort();
}

/**
 * Hauptfunktion
 */
function main() {
  const sourceCommit = cloneRepo();
  const apiDir = join(CLONE_DIR, API_BASE);
  const serverFiles = findServerFiles(apiDir).sort();

  console.error(`[extract] ${serverFiles.length} Route-Dateien gefunden`);

  const endpoints = [];

  for (const file of serverFiles) {
    const apiPath = pathFromFile(file);
    const methods = extractMethods(file);
    const pathParams = extractPathParams(apiPath);
    const queryParams = extractQueryParams(file);

    if (methods.length === 0) {
      console.error(`[extract] WARNUNG: Keine HTTP-Methoden in ${apiPath}`);
      continue;
    }

    const endpoint = {
      path: apiPath,
      methods: methods.sort(),
      pathParams: pathParams.length > 0 ? pathParams : undefined,
    };

    if (queryParams.length > 0) {
      endpoint.queryParams = queryParams;
    }

    endpoints.push(endpoint);
  }

  // Sortiere nach Pfad für konsistente Ausgabe
  endpoints.sort((a, b) => a.path.localeCompare(b.path));

  const schema = {
    generatedAt: new Date().toISOString(),
    sourceRepo: 'finsys/dockhand',
    sourceCommit,
    endpointCount: endpoints.length,
    endpoints,
  };

  // Fix #30 (MEDIUM): Deterministic schema output (PR #25).
  // Only write the file if endpoints actually changed — ignore generatedAt to avoid unnecessary commits.
  if (existsSync(OUTPUT_FILE)) {
    try {
      const existing = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8'));
      const existingComparable = { ...existing, generatedAt: '' };
      const newComparable = { ...schema, generatedAt: '' };
      if (JSON.stringify(existingComparable) === JSON.stringify(newComparable)) {
        console.error(`[extract] Schema unchanged (${endpoints.length} endpoints) — skipping write`);
        rmSync(CLONE_DIR, { recursive: true, force: true });
        console.error('[extract] Temporäres Verzeichnis aufgeräumt');
        return;
      }
    } catch {
      // If existing file is corrupt, overwrite it
    }
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(schema, null, 2) + '\n', 'utf8');
  console.error(`[extract] Schema geschrieben: ${OUTPUT_FILE}`);
  console.error(`[extract] ${endpoints.length} Endpunkte extrahiert`);

  // Aufräumen
  rmSync(CLONE_DIR, { recursive: true, force: true });
  console.error('[extract] Temporäres Verzeichnis aufgeräumt');
}

main();
