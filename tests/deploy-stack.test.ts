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
 * Regression cover for #117: deploy_stack used to POST with no request body.
 * Dockhand's handler destructures pull/build/forceRecreate out of that body —
 * unguarded before 1.0.38 (HTML 500, nothing deployed) and defaulting to a
 * pull-less deploy afterwards. The body is therefore mandatory, not cosmetic.
 */
describe('deploy_stack', () => {
  const block = extractToolBlock(stacksSource, 'deploy_stack');

  it('targets POST /api/stacks/{name}/deploy over SSE', () => {
    expect(block).toMatch(/client\.postSSE\(/);
    expect(block).toMatch(/\$\{encodePath\(name\)\}\/deploy/);
  });

  it('never sends an undefined body (the #117 regression)', () => {
    expect(block).not.toMatch(/\/deploy`\s*,\s*undefined/);
  });

  it('sends pull, build and forceRecreate in the request body', () => {
    expect(block).toMatch(/pull:\s*pull\s*\?\?/);
    expect(block).toMatch(/build:\s*build\s*\?\?/);
    expect(block).toMatch(/forceRecreate:\s*forceRecreate\s*\?\?/);
    expect(block).toMatch(/\/deploy`\s*,\s*body\s*,/);
  });

  it('defaults to the web UI Deploy popover values (pull on, build and forceRecreate off)', () => {
    expect(block).toMatch(/pull:\s*pull\s*\?\?\s*true/);
    expect(block).toMatch(/build:\s*build\s*\?\?\s*false/);
    expect(block).toMatch(/forceRecreate:\s*forceRecreate\s*\?\?\s*false/);
  });

  it('declares the three options as optional booleans', () => {
    for (const opt of ['pull', 'build', 'forceRecreate']) {
      expect(block).toMatch(
        new RegExp(`${opt}:\\s*z\\.boolean\\(\\)\\.optional\\(\\)\\.describe`),
      );
    }
  });

  it('keeps passing the environment as the ?env= query param', () => {
    expect(block).toMatch(/\{\s*env:\s*environmentId\s*\}/);
  });
});
