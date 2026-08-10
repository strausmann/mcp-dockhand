#!/usr/bin/env npx tsx

/**
 * Collects every registered MCP tool's body shape by actually running the real tool
 * registration code (`registerAllTools()`, src/tools/index.ts) against a capturing mock
 * server, then prints the result as JSON on stdout.
 *
 * WHY THIS SCRIPT EXISTS (the "CLI-Erfassungs-Problem" from the P1 plan):
 * `scripts/validate-mcp-tools.mjs` is a plain `node` script (no `tsx`, no TypeScript
 * loader) -- it has always worked by statically regex-scanning the `.ts` source text of
 * `src/tools/*.ts` (see extractToolCallsFromSource()), never by importing it. That is
 * fine for extracting `client.<method>(path, ...)` calls, but the body-contract checks
 * (Task P1.4) need the REAL Zod shape objects passed to `registerTool(...)` -- and those
 * can only be obtained by actually executing the TypeScript module graph (src/tools/*.ts
 * -> zod, tool-helper.ts, ...), which plain `node` cannot import directly.
 *
 * Rather than adding a TypeScript loader dependency to validate-mcp-tools.mjs itself (and
 * risking behavior changes to the already-working static extraction), this script is a
 * SEPARATE, `tsx`-only entry point. validate-mcp-tools.mjs shells out to it via
 * `npx tsx scripts/collect-tool-shapes.mjs` (see loadToolBodyShapes()) and parses its JSON
 * stdout -- the existing `node scripts/validate-mcp-tools.mjs` CLI invocation keeps working
 * unchanged; if the collector fails for any reason (tsx missing, a tool file that fails to
 * import), validate-mcp-tools.mjs falls back to skipping body-checks entirely rather than
 * crashing the whole run (body-checks are advisory, per Global Constraints in the P1 plan).
 *
 * Output shape: `{ [toolName]: { sentFields: string[], requiredSent: string[], passthrough: boolean } }`
 * -- already the computeBodyShape() result, not the raw (non-JSON-serializable) Zod
 * objects. Uses createCapturingServer()/computeBodyShape() from tool-body-shape.mjs, the
 * same fixture pattern tests/tool-body-shape.test.ts and tests/update-container-contract.test.ts
 * already use -- no new introspection logic here, just wiring it up against every tool at
 * once instead of one-by-one in a test.
 */

import { registerAllTools } from '../src/tools/index.js';
import { createCapturingServer, computeBodyShape } from './lib/tool-body-shape.mjs';

/**
 * Registers every MCP tool against a capturing server and reduces the raw Zod shapes to
 * the already-computed body-shape summary per tool name.
 * @returns {Record<string, { sentFields: string[], requiredSent: string[], passthrough: boolean }>}
 */
function collectAllToolBodyShapes() {
  const { server, shapes } = createCapturingServer();
  // registerAllTools() never invokes the tool callbacks during registration (they're only
  // called when an MCP client actually calls the tool) -- an empty client stand-in is safe,
  // exactly like the existing registerStackTools(server as any, {} as any) test fixture.
  registerAllTools(/** @type {any} */ (server), /** @type {any} */ ({}));

  /** @type {Record<string, { sentFields: string[], requiredSent: string[], passthrough: boolean }>} */
  const result = {};
  for (const [toolName, zodShape] of shapes) {
    result[toolName] = computeBodyShape(zodShape);
  }
  return result;
}

function main() {
  const shapes = collectAllToolBodyShapes();
  process.stdout.write(JSON.stringify(shapes));
}

main();
