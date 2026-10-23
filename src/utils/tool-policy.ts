/**
 * Read-only mode and tool allow/deny filter (issue #254).
 *
 * `buildToolPolicy()` is a pure function over an env record and a tool universe. The
 * module-level `configureToolPolicy()`/`currentToolPolicy()` pair lets `registerTool()`
 * consult the active policy; the default policy registers everything.
 *
 * Spec: docs/designs/2026-10-23-read-only-mode-design.md
 */

import { TOOL_ENDPOINT_MAP, type ToolEndpointEntry } from '../openapi/tool-endpoint-map.js';
import { META_TOOL_NAMES } from './meta-tool-names.js';

/**
 * GET tools with a side effect, classified `write` despite the method. Read-only means no
 * state change in Dockhand or on the Docker host and no outbound side effect; each entry
 * below breaks that upstream (Dockhand handler at the pinned commit).
 */
export const WRITE_GET_TOOLS: readonly string[] = [
  'trigger_git_webhook', // webhook trigger: deploys the git stack
  'get_git_stack_webhook', // same endpoint as trigger_git_webhook: deploys, or writes an audit entry
  'get_git_webhook', // repository webhook trigger: deploys, or writes an audit entry
  'browse_volume', // pulls the helper image, creates and starts a helper container
  'export_volume', // helper container (create/start), released after the export
  'get_volume_file_content', // helper container, then exec `cat` in it
  'get_container_shells', // exec in the user's container to probe for shells
  'get_container_top', // exec `ps` in the user's container (when the caller holds exec)
  'list_container_files', // exec `ls` in the user's container
  'probe_backup_stack_dir', // pulls the backup helper image and runs a helper container
];

/**
 * POST tools that only validate or compare (POST for transport reasons): no Dockhand state
 * change, no Docker daemon call, no outbound request. validate_stack_compose runs
 * `docker compose config` on a throwaway temp copy.
 */
export const READ_ONLY_POST_TOOLS: readonly string[] = [
  'validate_stack_compose',
  'validate_stack_env',
  'validate_stack_path',
  'check_stack_path_change',
];

export class ToolPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolPolicyError';
  }
}

type EndpointMap = Readonly<Record<string, ToolEndpointEntry>>;

/** Compile a `*`-wildcard entry into an anchored, case-sensitive matcher. All else is literal. */
export function compilePattern(entry: string): (name: string) => boolean {
  const source = entry
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const re = new RegExp(`^${source}$`);
  return (name) => re.test(name);
}

/** Unknown names are classified `write` (fail-safe). */
export function classifyTool(
  name: string,
  endpointMap: EndpointMap,
  metaToolNames: readonly string[],
): 'read' | 'write' {
  if (metaToolNames.includes(name) || READ_ONLY_POST_TOOLS.includes(name)) return 'read';
  const entry = Object.prototype.hasOwnProperty.call(endpointMap, name) ? endpointMap[name] : undefined;
  if (entry && entry.method.toUpperCase() === 'GET' && !WRITE_GET_TOOLS.includes(name)) return 'read';
  return 'write';
}

export interface ToolPolicySummary {
  readOnly: boolean;
  allow: string[];
  deny: string[];
  registered: number;
  total: number;
  readmittedWriteTools: string[];
}

export interface ToolPolicy {
  isRegistered(name: string): boolean;
  mode(name: string): 'read' | 'write';
  summary: ToolPolicySummary;
}

function parseReadOnly(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'false' || v === '0' || v === 'no') return false;
  if (v === 'true' || v === '1' || v === 'yes') return true;
  throw new ToolPolicyError(`MCP_READ_ONLY must be true/false (got "${raw}")`);
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

const POLICY_VAR_NAMES = ['MCP_READ_ONLY', 'MCP_TOOLS_ALLOW', 'MCP_TOOLS_DENY'] as const;

const squash = (name: string) => name.toUpperCase().replace(/_/g, '');

/**
 * Env names that look like a policy variable but are not spelled exactly (MCP_READONLY,
 * mcp_read_only, ...). Such a variable is silently ignored, so the operator's intended
 * restriction would not apply: the caller warns. Returns names only, never values.
 */
export function findMisspelledPolicyVars(
  env: Record<string, string | undefined>,
): Array<{ name: string; expected: string }> {
  const found: Array<{ name: string; expected: string }> = [];
  for (const name of Object.keys(env)) {
    const expected = POLICY_VAR_NAMES.find((v) => v !== name && squash(v) === squash(name));
    if (expected) found.push({ name, expected });
  }
  return found;
}

export function buildToolPolicy(
  env: Record<string, string | undefined>,
  universe: { endpointMap: EndpointMap; metaToolNames: readonly string[] },
): ToolPolicy {
  const { endpointMap, metaToolNames } = universe;
  const readOnly = parseReadOnly(env.MCP_READ_ONLY);
  const allow = parseList(env.MCP_TOOLS_ALLOW);
  const deny = parseList(env.MCP_TOOLS_DENY);

  const all = [...new Set([...Object.keys(endpointMap), ...metaToolNames])];
  const mode = (name: string) => classifyTool(name, endpointMap, metaToolNames);

  // Typos are fatal: validate against the full universe, not the read-only base.
  for (const [varName, entries] of [['MCP_TOOLS_ALLOW', allow], ['MCP_TOOLS_DENY', deny]] as const) {
    for (const entry of entries) {
      const m = compilePattern(entry);
      if (!all.some(m)) throw new ToolPolicyError(`${varName} entry "${entry}" matches no tool`);
    }
  }

  const base = new Set(readOnly ? all.filter((t) => mode(t) === 'read') : all);
  const readmitted: string[] = [];
  if (readOnly) {
    // Only an exact ALLOW name (no wildcard) re-admits a write tool.
    for (const entry of allow) {
      if (!entry.includes('*') && all.includes(entry) && !base.has(entry)) {
        base.add(entry);
        readmitted.push(entry);
      }
    }
  }

  const allowMatchers = allow.map(compilePattern);
  const denyMatchers = deny.map(compilePattern);
  const final = new Set(
    [...base].filter(
      (t) =>
        (allowMatchers.length === 0 || allowMatchers.some((m) => m(t))) &&
        !denyMatchers.some((m) => m(t)),
    ),
  );

  if (final.size === 0) throw new ToolPolicyError('tool filter leaves no tools registered');

  return {
    isRegistered: (name) => final.has(name),
    mode,
    summary: {
      readOnly,
      allow,
      deny,
      registered: final.size,
      total: all.length,
      readmittedWriteTools: readmitted.filter((t) => final.has(t)),
    },
  };
}

/** Registers everything; classification uses the real endpoint map. */
export function defaultToolPolicy(): ToolPolicy {
  const total = new Set([...Object.keys(TOOL_ENDPOINT_MAP), ...META_TOOL_NAMES]).size;
  return {
    isRegistered: () => true,
    mode: (name) => classifyTool(name, TOOL_ENDPOINT_MAP, META_TOOL_NAMES),
    summary: { readOnly: false, allow: [], deny: [], registered: total, total, readmittedWriteTools: [] },
  };
}

let active: ToolPolicy = defaultToolPolicy();

export function configureToolPolicy(p: ToolPolicy): void {
  active = p;
}

export function currentToolPolicy(): ToolPolicy {
  return active;
}
