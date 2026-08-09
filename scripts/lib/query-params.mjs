/**
 * Static resolution of "what query-param keys does this expression send" for the MCP
 * tool call sites in `src/tools/*.ts`.
 *
 * Handles the expression shapes actually used in this codebase for the `params`
 * argument of `client.get/post/put/delete(...)`:
 *   - object literals: `{ env: environmentId, tail }`
 *   - the literals `undefined` / `null` (sends nothing)
 *   - conditional (ternary) expressions: `cond ? { env: environmentId } : undefined`,
 *     including nested ternaries in either branch
 *
 * Anything else (a bare identifier like `opts`, a function call, a mutated variable
 * like `params` built up via `if (x) params.x = x`) is NOT statically resolvable and
 * resolves to `null` — callers must treat `null` as "skip this call", not "sends
 * nothing". This mirrors (and replaces) the previous `extractCallQueryParamKeys`
 * behavior of `validate-mcp-tools.mjs`, which only handled the plain object-literal case
 * and returned `null` for ternaries — the exact gap that let `get_registry_catalog`
 * (`environmentId ? { env: environmentId } : undefined`) pass through the query-param
 * check unseen.
 */

import { splitTopLevel, extractObjectKey, splitTernary } from './js-scan.mjs';

/**
 * Resolves the query-param keys a `params` expression can statically be shown to send.
 * @param {string} text
 * @returns {string[]|null} Sorted unique keys, or `null` if not statically resolvable.
 */
export function resolveQueryParamKeys(text) {
  const trimmed = text.trim();
  if (trimmed === 'undefined' || trimmed === 'null') return [];

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1);
    const keys = [];
    for (const segment of splitTopLevel(inner)) {
      const key = extractObjectKey(segment);
      if (key) keys.push(key);
    }
    return keys;
  }

  const ternary = splitTernary(trimmed);
  if (ternary) {
    const trueKeys = resolveQueryParamKeys(ternary.whenTrue);
    const falseKeys = resolveQueryParamKeys(ternary.whenFalse);
    // Either branch unresolvable → the overall set of keys this call can send is
    // unknown. Do NOT silently fall back to "only the resolvable branch" — that would
    // under-report keys the call can actually send (false negative for both the
    // missing-required and the unknown check).
    if (trueKeys === null || falseKeys === null) return null;
    return [...new Set([...trueKeys, ...falseKeys])].sort();
  }

  return null; // bare identifier, function call, spread of a mutated variable, etc.
}
