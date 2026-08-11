/**
 * In-process runtime-stats counters for this MCP server itself — feeds the
 * `get_runtime_stats` self-help tool (see src/tools/meta.ts). Deliberately
 * secret-safe: only counters and the last error's {tool, message, at} are
 * ever stored. Tool call arguments and response payloads are NEVER touched
 * here, so a snapshot can never leak them.
 */

export interface LastError {
  tool: string;
  message: string;
  at: string;
}

export interface ToolStats {
  calls: number;
  errors: number;
}

export interface StatsSnapshot {
  startedAt: string;
  requestCount: number;
  errorCount: number;
  perTool: Record<string, ToolStats>;
  lastError: LastError | null;
}

const startedAt = new Date().toISOString();
let requestCount = 0;
let errorCount = 0;
let perTool: Record<string, ToolStats> = {};
let lastError: LastError | null = null;

function getOrCreate(tool: string): ToolStats {
  const existing = perTool[tool];
  if (existing) return existing;
  const created: ToolStats = { calls: 0, errors: 0 };
  perTool[tool] = created;
  return created;
}

/** Records a single tool invocation. */
export function recordCall(tool: string): void {
  requestCount += 1;
  getOrCreate(tool).calls += 1;
}

/**
 * Records a single tool failure. Stores only the tool name and the error
 * message — never the arguments or any response/result payload.
 */
export function recordError(tool: string, message: string): void {
  errorCount += 1;
  getOrCreate(tool).errors += 1;
  lastError = { tool, message, at: new Date().toISOString() };
}

/** Returns a plain-data snapshot of the current counters. */
export function getStatsSnapshot(): StatsSnapshot {
  return {
    startedAt,
    requestCount,
    errorCount,
    perTool: Object.fromEntries(
      Object.entries(perTool).map(([name, stats]) => [name, { ...stats }])
    ),
    lastError: lastError ? { ...lastError } : null,
  };
}

/** Test hook: resets all counters. Mirrors `__resetUpdateCache` in meta.ts. */
export function __resetStats(): void {
  requestCount = 0;
  errorCount = 0;
  perTool = {};
  lastError = null;
}
