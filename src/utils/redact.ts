/**
 * Shared secret-redaction helpers.
 *
 * Split out (Fix round 3, Item B / P1-adjacent follow-up to the runtime-stats
 * query-string redaction) because the un-redacted `Dockhand API error: ${method} ${url}
 * returned …` message built by `DockhandClient` (src/client/dockhand-client.ts) reaches
 * THREE separate surfaces, not just the `get_runtime_stats` sink:
 *   1. `log().error(...)` in `registerTool()` (src/utils/tool-helper.ts) — ships
 *      straight into `docker logs`.
 *   2. `errorResponse(message)` (same call site) — returned to the invoking MCP client.
 *   3. `recordError(tool, message)` (src/utils/runtime-stats.ts) — stored and later
 *      echoed by `get_runtime_stats` to any client, not necessarily the one that hit the
 *      original error (the original P1 this was written for).
 *
 * Redacting only at the `runtime-stats` sink (surface 3) left surfaces 1 and 2
 * un-redacted: a URL query-string secret (e.g. `trigger_git_webhook`'s webhook `secret`
 * becoming `?secret=<value>` in the request URL) would still ship into container logs
 * on every failed call, regardless of whether anyone ever called `get_runtime_stats`.
 *
 * Redacting once here, at `DockhandClient`'s own error-message construction (the single
 * point all three surfaces trace back to), closes all three at once and is future-proof
 * for any new query-param secret a future tool might introduce. `runtime-stats.ts` keeps
 * its own call to this same function as defense-in-depth — harmless if the message was
 * already redacted upstream, and still effective for any error message that does not
 * originate from `DockhandClient` (e.g. a thrown error from tool-local logic).
 */

/** Marker `redactQueryStrings` substitutes for a URL's query string. */
export const QUERY_STRING_REDACTION_MARKER = '<redacted>';

/**
 * Replaces the query-string portion of any URL embedded in `message` with
 * `?${QUERY_STRING_REDACTION_MARKER}`.
 *
 * Matches a literal `?` followed by a run of non-whitespace characters (the query
 * string always ends at the next space in a `Dockhand API error: … returned …`-shaped
 * message, or at the end of the string) and replaces the whole match, so no fragment of
 * the original query string — key or value — survives in the returned message. A
 * message with no `?` is returned unchanged.
 */
export function redactQueryStrings(message: string): string {
  return message.replace(/\?\S+/g, `?${QUERY_STRING_REDACTION_MARKER}`);
}
