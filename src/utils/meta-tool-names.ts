/**
 * The six self-help/meta tool names registered by `registerMetaTools()` below —
 * `get_tool_manifest` itself among them. This is the single source of truth for that
 * list: `tests/tool-endpoint.test.ts`'s endpoint-completeness check imports it to
 * exclude these six from its "every registered tool has a `TOOL_ENDPOINT_MAP` entry"
 * assertion (none of the six wrap a single Dockhand endpoint the way every other
 * registered tool does — see that test's own doc comment for why, tool by tool), and
 * `get_tool_manifest`'s own registration wiring below reuses it (Fix round 2,
 * Finding 4) so its inventory includes these six tools too, not just the
 * `TOOL_ENDPOINT_MAP` ones.
 */
export const META_TOOL_NAMES: readonly string[] = [
  'check_for_update',
  'get_runtime_stats',
  'get_server_info',
  'get_tool_manifest',
  'self_check',
  'validate_config',
];
