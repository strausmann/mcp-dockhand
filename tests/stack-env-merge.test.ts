/**
 * Static analysis tests for the update_stack_env merge-semantic implementation.
 *
 * Background: The Dockhand REST endpoint PUT /api/stacks/{name}/env has
 * replace-semantics — sending a partial variable list silently deletes all
 * other variables. This test suite verifies that the MCP tool wrapper adds a
 * merge layer so that partial updates do not cause data loss.
 *
 * See: https://github.com/strausmann/mcp-dockhand/issues/<issue>
 * Incident: hangar-print-hub stack (2026-06-01), 7 of 8 variables deleted by
 * a single-key update_stack_env call.
 */

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

describe('update_stack_env — merge-semantic implementation', () => {
  const block = extractToolBlock(stacksSource, 'update_stack_env');

  describe('mode parameter', () => {
    it('declares a mode parameter with z.enum', () => {
      expect(block).toMatch(/mode:\s*z\.enum\s*\(\s*\[/);
    });

    it('mode enum includes "merge" and "replace"', () => {
      // Both values must appear in the enum declaration
      expect(block).toMatch(/'merge'/);
      expect(block).toMatch(/'replace'/);
    });

    it('mode is optional (defaults to "merge")', () => {
      // .optional() is chained on the enum
      expect(block).toMatch(/z\.enum\s*\(\s*\[[\s\S]*?\]\s*\)\s*\.optional\(\)/);
    });

    it('default value is "merge" in the handler destructuring', () => {
      // Handler must default mode to 'merge': mode = 'merge'
      expect(block).toMatch(/mode\s*=\s*['"]merge['"]/);
    });
  });

  describe('merge path — GET then PUT', () => {
    it('calls client.get to fetch existing variables when merging', () => {
      // Must call client.get for the /env endpoint
      expect(block).toMatch(/client\.get\s*</);
      expect(block).toMatch(/\/api\/stacks\/\$\{encodePath\(name\)\}\/env/);
    });

    it('uses a Map to merge variables by key', () => {
      // Key-based deduplication via Map
      expect(block).toMatch(/new\s+Map\s*</);
    });

    it('iterates over incoming variables and sets them in the Map', () => {
      // mergedByKey.set(v.key, v) pattern
      expect(block).toMatch(/mergedByKey\.set\s*\(\s*v\.key\s*,\s*v\s*\)/);
    });

    it('converts the Map back to an array for the PUT body', () => {
      // Array.from(mergedByKey.values())
      expect(block).toMatch(/Array\.from\s*\(\s*mergedByKey\.values\s*\(\s*\)\s*\)/);
    });
  });

  describe('replace path — PUT without GET', () => {
    it('assigns variables directly in replace mode without a GET call', () => {
      // replace branch: finalVariables = variables
      expect(block).toMatch(/finalVariables\s*=\s*variables/);
    });
  });

  describe('PUT call — always uses finalVariables', () => {
    it('PUT body references finalVariables, not the raw input variables', () => {
      // The PUT must use finalVariables as the payload
      expect(block).toMatch(/variables:\s*finalVariables/);
    });

    it('PUT targets the correct /env endpoint with encodePath', () => {
      expect(block).toMatch(/client\.put\s*\(/);
      expect(block).toMatch(/\/api\/stacks\/\$\{encodePath\(name\)\}\/env['"`,]/);
    });

    it('passes environmentId as env query parameter on PUT', () => {
      expect(block).toMatch(/env:\s*environmentId/);
    });
  });

  describe('description — documents the merge-default behaviour', () => {
    it('tool description explains the Dockhand replace-semantics risk', () => {
      expect(block).toMatch(/replace.semantics|replace-semantics/i);
    });

    it('tool description mentions the merge default', () => {
      expect(block).toMatch(/mode="merge"|mode=.merge./i);
    });

    it('tool description mentions the replace opt-in', () => {
      expect(block).toMatch(/mode="replace"|mode=.replace./i);
    });
  });

  describe('type safety', () => {
    it('imports StackEnv type from dockhand types', () => {
      expect(stacksSource).toMatch(/import\s+type\s+\{[^}]*StackEnv[^}]*\}/);
    });

    it('imports EnvVariable type from dockhand types', () => {
      expect(stacksSource).toMatch(/import\s+type\s+\{[^}]*EnvVariable[^}]*\}/);
    });

    it('uses typed GET for the existing variables fetch', () => {
      // client.get<StackEnv>(...)
      expect(block).toMatch(/client\.get\s*<\s*StackEnv\s*>/);
    });

    it('declares finalVariables with EnvVariable[] type', () => {
      expect(block).toMatch(/finalVariables:\s*EnvVariable\[\]/);
    });
  });
});

describe('update_stack_env — existing contract not broken', () => {
  const block = extractToolBlock(stacksSource, 'update_stack_env');

  it('still declares variables as a required array parameter', () => {
    expect(block).toMatch(/variables:\s*z\.array\(/);
    // Must NOT be optional
    expect(block).not.toMatch(/variables:\s*z\.array\([\s\S]*?\}\s*\)\s*\)\s*\.optional/);
  });

  it('still references update_stack_env_raw for non-secret writes', () => {
    expect(block).toMatch(/update_stack_env_raw/);
  });

  it('variable schema still includes key, value, and optional isSecret', () => {
    expect(block).toMatch(/key:\s*z\.string\(\)/);
    expect(block).toMatch(/value:\s*z\.string\(\)/);
    expect(block).toMatch(/isSecret:\s*z\.boolean\(\)\.optional\(\)/);
  });
});
