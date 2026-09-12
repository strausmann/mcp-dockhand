import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stacksSource = readFileSync(
  join(__dirname, '..', 'src', 'tools', 'stacks.ts'),
  'utf-8',
);

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
 * `deploy_stack` (POST /api/stacks/{name}/deploy) has always accepted
 * pull/build/forceRecreate. Ground-truthed against the real v1.0.47 handlers
 * (src/routes/api/stacks/+server.ts POST, src/routes/api/stacks/[name]/compose/
 * +server.ts PUT), `create_stack` (POST /api/stacks, when `start` is not false)
 * and `update_stack_compose` (PUT /api/stacks/{name}/compose, when `restart` is
 * true) read the SAME three fields out of their own request bodies -- without
 * them a stack whose compose declares a `build:` section silently never builds
 * on create, and never rebuilds on a save-and-redeploy.
 *
 * Both endpoints treat an OMITTED field as its own Dockhand-side default
 * (never a client-side default baked into this tool) -- unlike deploy_stack,
 * whose body is unconditionally present already (name/compose or content are
 * always required fields), so there is no equivalent of the #117 "empty body"
 * risk here; a plain conditional include (matching the existing composePath/
 * envPath/secretProviderId style in both tools) is the correct, minimal
 * addition.
 */
describe('create_stack pull/build/forceRecreate parity (Finsys/dockhand POST /api/stacks)', () => {
  const block = extractToolBlock(stacksSource, 'create_stack');

  it('declares pull, build and forceRecreate as optional booleans', () => {
    for (const opt of ['pull', 'build', 'forceRecreate']) {
      expect(block).toMatch(
        new RegExp(`${opt}:\\s*z\\.boolean\\(\\)\\.optional\\(\\)\\.describe`),
      );
    }
  });

  it('forwards pull, build and forceRecreate into the request body only when given', () => {
    expect(block).toMatch(/if\s*\(\s*pull\s*!==\s*undefined\s*\)\s*body\.pull\s*=\s*pull/);
    expect(block).toMatch(/if\s*\(\s*build\s*!==\s*undefined\s*\)\s*body\.build\s*=\s*build/);
    expect(block).toMatch(/if\s*\(\s*forceRecreate\s*!==\s*undefined\s*\)\s*body\.forceRecreate\s*=\s*forceRecreate/);
  });

  it('destructures pull, build and forceRecreate out of the callback args', () => {
    expect(block).toMatch(/async\s*\(\s*\{[^}]*\bpull\b[^}]*\bbuild\b[^}]*\bforceRecreate\b[^}]*\}\s*\)/s);
  });
});

describe('update_stack_compose pull/build/forceRecreate parity (Finsys/dockhand PUT /api/stacks/{name}/compose)', () => {
  const block = extractToolBlock(stacksSource, 'update_stack_compose');

  it('declares pull, build and forceRecreate as optional booleans', () => {
    for (const opt of ['pull', 'build', 'forceRecreate']) {
      expect(block).toMatch(
        new RegExp(`${opt}:\\s*z\\.boolean\\(\\)\\.optional\\(\\)\\.describe`),
      );
    }
  });

  it('forwards pull, build and forceRecreate into the request body only when given', () => {
    expect(block).toMatch(/if\s*\(\s*pull\s*!==\s*undefined\s*\)\s*body\.pull\s*=\s*pull/);
    expect(block).toMatch(/if\s*\(\s*build\s*!==\s*undefined\s*\)\s*body\.build\s*=\s*build/);
    expect(block).toMatch(/if\s*\(\s*forceRecreate\s*!==\s*undefined\s*\)\s*body\.forceRecreate\s*=\s*forceRecreate/);
  });

  it('destructures pull, build and forceRecreate out of the callback args', () => {
    expect(block).toMatch(/async\s*\(\s*\{[^}]*\bpull\b[^}]*\bbuild\b[^}]*\bforceRecreate\b[^}]*\}\s*\)/s);
  });

  it('still only redeploys via putSSE when restart is truthy (unchanged behavior)', () => {
    expect(block).toMatch(/if\s*\(\s*restart\s*\)\s*\{/);
    expect(block).toMatch(/client\.putSSE\(/);
  });
});
