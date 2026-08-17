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
 * ## Why there are two scans
 *
 * Detecting "this identifier is meant as a tool reference" needs an anchor, because header
 * names, MIME types and env vars are snake_case too — nobody writes "from x_forwarded_for",
 * so the phrasing carries the intent. But a fixed phrasing list rots: the first version of
 * this test recognised `from|see|use|via`, case-sensitively, and therefore saw 15 of the 18
 * references actually present — `See get_git_stack_env_files` (capitalised) and `as returned
 * by list_templates` were invisible to it. A check that silently ignores a fifth of its
 * subject is the "gate that cannot fire" pattern, and it was caught by a reviewer rather than
 * by the check itself.
 *
 * So the anchored scan is paired with a phrasing-free one:
 *
 *   - `mentionedTools()` finds every REGISTERED tool name in a describe string. No phrasing
 *     assumption, therefore no blind spot — but it cannot detect a dangling reference, since
 *     it only matches names that exist.
 *   - `anchoredReferences()` finds identifiers in a cross-reference position. It CAN detect a
 *     dangling reference, but only in a phrasing it knows.
 *
 * Asserting that every mention is also anchored keeps the phrasing list honest: introduce a
 * new turn of phrase and this test fails, pointing at the exact line, before that phrasing has
 * a chance to hide a broken reference.
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

/**
 * Cross-reference position. Case-insensitive, and `by` covers "as returned by X" / "provided
 * by X". Derived from the phrasings actually present in the tree, not guessed — extend it when
 * the coverage assertion below says a mention was missed.
 */
const CROSSREF = /\b(?:from|see|use|via|by)\s+`?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`?/gi;
const SNAKE_CASE = /`?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`?/g;

interface Reference {
  where: string;
  tool: string;
}

/** Runs `scan` over every `.describe()` line in src/tools, skipping self-registrations. */
function scanDescribeLines(scan: RegExp, keep: (name: string) => boolean): Reference[] {
  const found: Reference[] = [];
  for (const file of readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'))) {
    const lines = readFileSync(join(TOOLS_DIR, file), 'utf-8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('.describe(')) return;
      for (const match of line.matchAll(scan)) {
        const tool = match[1].toLowerCase();
        // A tool's own registration line is a definition, not a reference.
        if (line.includes(`registerTool(server, '${tool}'`)) continue;
        if (!keep(tool)) continue;
        found.push({ where: `src/tools/${file}:${i + 1}`, tool });
      }
    });
  }
  return found;
}

const key = (r: Reference) => `${r.tool} (${r.where})`;

describe('hand-written tool cross-references', () => {
  const registered = registeredToolNames();
  const anchored = scanDescribeLines(CROSSREF, () => true);
  const mentioned = scanDescribeLines(SNAKE_CASE, (name) => registered.has(name));

  it('finds references to check (guards against the scan silently matching nothing)', () => {
    // A test that scans for violations passes trivially when its scan is broken. This asserts
    // the scan still sees the corpus it is meant to police.
    expect(anchored.length).toBeGreaterThan(0);
  });

  it('every referenced tool is registered', () => {
    const dangling = anchored.filter((r) => !registered.has(r.tool)).map(key);

    expect([...new Set(dangling)].sort()).toEqual([]);
  });

  it('recognises every phrasing actually in use — extend CROSSREF when this fails', () => {
    // Phrasing-free scan vs. anchored scan. A mention the anchor missed means someone wrote a
    // reference in a turn of phrase this test does not know, and a BROKEN reference in that
    // same phrasing would slip through unnoticed.
    const anchoredKeys = new Set(anchored.map(key));
    const unrecognised = mentioned.map(key).filter((k) => !anchoredKeys.has(k));

    expect([...new Set(unrecognised)].sort()).toEqual([]);
  });
});
