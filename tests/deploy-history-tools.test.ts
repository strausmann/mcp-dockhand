import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { registerStackTools } from '../src/tools/stacks.js';
import { describeTool } from '../src/openapi/describe-tool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stacksSource = readFileSync(
  join(__dirname, '..', 'src', 'tools', 'stacks.ts'),
  'utf-8',
);

/**
 * Extract the registerTool(...) source block for a named tool. The block
 * spans from the registerTool(server, '<toolName>', ...) line to the next
 * registerTool( call (or end of file if last).
 */
function extractToolBlock(source: string, toolName: string): string {
  const startPattern = new RegExp(
    `registerTool\\s*\\(\\s*server\\s*,\\s*'${toolName}'`,
  );
  const startMatch = startPattern.exec(source);
  if (!startMatch) {
    throw new Error(`Tool '${toolName}' not found in source`);
  }
  const startIdx = startMatch.index;
  const afterStart = source.slice(startIdx + 1);
  const nextToolMatch = /registerTool\s*\(/.exec(afterStart);
  const endIdx = nextToolMatch
    ? startIdx + 1 + nextToolMatch.index
    : source.length;
  return source.slice(startIdx, endIdx);
}

/**
 * Dockhand 1.0.47 added a stack deploy history feature (Finsys/dockhand#1499):
 * every stack deploy is recorded as a `stack_deploy` schedule_execution row, with
 * its protocol text stored separately on disk. Four endpoints expose it:
 *
 *   GET    /api/stacks/{name}/deploys            -> list_stack_deploys
 *   GET    /api/stacks/{name}/deploys/{runId}     -> get_stack_deploy
 *   DELETE /api/stacks/{name}/deploys/{runId}     -> delete_stack_deploy
 *   GET    /api/stacks/{name}/deploys/{runId}/log -> get_stack_deploy_log
 *
 * Ground-truthed against the real v1.0.47 handlers
 * (src/routes/api/stacks/[name]/deploys/**\/+server.ts,
 * src/lib/server/deploy-run-access.ts) — see the dockhand-mcp-dev skill's Ground
 * Truth rule.
 */
describe('list_stack_deploys', () => {
  const block = extractToolBlock(stacksSource, 'list_stack_deploys');

  it('targets GET /api/stacks/{name}/deploys', () => {
    expect(block).toMatch(/client\.get\(/);
    expect(block).toMatch(/\$\{encodePath\(name\)\}\/deploys`/);
  });

  it('takes name as a required string and environmentId as an optional number', () => {
    expect(block).toMatch(/name:\s*z\.string\(\)\.describe/);
    expect(block).toMatch(/environmentId:\s*z\.number\(\)\.optional\(\)\.describe/);
  });

  it('sends environmentId as the ?env= query param, omitted (not "null") when absent', () => {
    // client.get's buildUrl() drops an undefined param entirely -- the handler
    // treats an OMITTED env param the same as the literal string "null" (both
    // resolve to the local/default environment), so there is no need to send
    // the string "null" explicitly.
    expect(block).toMatch(/\{\s*env:\s*environmentId\s*\}/);
    expect(block).not.toMatch(/env:\s*environmentId\s*\?\?\s*'null'/);
  });
});

describe('get_stack_deploy', () => {
  const block = extractToolBlock(stacksSource, 'get_stack_deploy');

  it('targets GET /api/stacks/{name}/deploys/{runId}', () => {
    expect(block).toMatch(/client\.get\(/);
    expect(block).toMatch(/\$\{encodePath\(name\)\}\/deploys\/\$\{encodePath\(runId\)\}`/);
  });

  it('takes name as a required string and runId as a required integer', () => {
    expect(block).toMatch(/name:\s*z\.string\(\)\.describe/);
    expect(block).toMatch(/runId:\s*z\.number\(\)\.int\(\)\.describe/);
  });
});

describe('delete_stack_deploy', () => {
  const block = extractToolBlock(stacksSource, 'delete_stack_deploy');

  it('targets DELETE /api/stacks/{name}/deploys/{runId}', () => {
    expect(block).toMatch(/client\.delete\(/);
    expect(block).toMatch(/\$\{encodePath\(name\)\}\/deploys\/\$\{encodePath\(runId\)\}`/);
  });

  it('takes name as a required string and runId as a required integer', () => {
    expect(block).toMatch(/name:\s*z\.string\(\)\.describe/);
    expect(block).toMatch(/runId:\s*z\.number\(\)\.int\(\)\.describe/);
  });
});

describe('get_stack_deploy_log', () => {
  const block = extractToolBlock(stacksSource, 'get_stack_deploy_log');

  it('targets GET /api/stacks/{name}/deploys/{runId}/log', () => {
    expect(block).toMatch(/client\.get\(/);
    expect(block).toMatch(/\$\{encodePath\(name\)\}\/deploys\/\$\{encodePath\(runId\)\}\/log`/);
  });

  it('does not use a generic type argument on client.get (invisible to the tool-endpoint-map / coverage extractors — see generate-tool-endpoint-map.mjs case (1))', () => {
    expect(block).not.toMatch(/client\.get<[^>]+>\(/);
  });

  it('returns the log as plain text via textResponse (never jsonResponse)', () => {
    expect(block).toMatch(/textResponse\(/);
    expect(block).not.toMatch(/jsonResponse\(/);
  });

  it('takes name as a required string and runId as a required integer', () => {
    expect(block).toMatch(/name:\s*z\.string\(\)\.describe/);
    expect(block).toMatch(/runId:\s*z\.number\(\)\.int\(\)\.describe/);
  });
});

/**
 * Copilot review finding on PR #258 (verified against the code): `runId: z.number()` accepts
 * a non-integer like `12.5`, which Dockhand's `parseInt(params.runId, 10)` (upstream handler)
 * silently truncates to `12`. For `delete_stack_deploy` — which DELETEs a specific run — that
 * means a caller-supplied `12.5` can silently delete the WRONG run's deploy record. Fixed by
 * adding `.int()` to the runId schema on all three run-scoped deploy-history tools.
 *
 * These tests exercise the ACTUAL Zod schema object (via z.object(schema).safeParse()), not a
 * source-text regex — a regex match on `.int()` proves the token is present, not that Zod
 * actually rejects a non-integer at runtime. Run once against the pre-fix source (plain
 * `z.number()`, no `.int()`) to confirm the "rejects 12.5" assertions fail there — that is the
 * counter-check required for a fixed validation bug: a test that would also pass against the
 * unfixed schema proves nothing.
 */
describe('runId schema validation (integer-only, Copilot review finding on #258)', () => {
  type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
  type ZodShape = Record<string, z.ZodTypeAny>;

  function captureSchemas(): Map<string, ZodShape> {
    const schemas = new Map<string, ZodShape>();
    const server = {
      tool: (name: string, _description: string, schema: ZodShape, _cb: ToolHandler) => {
        schemas.set(name, schema);
      },
    };
    const client = {
      get: vi.fn(),
      delete: vi.fn(),
      post: vi.fn(),
      postSSE: vi.fn(),
      put: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerStackTools(server as any, client as any);
    return schemas;
  }

  const RUN_SCOPED_TOOLS = ['get_stack_deploy', 'delete_stack_deploy', 'get_stack_deploy_log'];

  it.each(RUN_SCOPED_TOOLS)('%s: accepts an integer runId', (toolName) => {
    const schemas = captureSchemas();
    const shape = schemas.get(toolName);
    if (!shape) throw new Error(`${toolName} was not registered`);
    const result = z.object(shape).safeParse({ name: 'demo', runId: 12 });
    expect(result.success).toBe(true);
  });

  it.each(RUN_SCOPED_TOOLS)('%s: rejects a non-integer runId like 12.5', (toolName) => {
    const schemas = captureSchemas();
    const shape = schemas.get(toolName);
    if (!shape) throw new Error(`${toolName} was not registered`);
    const result = z.object(shape).safeParse({ name: 'demo', runId: 12.5 });
    expect(result.success).toBe(false);
  });

  it('list_stack_deploys has no runId field to begin with (untouched by this fix)', () => {
    const schemas = captureSchemas();
    const shape = schemas.get('list_stack_deploys');
    if (!shape) throw new Error('list_stack_deploys was not registered');
    expect(shape.runId).toBeUndefined();
  });
});

/**
 * `get_stack_deploy_log` can carry secrets that survived Dockhand's own log redaction (see the
 * tool's inline comment in stacks.ts) — the endpoint's own summary reads as a plain "fetch the
 * log", so the operator-safety suffix (description-suffixes.ts, category 2: a response that
 * returns secrets where the summary reads as safe) carries the warning instead.
 */
describe('get_stack_deploy_log operator-safety suffix', () => {
  it('warns that the log can carry secrets that survived redaction', () => {
    const description = describeTool('get_stack_deploy_log');

    expect(description).toMatch(/SECURITY/);
    expect(description).toMatch(/redact/i);
    expect(description).toMatch(/get_stack_deploy\b/);
  });

  it('appends to the derived description instead of replacing it (suffix, not override)', () => {
    const description = describeTool('get_stack_deploy_log');

    expect(description.indexOf('SECURITY')).toBeGreaterThan(0);
    expect(description).not.toBe('No description available.');
  });

  it('the sibling deploy-history tools carry no secret-log suffix', () => {
    expect(describeTool('list_stack_deploys')).not.toMatch(/SECURITY: this returns the recorded deploy log/);
    expect(describeTool('get_stack_deploy')).not.toMatch(/SECURITY: this returns the recorded deploy log/);
    expect(describeTool('delete_stack_deploy')).not.toMatch(/SECURITY: this returns the recorded deploy log/);
  });
});
