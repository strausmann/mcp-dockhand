#!/usr/bin/env node

/**
 * Tool-List-Generator
 *
 * Erzeugt `docs/tools.md` — alle Tools mit Modus (read/write), Endpoint und Kurzbeschreibung.
 * Importiert die kompilierten Module aus `dist/` (vorher `npm run build`, in CI schon erledigt).
 * Der Inhalt enthält keinen Zeitstempel; geschrieben wird nur bei Änderung.
 *
 * Verwendung:
 *   npm run build && node scripts/generate-tool-list.mjs
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const TOOLS_DOC = join(PROJECT_ROOT, 'docs', 'tools.md');

async function main() {
  const { buildToolListDoc } = await import('../dist/utils/tool-list-doc.js');
  const { TOOL_ENDPOINT_MAP } = await import('../dist/openapi/tool-endpoint-map.js');
  const { META_TOOL_NAMES } = await import('../dist/utils/meta-tool-names.js');
  const { classifyTool, READ_ONLY_ADAPTIVE_TOOLS } = await import('../dist/utils/tool-policy.js');
  const { specOperation } = await import('../dist/openapi/spec-loader.js');
  const { PINNED_DOCKHAND_OPENAPI_COMMIT } = await import('../dist/openapi/pinned.js');

  const doc = buildToolListDoc({
    endpointMap: TOOL_ENDPOINT_MAP,
    metaToolNames: META_TOOL_NAMES,
    classify: (name) => classifyTool(name, TOOL_ENDPOINT_MAP, META_TOOL_NAMES),
    summaryOf: (name) =>
      READ_ONLY_ADAPTIVE_TOOLS.includes(name)
        ? 'Read only under MCP_READ_ONLY, where it skips its side effect; write otherwise (see README).'
        : specOperation(TOOL_ENDPOINT_MAP[name])?.summary,
    openApiCommit: PINNED_DOCKHAND_OPENAPI_COMMIT,
  });

  const count = Object.keys(TOOL_ENDPOINT_MAP).length + META_TOOL_NAMES.length;

  if (existsSync(TOOLS_DOC) && readFileSync(TOOLS_DOC, 'utf8') === doc) {
    console.error(`[tool-list] Unverändert (${count} Tools) — kein Schreibvorgang`);
    return;
  }

  writeFileSync(TOOLS_DOC, doc, 'utf8');
  console.error(`[tool-list] Wrote ${count} tools to docs/tools.md`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

export { main };
