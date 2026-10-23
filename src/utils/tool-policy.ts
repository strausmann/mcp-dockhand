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

/** GET endpoints that nonetheless change state (trigger a git stack deploy). */
export const WRITE_GET_TOOLS: readonly string[] = ['trigger_git_webhook'];

/** POST endpoints that only validate, preview or read (POST for transport reasons). */
export const READ_ONLY_POST_TOOLS: readonly string[] = [
  'validate_stack_compose',
  'validate_stack_env',
  'validate_stack_path',
  'check_stack_path_change',
  'preview_backup_restore',
  'batch_get_selfhst_icons',
  'list_git_remote_branches',
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
