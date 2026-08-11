/**
 * In-process runtime-stats counters for this MCP server itself — feeds the
 * `get_runtime_stats` self-help tool (see src/tools/meta.ts). Deliberately
 * secret-safe: only counters and the last error's {tool, message, at} are
 * ever stored. Tool call arguments and response payloads are NEVER touched
 * here, so a snapshot can never leak them.
 *
 * `lastError.message` is NOT credential-safe by construction, though — it is
 * whatever `error.message` the failing tool call threw (see `recordError()`'s
 * only caller, `registerTool()` in tool-helper.ts). For a Dockhand API error,
 * that message is built by `DockhandClient.request()` as
 * `Dockhand API error: ${method} ${url} returned ${status}: ${errorBody}` —
 * i.e. it can embed a slice of the upstream Dockhand HTTP response body and
 * the request URL (including its query string). It never includes request
 * bodies or credential values (those are not part of `error.message` for any
 * throw site in this codebase), but a large or unexpected upstream response
 * body would otherwise be stored, and then echoed back to whichever MCP
 * client next calls `get_runtime_stats` — not necessarily the same client
 * that triggered the original error. `recordError()` bounds the stored
 * message to `MAX_ERROR_MESSAGE_LENGTH` characters for exactly this reason:
 * an unbounded upstream body must never be echoed wholesale.
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
 * Maximum length, in characters, `recordError` stores for a single error message before
 * truncating it. See the module doc comment above for why this bound exists: an upstream
 * Dockhand HTTP error can embed an unbounded slice of the response body inside
 * `error.message`, and `get_runtime_stats` echoes `lastError` to any caller. 500 characters
 * comfortably fits the `Dockhand API error: ${method} ${url} returned ${status}: ...`
 * prefix plus enough of the upstream body to be useful for debugging, without storing (and
 * later echoing) an arbitrarily large response.
 */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/** Truncates `message` to `MAX_ERROR_MESSAGE_LENGTH` characters, appending an ellipsis
 * marker when truncation actually happened. Messages at or under the limit pass through
 * unchanged. */
function truncateMessage(message: string): string {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) return message;
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`;
}

/**
 * Records a single tool failure. Stores only the tool name and the error
 * message (bounded to `MAX_ERROR_MESSAGE_LENGTH`, see above) — never the
 * arguments or any response/result payload.
 */
export function recordError(tool: string, message: string): void {
  errorCount += 1;
  getOrCreate(tool).errors += 1;
  lastError = { tool, message: truncateMessage(message), at: new Date().toISOString() };
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
