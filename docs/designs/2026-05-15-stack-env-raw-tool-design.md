# Design: `update_stack_env_raw` tool + `rawContent` cleanup

**Date:** 2026-05-15
**Status:** Approved (brainstorming)
**Tracking issue:** [#56](https://github.com/strausmann/mcp-dockhand/issues/56)
**Related:** [#57](https://github.com/strausmann/mcp-dockhand/issues/57) (upstream OpenAPI watch)
**Author:** Brainstormed via superpowers:brainstorming.

## Goals

Close a long-standing gap in the MCP-server's coverage of Dockhand's stack
environment-variable API. Two endpoint families exist upstream — one for
secrets in the database, one for the raw `.env` file on disk — but only the
secrets endpoint has a working write tool. This makes it impossible to
manage non-secret stack environment variables via MCP without falling back
to direct REST calls.

1. **Add `update_stack_env_raw`** — wrap `PUT /api/stacks/{name}/env/raw`
   so callers can write the on-disk `.env` file that Docker Compose reads.
2. **Remove the non-functional `rawContent` parameter** from
   `update_stack_env`. The parameter exists in the tool schema and gets
   mapped into the request body, but the request always lands at
   `/api/stacks/{name}/env` (without the `/raw` suffix), which rejects
   anything other than `{variables: [...]}` with `400 "variables array
   required"`. The parameter is dead weight that misleads callers into
   thinking they can write `.env` content from this tool.
3. **Delete the orphaned `docs/dockhand-api-baseline.json`** — a one-shot
   snapshot from 2026-03-29 that no script references. The active
   pipeline reads `docs/dockhand-api-schema.json` instead.

The validator (`scripts/validate-mcp-tools.mjs`) has flagged
`PUT /api/stacks/{name}/env/raw` as MISSING_TOOL on every daily run since
PR #25, but MISSING_TOOL is classified as informational and never triggers
an issue. This work closes the most-used gap and lays groundwork for a
separate follow-up to tighten the validator's escalation policy.

## Out of scope

- **Validator hardening** (auto-escalation of long-standing MISSING_TOOL,
  PARAM_MISMATCH schema-level checks). Tracked separately for a follow-up PR.
- **The other 44 MISSING_TOOL endpoints** from the daily validator report.
  This PR addresses `env/raw` PUT only — it is the immediate, painful gap.
  A bulk-coverage roadmap will be filed as a separate umbrella issue.
- **Upstream OpenAPI consumption.** Tracked in [#57](https://github.com/strausmann/mcp-dockhand/issues/57)
  and conditional on Finsys/dockhand#816 merging.

## Architecture

```
src/tools/stacks.ts
  ├── update_stack_env          ← keep; tighten description; drop rawContent param
  └── update_stack_env_raw      ← NEW; PUT /api/stacks/{name}/env/raw

docs/dockhand-api-baseline.json ← DELETE
docs/designs/2026-05-15-stack-env-raw-tool-design.md   ← this spec
docs/plans/2026-05-15-stack-env-raw-tool.md            ← implementation plan
tests/stack-env-tools.test.ts   ← NEW; static-analysis tests for both tools

CHANGELOG.md                    ← entry under [Unreleased]
package.json                    ← minor version bump (additive net)
```

A separate router file is overkill — both tools belong to the existing
`registerStackTools(server, client)` group in `src/tools/stacks.ts`.

## Component 1: New tool `update_stack_env_raw`

Insertion point: in `src/tools/stacks.ts`, immediately after the existing
`get_stack_env_raw` registration (lines 157–165). Keeping read and write
of the same endpoint adjacent helps future maintenance.

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

### Parameter contract

| Param | Type | Required | Meaning |
|---|---|---|---|
| `environmentId` | number | yes | Dockhand environment id, surfaces as `?env=N` |
| `name` | string | yes | Stack name; passed through `encodePath()` per repo convention |
| `content` | string | yes | Full file content (incl. comments, blank lines). Empty string triggers Dockhand to delete the file on disk |

### Endpoint contract (verified against upstream source)

Dockhand `src/routes/api/stacks/[name]/env/raw/+server.ts` PUT handler:

- Accepts `{content: string}` body — anything else → 400
- Resolves env-file path: `envPath` override → `composePath/../​env` → stack-default
- `writeFileSync` on the resolved path; empty content → `rmSync`
- Guards against masked-secret placeholders (`KEY=***` in content → 400)

The tool returns Dockhand's JSON response verbatim (`{success: true}` or
`{success: true, deleted: true}` for the empty-content path).

## Component 2: Strip `rawContent` from `update_stack_env`

`src/tools/stacks.ts:138–155` becomes:

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

Key changes from the current code (lines 138–155):

- `variables` becomes required (was `.optional()` because `rawContent` was the
  alternative — with `rawContent` gone, there's no other path)
- `rawContent: z.string().optional()` removed from schema
- `if (rawContent) body.rawContent = rawContent;` removed from handler
- Handler body now always `{variables}` — matches the upstream endpoint
  contract exactly

### Compatibility note

Removing `rawContent` would normally be a breaking change. It is **not**
breaking here because the parameter never worked — Dockhand always
rejected any request that relied on it. A caller using `rawContent` today
gets a 400 response; after this change, they get a Zod validation error
at the MCP layer instead. Either way they cannot proceed; the new tool
makes the correct path discoverable.

## Component 3: Delete legacy baseline

`docs/dockhand-api-baseline.json` is a 191-line snapshot from 2026-03-29
(commit `87df68e`, "Initiale Dockhand API Baseline"). The automated
pipeline (PR #25, commit `20abdea`) introduced
`docs/dockhand-api-schema.json` as the live, daily-refreshed schema.

`grep -r baseline scripts/ src/` confirms no code path reads
`baseline.json`. The file is purely historical and currently misleads
readers into thinking it is the active schema. Delete it.

## Component 4: Tests

New file `tests/stack-env-tools.test.ts`, following the static-analysis
pattern in the existing test suite (no HTTP mocks, no runtime — read
source and assert on text properties).

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

describe('Stack env tools', () => {
  describe('update_stack_env_raw (new)', () => {
    it('is registered with the correct endpoint', () => {
      expect(stacksSource).toContain("'update_stack_env_raw'");
      expect(stacksSource).toMatch(/\/env\/raw['`]/);
    });

    it('uses encodePath on the stack name', () => {
      // Endpoint string must wrap the name through encodePath()
      expect(stacksSource).toMatch(/\$\{encodePath\(name\)\}\/env\/raw/);
    });

    it('declares content as a required string parameter', () => {
      // Required = no .optional() suffix in the schema
      const block = extractToolBlock(stacksSource, 'update_stack_env_raw');
      expect(block).toMatch(/content:\s*z\.string\(\)/);
      expect(block).not.toMatch(/content:\s*z\.string\(\)\.optional\(\)/);
    });
  });

  describe('update_stack_env (rawContent cleanup)', () => {
    it('no longer declares the rawContent parameter', () => {
      const block = extractToolBlock(stacksSource, 'update_stack_env');
      expect(block).not.toContain('rawContent');
    });

    it('still maps variables to the request body', () => {
      const block = extractToolBlock(stacksSource, 'update_stack_env');
      expect(block).toMatch(/\{\s*variables\s*\}/);
    });
  });
});

// Helper: extract the registerTool(...) block for a given tool name.
function extractToolBlock(source: string, toolName: string): string { /* ... */ }
```

The `extractToolBlock` helper is a small regex-based extractor — it finds
`registerTool(server, '<toolName>', ...)` and returns everything up to
the matching closing `);`. Implementation detail; defined in the same
test file.

### Why static-analysis and not runtime tests

The repository's test suite is uniformly static-analysis (verifying
source properties like "all tools are imported", "path params use
encodePath", "environment-scope is declared"). Adding runtime/mock tests
for a single new tool would diverge from the established pattern with
little gain — the actual HTTP wiring is covered by manual smoke testing
against the running MCP server on hhdocker01, and by the daily
`validate-mcp-tools.mjs` workflow which confirms that the endpoint exists
upstream.

## Component 5: Changelog + version

`CHANGELOG.md` (Keep-a-Changelog format) gains under `## [Unreleased]`:

```markdown
### Added
- `update_stack_env_raw` tool to write the raw `.env` file of a stack to
  disk (`PUT /api/stacks/{name}/env/raw`). Use this for non-secret
  variables that Docker Compose reads at container start. ([#56])

### Changed
- `update_stack_env` description tightened: it is the secrets/DB path
  only; non-secret `.env` content goes through `update_stack_env_raw`.

### Removed
- Non-functional `rawContent` parameter from `update_stack_env`. The
  parameter was a no-op — Dockhand's `/env` endpoint rejects any request
  body that is not `{variables: [...]}`. Callers who relied on
  `rawContent` should switch to `update_stack_env_raw`. ([#56])
- Stale `docs/dockhand-api-baseline.json` snapshot from 2026-03-29; the
  live pipeline maintains `docs/dockhand-api-schema.json` instead.
```

`package.json` version: minor bump (e.g. `1.x.0 → 1.(x+1).0`). The
network behaviour the MCP exposes is additive — a previously broken path
becomes usable. The Zod-level rejection of `rawContent` is a tightening
that mirrors the upstream's existing rejection.

## Branch + PR

- **Branch:** `fix/issue-56-stack-env-raw-tool` off `main`
- **PR title:** `fix(stacks): add update_stack_env_raw + drop bogus rawContent param`
- **PR body:** Closes #56; one paragraph per Component 1–4; one paragraph
  on the compatibility note from Component 2; references #57 as
  context for the larger validator work
- **Commit hygiene:** Conventional Commits, one logical change per
  commit (Add tool → Remove param → Delete baseline → Tests → Changelog)
- **No `Co-Authored-By: Claude`** in any commit or PR text — per repo
  norms

## Acceptance criteria

Mirrors Issue #56 verbatim:

1. `update_stack_env_raw` tool exists, calls `PUT /env/raw` with
   `{content}` body, uses `encodePath` on the name parameter.
2. `rawContent` is gone from `update_stack_env` schema and handler.
3. The next run of `node scripts/validate-mcp-tools.mjs` reports zero
   MISSING_TOOL entries for `PUT /api/stacks/{name}/env/raw`.
4. `CHANGELOG.md` has the entries above under `[Unreleased]`.
5. `package.json` carries a minor version bump.
6. `tests/stack-env-tools.test.ts` exists and all assertions pass under
   `npm test` (or `npx vitest run` if `test` script differs).
7. `npm run typecheck` passes with no new errors.
8. `docs/dockhand-api-baseline.json` no longer present in the working
   tree.

Post-merge (separate, manual step — not part of this PR):

- Image rebuilt: `ghcr.io/strausmann/mcp-dockhand:latest`
- Container on hhdocker01 redeployed via Dockhand (stack name:
  `mcp-dockhand`)
- Skill doc updated in the `strausmann/homelab-management` repo:
  - `.claude/skills/dockhand/SKILL.md` — mention the new tool in the
    "Schreiben" section
  - `.claude/skills/dockhand/references/troubleshooting.md` — mark the
    "PUT /api/stacks/{name}/env speichert nur erste Variable"
    workaround as obsolete; point at the new tool instead

## References

| Document | Link |
|---|---|
| Tracking issue (this work) | [#56](https://github.com/strausmann/mcp-dockhand/issues/56) |
| OpenAPI Level-2 watch | [#57](https://github.com/strausmann/mcp-dockhand/issues/57) |
| Upstream Dockhand `/env/raw` PUT handler | `src/routes/api/stacks/[name]/env/raw/+server.ts` in Finsys/dockhand |
| Daily validator workflow | `.github/workflows/api-schema-sync.yml` |
| Validator script | `scripts/validate-mcp-tools.mjs` |
| Live API schema | `docs/dockhand-api-schema.json` |
| Existing tool registration test | `tests/tool-registration.test.ts` |
| Existing path-encoding test | `tests/path-encoding.test.ts` |
| Upstream PR #816 (OpenAPI, future Level 2 source) | https://github.com/Finsys/dockhand/pull/816 |
