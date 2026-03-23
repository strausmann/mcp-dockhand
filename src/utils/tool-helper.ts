/**
 * Tool registration helper with built-in error handling.
 * Wraps every tool callback in try/catch so unhandled errors
 * are returned as structured MCP error responses instead of crashing.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { jsonResponse, textResponse, errorResponse } from './response.js';

// Re-export response helpers for convenience
export { jsonResponse, textResponse, errorResponse };

type ToolResponse = ReturnType<typeof jsonResponse> | ReturnType<typeof textResponse>;

type ZodShape = Record<string, z.ZodTypeAny>;

/**
 * Register an MCP tool with automatic try/catch error handling.
 * Preserves full Zod type inference for the callback args.
 */
export function registerTool<T extends ZodShape>(
  server: McpServer,
  name: string,
  description: string,
  schema: T,
  callback: (args: z.objectOutputType<T, z.ZodTypeAny>) => Promise<ToolResponse>
): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (server as any).tool(name, description, schema, async (args: any) => {
    try {
      return await callback(args);
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Unknown error');
    }
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
