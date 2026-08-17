/**
 * describeTool() — the single glue function `registerTool()` (src/utils/tool-helper.ts)
 * calls at registration time to derive a tool's MCP `description`. Ties together:
 *   0. `TOOL_DESCRIPTION_OVERRIDES[name]` — a hand-written description WINS outright when
 *      present, before any spec lookup (see description-overrides.ts for when/why this
 *      escape hatch exists — a narrow, audited exception, not a general opt-out).
 *   1. `toolEndpoint(name)` — which Dockhand endpoint does this tool call?
 *   2. `specOperation(endpoint)` — what does docs/dockhand-openapi.json say about it?
 *   3. `deriveToolDescription(op, endpointToTool)` — summary + resolved cross-refs.
 *
 * Never returns an empty string. When the tool has no registry entry (currently only
 * `get_prometheus_metrics` — see tool-endpoint-map.ts) or is not a known tool at all,
 * `specOperation` resolves to `undefined`; `deriveToolDescription({}, ...)` still
 * produces its own defined fallback text (`FALLBACK_DESCRIPTION`), and this function
 * logs an advisory so the gap is visible in server startup logs instead of silently
 * shipping a generic description (see service-verifikation.md — no silent truncation).
 */

import { deriveToolDescription } from './derive-description.js';
import { toolEndpoint, endpointToTool } from './tool-endpoint.js';
import { specOperation } from './spec-loader.js';
import { TOOL_DESCRIPTION_OVERRIDES } from './description-overrides.js';
import { TOOL_DESCRIPTION_SUFFIXES } from './description-suffixes.js';

/** Appends the tool's operator-safety note, when it has one. See description-suffixes.ts. */
function withSuffix(name: string, description: string): string {
  const suffix = TOOL_DESCRIPTION_SUFFIXES[name];
  return suffix ? `${description} ${suffix}` : description;
}

export function describeTool(name: string): string {
  const override = TOOL_DESCRIPTION_OVERRIDES[name];
  // A suffix applies to an overridden description too — it is a caller-side rule, not a
  // property of where the text came from.
  if (override) return withSuffix(name, override);

  const endpoint = toolEndpoint(name);
  if (!endpoint) {
    console.error(
      `[describe-tool] No endpoint registry entry for tool "${name}" — using fallback description.`
    );
  }

  const op = specOperation(endpoint);
  if (endpoint && !op) {
    console.error(
      `[describe-tool] Tool "${name}" maps to ${endpoint.method} ${endpoint.path}, but that operation was not found in the spec — using fallback description.`
    );
  }

  return withSuffix(name, deriveToolDescription(op ?? {}, endpointToTool));
}
