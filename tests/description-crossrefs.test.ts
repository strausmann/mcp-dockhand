/**
 * Hand-written tool references in `.describe()` text must resolve to a registered tool.
 *
 * Why this exists: #201 shipped `secretProviderId: ... (id from list_secret_providers)` one PR
 * BEFORE that tool existed. Nothing caught it — the missing tool is by definition not in the
 * diff, so a diff-scoped review cannot see it, and the spec-derived cross-reference machinery
 * (`CROSSREF_UNRESOLVED` in validate-mcp-tools.mjs) only covers references that come from the
 * OpenAPI spec, not ones we write by hand in a zod schema. It took an external reviewer.
 *
 * A dangling reference is worse than no reference: it advertises a discovery path that does
 * not exist, so a client following it fails at a step the description promised would work.
 *
 * Scope is deliberately narrow — identifiers in an explicit cross-reference position
 * (`from X`, `see X`, `use X`, `via X`). That is how these are actually phrased, and it keeps
 * the check free of false positives: header names, MIME types and env vars are snake_case too,
 * but nobody writes "from x_forwarded_for". Verified against the current tree: eight
 * candidates, all genuine tool names, zero false hits.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { registerAllTools } from '../src/tools/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, '..', 'src', 'tools');

/** Every tool name the server actually registers. */
function registeredToolNames(): Set<string> {
  const names = new Set<string>();
  const server = {
    tool: (name: string) => {
      names.add(name);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerAllTools(server as any, {} as any);
  return names;
}

/** `from list_environments`, `see get_stack_env`, `use remove_stack_env_vars`, ... */
const CROSSREF = /\b(?:from|see|use|via)\s+`?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`?/g;

interface Reference {
  file: string;
  tool: string;
}

function collectReferences(): Reference[] {
  const refs: Reference[] = [];
  for (const file of readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(TOOLS_DIR, file), 'utf-8');
    for (const match of source.matchAll(CROSSREF)) {
      refs.push({ file, tool: match[1] });
    }
  }
  return refs;
}

describe('hand-written tool cross-references', () => {
  it('finds references to check (guards against the regex silently matching nothing)', () => {
    // A test that scans for violations passes trivially when its scan is broken. This asserts
    // the scan still sees the corpus it is meant to police.
    expect(collectReferences().length).toBeGreaterThan(0);
  });

  it('every referenced tool is registered', () => {
    const registered = registeredToolNames();
    const dangling = collectReferences()
      .filter((r) => !registered.has(r.tool))
      // Keep it a set of distinct problems, but report where each one lives.
      .map((r) => `${r.tool} (referenced in src/tools/${r.file})`);

    expect([...new Set(dangling)]).toEqual([]);
  });
});
