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
  // Skip the current match and search for the NEXT registerTool(
  const afterStart = source.slice(startIdx + 1);
  const nextToolMatch = /registerTool\s*\(/.exec(afterStart);
  const endIdx = nextToolMatch
    ? startIdx + 1 + nextToolMatch.index
    : source.length;
  return source.slice(startIdx, endIdx);
}

describe('update_stack_env_raw (new tool)', () => {
  it('is registered in stacks.ts', () => {
    expect(stacksSource).toContain("'update_stack_env_raw'");
  });

  it('targets PUT /api/stacks/{name}/env/raw', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env_raw');
    expect(block).toMatch(/client\.put\(/);
    expect(block).toMatch(/\/env\/raw['`]/);
  });

  it('wraps the stack name through encodePath()', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env_raw');
    expect(block).toMatch(/\$\{encodePath\(name\)\}\/env\/raw/);
  });

  it('declares content as a required string parameter', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env_raw');
    expect(block).toMatch(/content:\s*z\.string\(\)\.describe/);
    expect(block).not.toMatch(/content:\s*z\.string\(\)\.optional/);
  });

  it('sends {content} as the request body', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env_raw');
    expect(block).toMatch(/\{\s*content\s*\}/);
  });
});

describe('update_stack_env (rawContent cleanup)', () => {
  it('no longer declares the rawContent parameter', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env');
    expect(block).not.toContain('rawContent');
  });

  it('no longer maps rawContent into the request body', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env');
    expect(block).not.toMatch(/body\.rawContent/);
  });

  it('sends {variables} directly as the request body', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env');
    expect(block).toMatch(/\{\s*variables\s*\}/);
  });

  it('declares variables as a required parameter', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env');
    // variables array should NOT have .optional() chained
    expect(block).not.toMatch(/variables:\s*z\.array\([\s\S]*?\}\)\s*\)\.optional/);
  });

  it('description references update_stack_env_raw for non-secret writes', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env');
    expect(block).toMatch(/update_stack_env_raw/);
  });
});
