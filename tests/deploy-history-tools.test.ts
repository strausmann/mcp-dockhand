import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

  it('takes name as a required string and runId as a required number', () => {
    expect(block).toMatch(/name:\s*z\.string\(\)\.describe/);
    expect(block).toMatch(/runId:\s*z\.number\(\)\.describe/);
  });
});

describe('delete_stack_deploy', () => {
  const block = extractToolBlock(stacksSource, 'delete_stack_deploy');

  it('targets DELETE /api/stacks/{name}/deploys/{runId}', () => {
    expect(block).toMatch(/client\.delete\(/);
    expect(block).toMatch(/\$\{encodePath\(name\)\}\/deploys\/\$\{encodePath\(runId\)\}`/);
  });

  it('takes name as a required string and runId as a required number', () => {
    expect(block).toMatch(/name:\s*z\.string\(\)\.describe/);
    expect(block).toMatch(/runId:\s*z\.number\(\)\.describe/);
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

  it('takes name as a required string and runId as a required number', () => {
    expect(block).toMatch(/name:\s*z\.string\(\)\.describe/);
    expect(block).toMatch(/runId:\s*z\.number\(\)\.describe/);
  });
});
