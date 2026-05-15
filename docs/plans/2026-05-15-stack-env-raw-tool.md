# Stack Env Raw Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `update_stack_env_raw` MCP tool wrapping `PUT /api/stacks/{name}/env/raw`, drop the non-functional `rawContent` parameter from `update_stack_env`, and delete the orphaned `docs/dockhand-api-baseline.json` snapshot.

**Architecture:** Pure additions and removals in `src/tools/stacks.ts` plus a single new static-analysis test file `tests/stack-env-tools.test.ts`. No new module boundaries. CHANGELOG and version are managed automatically by `semantic-release` from the Conventional Commit history — do not edit them manually.

**Tech Stack:** TypeScript strict + Zod v4 + @modelcontextprotocol/sdk + Vitest + Node 22. Husky pre-commit (lint+typecheck) + commit-msg (commitlint) hooks active.

**Spec:** `/tmp/mcp-dockhand/docs/designs/2026-05-15-stack-env-raw-tool-design.md` (commit `4406621`)

**Issue:** [strausmann/mcp-dockhand#56](https://github.com/strausmann/mcp-dockhand/issues/56)

**Branch:** `fix/issue-56-stack-env-raw-tool` (already created off main, spec committed)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/tools/stacks.ts` | Modify | Add new tool registration, strip `rawContent` from `update_stack_env` |
| `tests/stack-env-tools.test.ts` | Create | Static-analysis tests for both tool changes |
| `docs/dockhand-api-baseline.json` | Delete | Orphaned 2026-03-29 snapshot, no longer referenced |
| `CHANGELOG.md` | **Do NOT touch** | Managed by `@semantic-release/changelog` on main merge |
| `package.json` (version field) | **Do NOT touch** | Managed by `@semantic-release/git` on main merge |

Commit-message types drive the next release:
- `feat(stacks): add update_stack_env_raw …` → minor bump
- `fix(stacks): remove non-functional rawContent …` → no additional bump (already covered by feat)
- `chore(docs): remove orphan baseline.json` → no bump
- `test(stacks): …` → no bump (covered by feat commit)

`scripts/validate-mcp-tools.mjs` will pick up the new tool on its next daily run; no manual schema regeneration required.

---

## Task 1: Add `update_stack_env_raw` tool (TDD)

**Files:**
- Create: `/tmp/mcp-dockhand/tests/stack-env-tools.test.ts`
- Modify: `/tmp/mcp-dockhand/src/tools/stacks.ts` (insert after line 165, immediately following `get_stack_env_raw`)

- [ ] **Step 1.1: Create the test file with the new-tool assertions (will fail — tool not yet present)**

Write `/tmp/mcp-dockhand/tests/stack-env-tools.test.ts`:

```typescript
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
    // Required = z.string() with no .optional() chained
    expect(block).toMatch(/content:\s*z\.string\(\)\.describe/);
    expect(block).not.toMatch(/content:\s*z\.string\(\)\.optional/);
  });

  it('sends {content} as the request body', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env_raw');
    // Look for client.put(..., { content }, ...) or equivalent
    expect(block).toMatch(/\{\s*content\s*\}/);
  });
});
```

- [ ] **Step 1.2: Run the test to confirm RED**

Run:
```bash
cd /tmp/mcp-dockhand && npx vitest run tests/stack-env-tools.test.ts
```

Expected: All 5 assertions FAIL — `update_stack_env_raw` does not exist yet, `extractToolBlock` throws `Tool 'update_stack_env_raw' not found in source`.

- [ ] **Step 1.3: Add the tool to `src/tools/stacks.ts`**

Insert the following block in `/tmp/mcp-dockhand/src/tools/stacks.ts` immediately after the existing `get_stack_env_raw` registration (which ends at line 165 with `);` followed by a blank line). The new block goes between lines 165 and 167 (the existing `validate_stack_env`).

```typescript
  registerTool(server, 'update_stack_env_raw',
    'Write the raw .env file of a stack to disk. Use this for non-secret variables that Docker Compose reads at container start. For secrets that should be encrypted in the Dockhand database and injected via shell-env at deploy time, use update_stack_env with isSecret:true on each variable.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      content: z.string().describe('Full .env file content. Empty string deletes the .env file on disk.'),
    },
    async ({ environmentId, name, content }) => {
      return jsonResponse(await client.put(
        `/api/stacks/${encodePath(name)}/env/raw`,
        { content },
        { env: environmentId },
      ));
    }
  );

```

- [ ] **Step 1.4: Run the test to confirm GREEN**

Run:
```bash
cd /tmp/mcp-dockhand && npx vitest run tests/stack-env-tools.test.ts
```

Expected: All 5 assertions PASS.

- [ ] **Step 1.5: Run the path-encoding test to confirm the new endpoint also satisfies the repo-wide convention**

Run:
```bash
cd /tmp/mcp-dockhand && npx vitest run tests/path-encoding.test.ts
```

Expected: All assertions PASS (the new endpoint uses `${encodePath(name)}` per spec, so the repo-wide check confirms it).

- [ ] **Step 1.6: Run typecheck**

Run:
```bash
cd /tmp/mcp-dockhand && npm run typecheck
```

Expected: Exit 0, no errors.

- [ ] **Step 1.7: Stage and commit (test + impl together)**

```bash
cd /tmp/mcp-dockhand
git add tests/stack-env-tools.test.ts src/tools/stacks.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" commit -m "$(cat <<'EOF'
feat(stacks): add update_stack_env_raw tool

Wraps PUT /api/stacks/{name}/env/raw so callers can write the on-disk
.env file that Docker Compose reads at container start. Complements the
existing update_stack_env (which targets the secrets/database layer
only) — the two endpoints are intentionally split upstream for security
reasons (secrets never touch the .env file on disk).

Closes the highest-impact MISSING_TOOL entry that has been flagged by
the daily validator since the schema-sync workflow went live.

Static-analysis tests in tests/stack-env-tools.test.ts assert tool
registration, correct endpoint, encodePath wrapping, required content
parameter, and request-body shape.

Refs #56
EOF
)"
```

Expected output: Commit hash + `1 file changed` summary for stacks.ts and `1 file changed` for the test file.

---

## Task 2: Remove `rawContent` parameter from `update_stack_env` (TDD)

**Files:**
- Modify: `/tmp/mcp-dockhand/tests/stack-env-tools.test.ts` (append new describe block)
- Modify: `/tmp/mcp-dockhand/src/tools/stacks.ts` (lines 138-155)

- [ ] **Step 2.1: Append rawContent-removal assertions to the test file**

Append the following describe block to `/tmp/mcp-dockhand/tests/stack-env-tools.test.ts`, after the closing `});` of the existing `describe('update_stack_env_raw (new tool)', …)` block:

```typescript

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
    expect(block).not.toMatch(/variables:\s*z\.array\([\s\S]*?\)\.optional/);
  });

  it('description references update_stack_env_raw for non-secret writes', () => {
    const block = extractToolBlock(stacksSource, 'update_stack_env');
    expect(block).toMatch(/update_stack_env_raw/);
  });
});
```

- [ ] **Step 2.2: Run the test to confirm RED (the 4 cleanup assertions fail because `rawContent` is still present)**

Run:
```bash
cd /tmp/mcp-dockhand && npx vitest run tests/stack-env-tools.test.ts
```

Expected: `update_stack_env_raw` tests (5) still PASS, new `update_stack_env (rawContent cleanup)` tests FAIL (rawContent still present, variables still .optional(), description doesn't reference update_stack_env_raw).

- [ ] **Step 2.3: Modify `update_stack_env` in `src/tools/stacks.ts`**

Replace the current block at `src/tools/stacks.ts:138-155`:

```typescript
  registerTool(server, 'update_stack_env', 'Update environment variables of a stack',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      variables: z.array(z.object({
        key: z.string(),
        value: z.string(),
        isSecret: z.boolean().optional(),
      })).optional().describe('Environment variables'),
      rawContent: z.string().optional().describe('Raw .env file content'),
    },
    async ({ environmentId, name, variables, rawContent }) => {
      const body: Record<string, unknown> = {};
      if (variables) body.variables = variables;
      if (rawContent) body.rawContent = rawContent;
      return jsonResponse(await client.put(`/api/stacks/${encodePath(name)}/env`, body, { env: environmentId }));
    }
  );
```

With the new block:

```typescript
  registerTool(server, 'update_stack_env',
    'Update secret environment variables (database-backed, encrypted at rest). Variables flagged isSecret:true are stored in the Dockhand database and injected into containers via shell-env at deploy time — they are NEVER written to the .env file. For non-secret variables that Docker Compose reads from the .env file at container start, use update_stack_env_raw.',
    {
      environmentId: z.number().describe('Environment ID'),
      name: z.string().describe('Stack name'),
      variables: z.array(z.object({
        key: z.string(),
        value: z.string(),
        isSecret: z.boolean().optional(),
      })).describe('Environment variables — flag secrets with isSecret:true'),
    },
    async ({ environmentId, name, variables }) => {
      return jsonResponse(await client.put(
        `/api/stacks/${encodePath(name)}/env`,
        { variables },
        { env: environmentId },
      ));
    }
  );
```

Changes from the old block (line-by-line):
- Description now points at the new tool for non-secret writes
- Removed `rawContent: z.string().optional().describe('Raw .env file content')` from the Zod schema
- Removed `.optional()` from `variables` array (it was optional only because rawContent was the alternative path)
- Removed `, rawContent` from the destructure
- Removed the `const body: Record<string, unknown> = {};` line and the two `if (…) body.X = X;` lines — replaced with a direct inline `{ variables }` body
- Updated `variables` description to mention `isSecret`

- [ ] **Step 2.4: Run the test to confirm GREEN**

Run:
```bash
cd /tmp/mcp-dockhand && npx vitest run tests/stack-env-tools.test.ts
```

Expected: All 10 assertions across both describe blocks PASS.

- [ ] **Step 2.5: Run the full test suite to confirm no regression**

Run:
```bash
cd /tmp/mcp-dockhand && npm test
```

Expected: All tests PASS (including the existing tool-registration, path-encoding, environment-scope, and encode-path tests). No new failures.

- [ ] **Step 2.6: Run typecheck**

Run:
```bash
cd /tmp/mcp-dockhand && npm run typecheck
```

Expected: Exit 0, no errors.

- [ ] **Step 2.7: Commit**

```bash
cd /tmp/mcp-dockhand
git add tests/stack-env-tools.test.ts src/tools/stacks.ts
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" commit -m "$(cat <<'EOF'
fix(stacks): remove non-functional rawContent param from update_stack_env

The rawContent parameter on update_stack_env was a no-op: the tool's
handler mapped it into the request body, but the request always landed
at /api/stacks/{name}/env (without the /raw suffix), which rejects any
body other than {variables: [...]}. Callers who relied on rawContent
received a 400 "variables array required" from upstream — the parameter
existed only as misleading schema surface.

Removing it is not breaking in practice because the path it claimed to
enable never worked. Callers who wanted to write the .env file should
use the new update_stack_env_raw tool, added in the previous commit.

Side effects:
- variables array is now required (was .optional() because rawContent
  was the alternative). The tool body is now an unconditional
  {variables} payload, matching upstream's contract exactly.
- Description tightened to clarify the secret-only / DB-backed nature
  and to point at update_stack_env_raw for non-secret writes.

Refs #56
EOF
)"
```

Expected: Commit hash + `2 files changed` summary.

---

## Task 3: Delete the orphan `docs/dockhand-api-baseline.json`

**Files:**
- Delete: `/tmp/mcp-dockhand/docs/dockhand-api-baseline.json`

- [ ] **Step 3.1: Confirm the file is not referenced**

Run:
```bash
cd /tmp/mcp-dockhand && grep -rE 'dockhand-api-baseline' src/ scripts/ tests/ .github/ 2>/dev/null
echo "exit=$?"
```

Expected: No output, `exit=1` (grep finds nothing). If anything is found, STOP and report — the file is still in use somewhere.

- [ ] **Step 3.2: Delete the file**

```bash
cd /tmp/mcp-dockhand && git rm docs/dockhand-api-baseline.json
```

Expected output: `rm 'docs/dockhand-api-baseline.json'`.

- [ ] **Step 3.3: Confirm the working tree is clean (only staged deletion)**

Run:
```bash
cd /tmp/mcp-dockhand && git status --short
```

Expected: Single line: `D  docs/dockhand-api-baseline.json` (capital D = staged deletion).

- [ ] **Step 3.4: Commit**

```bash
cd /tmp/mcp-dockhand
git -c user.name="Björn Strausmann" -c user.email="strausmannservices@googlemail.com" commit -m "$(cat <<'EOF'
chore(docs): remove orphan dockhand-api-baseline.json

This file was a one-shot manual snapshot from 2026-03-29
(commit 87df68e, "Initiale Dockhand API Baseline"). It was superseded
by the daily-refreshed docs/dockhand-api-schema.json produced by the
api-schema-sync workflow (PR #25, commit 20abdea).

No script or test references baseline.json — verified via
grep -r 'dockhand-api-baseline' src/ scripts/ tests/ .github/. The file
currently misleads readers into thinking it is the active schema.

Refs #56
EOF
)"
```

Expected: Commit hash + `1 file changed, … deletions(-)`.

---

## Task 4: End-to-end verification before push

- [ ] **Step 4.1: Full test suite**

Run:
```bash
cd /tmp/mcp-dockhand && npm test
```

Expected: All tests PASS, including:
- `tests/encode-path.test.ts`
- `tests/environment-scope.test.ts`
- `tests/path-encoding.test.ts`
- `tests/stack-env-tools.test.ts` (new — 10 assertions)
- `tests/tool-registration.test.ts`

If any test fails, STOP and diagnose before pushing.

- [ ] **Step 4.2: Typecheck**

Run:
```bash
cd /tmp/mcp-dockhand && npm run typecheck
```

Expected: Exit 0, no errors.

- [ ] **Step 4.3: Lint**

Run:
```bash
cd /tmp/mcp-dockhand && npm run lint
```

Expected: Exit 0, no errors.

- [ ] **Step 4.4: Confirm the validator now sees the new tool**

The validator script reads the schema baseline. The baseline still lists `PUT /api/stacks/{name}/env/raw` as a known endpoint — the new tool should be picked up as COVERED.

Run:
```bash
cd /tmp/mcp-dockhand && node scripts/validate-mcp-tools.mjs 2>&1 | tail -10
```

Expected: `MISSING_TOOL` count drops by 1 versus the pre-change baseline (was 45 → should be 44). No `PARAM_MISMATCH` regressions. No `ORPHANED_TOOL` regressions.

If the validator was reporting other issues unrelated to this change, those are out of scope — just confirm no new errors were introduced.

- [ ] **Step 4.5: Confirm commit history is clean**

Run:
```bash
cd /tmp/mcp-dockhand && git log --oneline main..HEAD
```

Expected output (newest first):
```
<sha>  chore(docs): remove orphan dockhand-api-baseline.json
<sha>  fix(stacks): remove non-functional rawContent param from update_stack_env
<sha>  feat(stacks): add update_stack_env_raw tool
<sha>  docs(stacks): spec for update_stack_env_raw + rawContent cleanup
```

Four commits total. No `Co-Authored-By: Claude` anywhere — confirm with:

```bash
cd /tmp/mcp-dockhand && git log main..HEAD --pretty=format:'%b' | grep -i 'co-authored-by' || echo "no co-authored-by trailers (good)"
```

Expected output: `no co-authored-by trailers (good)`.

- [ ] **Step 4.6: Hand off to orchestrator for push + PR**

This step is performed by the orchestrator, NOT by an implementation subagent.

The orchestrator will:
1. Push branch: `git push -u origin fix/issue-56-stack-env-raw-tool`
2. Create PR with `gh pr create --base main --head fix/issue-56-stack-env-raw-tool --title 'fix(stacks): add update_stack_env_raw + drop bogus rawContent param' --body '...'` (body references Closes #56, links to #57 as context, lists the four commits)
3. Verify CI passes
4. Wait for human review or use the requesting-code-review skill for an AI pre-review pass
5. Merge when approved — semantic-release picks up the `feat` and auto-bumps to a minor release with auto-generated CHANGELOG

Post-merge follow-ups (NOT part of this PR):
- Image rebuild on GHCR (automated by release workflow on tag)
- Container redeploy on hhdocker01 (manual via Dockhand UI or `docker stack restart mcp-dockhand`)
- Skill-doc update in `strausmann/homelab-management` repo:
  - `.claude/skills/dockhand/SKILL.md` — mention `update_stack_env_raw` in the "Schreiben (mit Bestaetigung)" section
  - `.claude/skills/dockhand/references/troubleshooting.md` — mark the "PUT /api/stacks/{name}/env speichert nur erste Variable" workaround obsolete and point at the new tool

---

## Spec Coverage Self-Review

| Spec section | Covered by task |
|---|---|
| § 1 Architecture / file structure | Task 1 (insertion point), Task 2 (modification site), Task 3 (deletion) |
| § 1 Component 1 — New tool | Task 1.3 + 1.4 + 1.7 |
| § 1 Component 2 — Strip rawContent | Task 2.3 + 2.4 + 2.7 |
| § 1 Component 3 — Delete baseline | Task 3.2 + 3.4 |
| § 1 Component 4 — Tests | Task 1.1 + 2.1 |
| § 1 Component 5 — Changelog + version | **Intentionally not a manual task** — semantic-release derives from commit history. Documented at top of plan under "File Structure". |
| Acceptance criterion 1 (`update_stack_env_raw` exists) | Task 1 |
| Acceptance criterion 2 (`rawContent` gone) | Task 2 |
| Acceptance criterion 3 (validator MISSING_TOOL = 0 for /env/raw) | Task 4.4 |
| Acceptance criterion 4 (CHANGELOG entries) | Automatic via semantic-release post-merge |
| Acceptance criterion 5 (minor version bump) | Automatic via semantic-release post-merge |
| Acceptance criterion 6 (tests pass) | Task 4.1 |
| Acceptance criterion 7 (typecheck passes) | Task 4.2 |
| Acceptance criterion 8 (baseline.json removed) | Task 3 |

All eight acceptance criteria are covered. The two "automatic via semantic-release" entries are not implementation tasks — they are post-merge effects of the commit-message conventions used in Tasks 1, 2, and 3.
