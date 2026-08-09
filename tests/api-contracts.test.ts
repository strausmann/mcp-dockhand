import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stacksSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'stacks.ts'), 'utf-8');
const systemSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'system.ts'), 'utf-8');
const usersSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'users.ts'), 'utf-8');
const containersSource = readFileSync(join(__dirname, '..', 'src', 'tools', 'containers.ts'), 'utf-8');

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

describe('Dockhand API contract alignment', () => {
  it('create_stack exposes and forwards composePath and envPath', () => {
    const block = extractToolBlock(stacksSource, 'create_stack');
    expect(block).toMatch(/composePath:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/envPath:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/body\.composePath\s*=\s*composePath/);
    expect(block).toMatch(/body\.envPath\s*=\s*envPath/);
  });

  it('adopt_stack sends environmentId and stacks[] with composePath in the body', () => {
    const block = extractToolBlock(stacksSource, 'adopt_stack');
    expect(block).toMatch(/composePath:\s*z\.string\(\)/);
    expect(block).toMatch(/envPath:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/sourceDir:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/environmentId,\s*\n\s*stacks:\s*\[stack\]/);
    expect(block).toMatch(/client\.post\('\/api\/stacks\/adopt'/);
    expect(block).not.toMatch(/\{\s*env:\s*environmentId\s*\}/);
  });

  it('relocate_stack sends oldDir, newComposePath and optional newEnvPath', () => {
    const block = extractToolBlock(stacksSource, 'relocate_stack');
    expect(block).toMatch(/oldDir:\s*z\.string\(\)/);
    expect(block).toMatch(/newComposePath:\s*z\.string\(\)/);
    expect(block).toMatch(/newEnvPath:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/\{\s*oldDir,\s*newComposePath\s*\}/);
    expect(block).toMatch(/body\.newEnvPath\s*=\s*newEnvPath/);
    expect(block).not.toMatch(/\{\s*path:\s*newPath\s*\}/);
  });

  it('stack path helpers include name and use newComposePath for path-change checks', () => {
    const hints = extractToolBlock(stacksSource, 'get_stack_path_hints');
    const defaultPath = extractToolBlock(stacksSource, 'get_stack_default_path');
    const check = extractToolBlock(stacksSource, 'check_stack_path_change');
    for (const block of [hints, defaultPath]) {
      expect(block).toMatch(/name:\s*z\.string\(\)/);
      expect(block).toMatch(/\{\s*env:\s*environmentId,\s*name\s*\}/);
    }
    expect(check).toMatch(/newComposePath:\s*z\.string\(\)/);
    expect(check).toMatch(/\{\s*newComposePath\s*\}/);
    expect(check).not.toMatch(/\{\s*path:\s*newPath\s*\}/);
  });

  it('get_system_disk is scoped to an environment', () => {
    const block = extractToolBlock(systemSource, 'get_system_disk');
    expect(block).toMatch(/environmentId:\s*z\.number\(\)/);
    expect(block).toMatch(/client\.get\('\/api\/system\/disk',\s*\{\s*env:\s*environmentId\s*\}\)/);
  });

  it('favorites and favorite groups are environment-scoped reorder operations', () => {
    const getFavorites = extractToolBlock(usersSource, 'get_favorites');
    const setFavorites = extractToolBlock(usersSource, 'set_favorites');
    const getGroups = extractToolBlock(usersSource, 'get_favorite_groups');
    const setGroups = extractToolBlock(usersSource, 'set_favorite_groups');

    for (const block of [getFavorites, getGroups]) {
      expect(block).toMatch(/environmentId:\s*z\.number\(\)/);
      expect(block).toMatch(/\{\s*env:\s*environmentId\s*\}/);
    }
    expect(setFavorites).toMatch(/environmentId,\s*\n\s*action:\s*'reorder',\s*\n\s*favorites/);
    expect(setGroups).toMatch(/environmentId,\s*\n\s*action:\s*'reorder',\s*\n\s*groups/);
  });

  it('exec_container matches the real /api/containers/{id}/exec contract: envId query param, shell+user body only', () => {
    // Ground truth (Finsys/dockhand src/routes/api/containers/[id]/exec/+server.ts, unchanged
    // since the route's initial commit through v1.0.41): the handler reads `envId` from the
    // query string (not `env`, unlike every sibling containers endpoint), and only reads
    // `body.shell` (default '/bin/sh') and `body.user` (default 'root') — it creates a Docker
    // exec instance for WebSocket terminal attachment and returns { execId, connectionInfo }.
    // It never reads body.command/workingDir/tty and never executes or captures output for an
    // arbitrary command — there is no REST endpoint upstream that does that (see issue #81).
    const block = extractToolBlock(containersSource, 'exec_container');

    // Query param must be envId, not env (the one endpoint in the cluster that differs).
    expect(block).toMatch(/\{\s*envId:\s*environmentId\s*\}/);
    expect(block).not.toMatch(/\{\s*env:\s*environmentId\s*\}/);

    // Only fields the real handler reads may be sent.
    expect(block).toMatch(/shell:\s*z\.string\(\)\.optional\(\)/);
    expect(block).toMatch(/user:\s*z\.string\(\)\.optional\(\)/);
    expect(block).not.toMatch(/command:\s*z\.array/);
    expect(block).not.toMatch(/workingDir:\s*z\.string/);
    expect(block).not.toMatch(/tty:\s*z\.boolean/);
    expect(block).not.toMatch(/body\.command/);
    expect(block).not.toMatch(/body\.workingDir/);
    expect(block).not.toMatch(/body\.tty/);

    // Description must not promise one-shot command execution/output the API cannot deliver.
    expect(block).not.toMatch(/Execute a one-shot command/i);
    expect(block).toMatch(/does not run|cannot run|no.*output|terminal attach/i);
  });
});
