/**
 * Tool registration helper with built-in error handling.
 * Wraps every tool callback in try/catch so unhandled errors
 * are returned as structured MCP error responses instead of crashing.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { jsonResponse, textResponse, errorResponse } from './response.js';
import { describeTool } from '../openapi/describe-tool.js';
import { recordCall, recordError } from './runtime-stats.js';
import { runWithLogContext, log, currentLogContext } from './log-context.js';
import { TOOL_ENDPOINT_MAP } from '../openapi/tool-endpoint-map.js';

// Re-export response helpers for convenience
export { jsonResponse, textResponse, errorResponse };

type ToolResponse = ReturnType<typeof jsonResponse> | ReturnType<typeof textResponse>;

type ZodShape = Record<string, z.ZodTypeAny>;

/**
 * Register an MCP tool with automatic try/catch error handling.
 * Preserves full Zod type inference for the callback args.
 *
 * The `description` is no longer a hand-written literal at the call site — it is
 * derived at registration time from the generated OpenAPI spec via `describeTool(name)`
 * (src/openapi/describe-tool.ts), which resolves the tool's endpoint
 * (src/openapi/tool-endpoint.ts) against docs/dockhand-openapi.json
 * (src/openapi/spec-loader.ts) and formats it via `deriveToolDescription`
 * (src/openapi/derive-description.ts). See
 * docs/superpowers/plans/2026-08-10-mcp-dockhand-description-quality-governance.md
 * (Task 5) in the homelab-management repo for the full design.
 */
export function registerTool<T extends ZodShape>(
  server: McpServer,
  name: string,
  schema: T,
  callback: (args: z.output<z.ZodObject<T>>) => Promise<ToolResponse>
): void {
  const description = describeTool(name);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (server as any).tool(name, description, schema, async (args: any) => {
    recordCall(name);
    const outer = currentLogContext();
    const started = Date.now();

    // The tool's own endpoint template (never a concrete path). This is logged on the
    // tool's own start/ok/failed lines call-time — NOT bound into the log context.
    // Binding it would bake it into every pino child (see log()), and the per-request
    // client debug line (loggedFetch) now derives and logs its OWN route from the
    // request pathname (matchRoute, #214): a child already carrying a bound `route`
    // makes pino serialize BOTH keys, so a fan-out line would report the stale
    // tool-wide route alongside the correct request one. (Codex, PR #219.)
    const toolRoute = TOOL_ENDPOINT_MAP[name]?.path;

    return runWithLogContext(
      {
        ...outer,
        call: randomUUID(),
        tool: name,
      },
      async () => {
        log().info({ component: 'tools', route: toolRoute }, 'start');
        try {
          const result = await callback(args);
          log().info({ component: 'tools', route: toolRoute, ms: Date.now() - started }, 'ok');
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          // Fail loud: a thrown error here (e.g. a lazily-triggered Dockhand
          // login failure) would otherwise only ever reach the caller as a
          // structured MCP tool-error response — never written to
          // stderr/docker logs. Logged unconditionally so every tool failure
          // is diagnosable from container logs alone. See Issue #116.
          // Siblings, deliberately not nested under `err`. pino applies its default
          // error serializer to that key, and it treats ANY object carrying a
          // `message` as error-like: it overwrites `type` with the constructor name
          // and appends an empty `stack`. This line spent its whole life emitting
          // "err":{"type":"Object","message":...,"stack":""} — the 'ToolError' label
          // never once reached a log. (dockhand-client.ts escapes it only by having
          // no `message` key; adding one there would break it the same way, which is
          // reason enough not to hand this key a shape that has to stay lucky.)
          log().error(
            {
              component: 'tools',
              ms: Date.now() - started,
              errType: 'ToolError',
              errMessage: message,
            },
            'tool failed',
          );
          recordError(name, message);
          return errorResponse(message);
        }
      },
    );
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
