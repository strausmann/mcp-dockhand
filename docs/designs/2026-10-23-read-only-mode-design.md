# Read-only mode and tool filter — Design

**Date:** 2026-10-23
**Status:** Proposed
**Owner:** repo maintainer
**Issue:** #254
**Implementation branch:** `feat/read-only-mode`

> **Revision 2026-10-23 (security review).** The first version of this design classified 12
> tools as read that have a side effect upstream, and claimed that no meta tool posts. Both
> came from an incomplete scan (see "How the classification was checked"). The Classification
> section, `self_check` behaviour, the login-probe exception and the guard tests below are
> the corrected state.

> **Revision 2 (2026-10-23, exhaustive audit).** The first security review sampled GET
> handlers instead of tracing every read tool, and missed further side effects. An exhaustive
> audit then traced all 172 read tools into the upstream helpers at the pinned commit, under
> the strict definition: no state change in Dockhand or on any Docker host, and no outbound
> network access even when the remote side is only read. Changes:
> - 18 more tools in `WRITE_GET_TOOLS`: `get_selfhst_icon`, `get_selfhst_icon_manifest`
>   (selfh.st CDN, icon cache write), `get_git_repository_sync_status` (`git fetch`),
>   `get_container_file_content` (exec `cat`), `get_scanner_settings` (runs scanner
>   containers, queries the registry), `get_oidc_login_url` (IdP discovery fetch, login-state
>   cookie), `get_container_version_notes` (GitHub/forge API), `get_registry_catalog`,
>   `get_registry_tags`, `get_registry_tag_info`, `search_registry` (registry queries with
>   stored credentials), `list_templates` (template source URLs), and the six backup snapshot
>   readers `list_backup_snapshots`, `browse_backup_snapshot`,
>   `download_backup_snapshot_file`, `dump_backup_snapshot_file`,
>   `get_backup_snapshot_metadata`, `diff_backup_snapshots` (restic against the backup
>   repository, restic cache on disk).
> - `validate_stack_compose` leaves `READ_ONLY_POST_TOOLS`: a caller-supplied compose file can
>   carry remote `include:` resources that `docker compose config` would fetch.
> - New `WRITE_META_TOOLS` (`check_for_update`: this server calls api.github.com;
>   `validate_config`: a real login).
> - The login-probe exception is withdrawn. `POST /api/auth/login` creates a session row,
>   updates `lastLogin` and writes an audit entry on every call. Under `MCP_READ_ONLY`
>   `self_check` no longer sends it and derives `authValid` from its authenticated
>   `GET /api/environments` (`authCheck: "session"`).
> - A short list of accepted exceptions replaces it (see "Accepted exceptions" below).
>
> Result: 151 read and 239 write tools (was 172 / 218).

## Problem

mcp-dockhand registers about 390 tools, read and write, for every MCP client. Who may do what
is decided only by the Dockhand account the server logs in with. On Dockhand's Free Edition
every user is an administrator, so an assistant connected through this server can always
restart, redeploy, delete or exec. #254 asks for a server-side read-only mode. A comment on it
also asks for a way to hide individual tools, so their descriptions stop consuming client
tokens.

## Goals

1. `MCP_READ_ONLY=true` registers only tools that change nothing, and that is a dependable
   guarantee: no state change in Dockhand, no outbound side effect (test notifications,
   scans, connection tests).
2. `MCP_TOOLS_ALLOW` / `MCP_TOOLS_DENY` select tools by name or `*` pattern.
3. Filtered tools are **not registered**. The client never sees them, which saves tokens and
   means nothing has to be rejected at call time.
4. New tools are classified automatically. Whenever automatic classification can be wrong, a
   test forces a conscious decision.

## Non-goals

- Per-session or per-client policies. The policy is per process and fixed at startup.
- Grouping tools into categories (`containers`, `backup`, …).
- Hiding sensitive **read** tools (e.g. `dump_backup_snapshot_file`). That stays the job of
  `MCP_TOOLS_DENY`.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `MCP_READ_ONLY` | `false` | `true`/`1`/`yes`: only read tools (see classification). Any other non-empty value is a startup error, so a typo cannot silently disable the mode. |
| `MCP_TOOLS_ALLOW` | unset | Comma-separated names/patterns. When set, only matching tools are registered. An **exact** name (no `*`) also re-admits a write tool under `MCP_READ_ONLY`. |
| `MCP_TOOLS_DENY` | unset | Comma-separated names/patterns. Matching tools are never registered and DENY always wins. |

Every entry is either an exact tool name or a pattern with `*` (any characters, including
none). `*` may appear any number of times and in any position: `get_*`, `*_stack`,
`backup_*_snapshot*`, `*env*`, and a bare `*` meaning "every tool" are all valid. Matching is
anchored to the whole name and case-sensitive (tool names are lowercase snake_case), and no
other glob or regex syntax is interpreted. Whitespace around entries is trimmed and empty
entries are ignored.

A bare `*` follows the same rules as any other pattern:
- `MCP_TOOLS_ALLOW=*` is a no-op whitelist. Being a pattern, it re-admits nothing under
  READ_ONLY.
- `MCP_TOOLS_DENY=*` removes everything, so startup fails with "no tools registered" (see
  Error handling).

**Evaluation**, done once at startup over the universe `U` of all tool names:

```
base     = READ_ONLY ? { t ∈ U | isReadOnly(t) } : U
base    += { t ∈ ALLOW | t is an exact name }          # exact re-admission only
selected = ALLOW set ? { t ∈ base | t matches ALLOW } : base
final    = selected − { t | t matches DENY }
```

Example: `MCP_READ_ONLY=true` + `MCP_TOOLS_ALLOW=scan_image,get_*,list_*` gives all
`get_*`/`list_*` read tools plus `scan_image`. A pattern such as `scan_*` would **not**
re-admit `scan_image` under READ_ONLY. Only an exact name does, so wildcards can never widen a
read-only server by accident.

## Classification (`src/utils/tool-policy.ts`)

`isReadOnly(name)` is true when either of these holds:

- the tool's primary endpoint in `TOOL_ENDPOINT_MAP` is `GET` **and** the tool is not in
  `WRITE_GET_TOOLS`;
- the tool is in `META_TOOL_NAMES` (local tools with no Dockhand endpoint) but not in
  `WRITE_META_TOOLS`, or it is in `READ_ONLY_POST_TOOLS`.

Everything else is write, **including an unknown name** (fail-safe).

| Set | Members (at time of writing) | Why |
|---|---|---|
| `WRITE_GET_TOOLS` | `trigger_git_webhook`, `get_git_stack_webhook`, `get_git_webhook` | Webhook triggers: they deploy, or write an audit entry. `get_git_stack_webhook` shares its endpoint with `trigger_git_webhook`. |
| | `browse_volume`, `export_volume`, `get_volume_file_content` | Create and start a volume helper container on the Docker host, pulling its image when missing. |
| | `get_container_shells`, `get_container_top`, `list_container_files` | Exec in the user's container (`get_container_top` only when the caller holds the exec permission, which an admin, and every caller with Dockhand auth disabled, always does). |
| | `probe_backup_stack_dir` | Pulls the backup helper image and runs a helper container. |
| | `get_selfhst_icon`, `get_selfhst_icon_manifest` | Fetch from the selfh.st CDN and write Dockhand's icon cache. |
| | `get_git_repository_sync_status` | `git fetch origin <branch>`. |
| | `get_container_file_content` | Exec `cat` in the user's container. |
| | `get_scanner_settings` | Without `settingsOnly=true`, runs each scanner image as a container for its version; queries the registry for newer versions. |
| | `get_oidc_login_url` | Fetches the IdP discovery document, sets a login-state cookie and redirects to the IdP. |
| | `get_container_version_notes` | Fetches release notes from the GitHub/forge API. |
| | `get_registry_catalog`, `get_registry_tags`, `get_registry_tag_info`, `search_registry` | Query registries, private ones with stored credentials. |
| | `list_templates` | Fetches every enabled template source URL and a sitemap. |
| | `list_backup_snapshots`, `browse_backup_snapshot`, `download_backup_snapshot_file`, `dump_backup_snapshot_file`, `get_backup_snapshot_metadata`, `diff_backup_snapshots` | Run restic against the backup repository (outbound, stored credentials) and write restic's cache. |
| `WRITE_META_TOOLS` | `check_for_update`, `validate_config` | Checked before the meta rule. `check_for_update` calls api.github.com; `validate_config` exists to send a real `POST /api/auth/login`. |
| `META_TOOL_NAMES` (existing, `src/utils/meta-tool-names.ts`) | `check_for_update`, `get_runtime_stats`, `get_server_info`, `get_tool_manifest`, `self_check`, `validate_config` | No single Dockhand endpoint; diagnostic. Read unless in `WRITE_META_TOOLS`. `self_check` skips its login probe and its connection test under `MCP_READ_ONLY` (below). |
| `READ_ONLY_POST_TOOLS` | `validate_stack_env`, `validate_stack_path`, `check_stack_path_change` | POST for transport reasons only: they validate or compare, with no stored result, no Docker daemon call and no outbound request. `validate_stack_compose` is write (remote `include:`). |

The following are deliberately **not** read-only, under the strict definition agreed for #254:

- `test_*` tools: they send real notifications and open LDAP/registry/git/secret-provider
  connections.
- `scan_image`, `scan_stacks` and `scan_all_vulnerabilities`: they store results and run
  long.
- `check_container_updates`: it rewrites the pending-updates list.
- `list_git_remote_branches`: it runs `git ls-remote` against a caller-chosen URL with a
  caller-chosen stored credential, an outbound call that can send that credential anywhere.
- `preview_backup_restore`: it runs restic and, with a restore mode, per-target helper
  containers.
- `batch_get_selfhst_icons`: it fetches icons from the selfh.st CDN and writes Dockhand's disk
  cache.

**`self_check` under `MCP_READ_ONLY`.** Its per-environment connection test is
`POST /api/environments/{id}/test`, the endpoint of `test_environment`; upstream it opens
Docker/Hawser connections and updates hawser fields. Under `MCP_READ_ONLY`, `self_check` skips
it and reports the environments from the GET calls only. Each environment then carries
`tested: false` and a `skipReason`, and an untested environment does not degrade `overall`.
It also skips its login probe (`POST /api/auth/login`, which creates a session row, updates
`lastLogin` and writes an audit entry): `authValid` is then whether the authenticated
`GET /api/environments` succeeded with the server's existing session or token, and the
result carries `authCheck: "session"` (`"login-probe"` otherwise). Without `MCP_READ_ONLY`
nothing changes.

**Accepted exceptions (Revision 2).** These are the only side effects a read tool may still
cause under `MCP_READ_ONLY`:

- Lazy one-time initialisation that every Dockhand install already does at startup or on
  first use and that carries no data: creating the icon, stacks and git-repos directories
  (`get_container_icon`, `get_stack_icon`, `get_git_stack_env_files`,
  `get_stack_delete_preview` and the stack-directory readers), and the one-time backup
  instance-id setting (`get_backup_instance_id`).
- Inherent to every MCP call regardless of tool: the server's own login at startup and after
  a 401, and the bearer token's `lastUsed` update.

The earlier login-probe exception is withdrawn.

The universe `U` is `keys(TOOL_ENDPOINT_MAP) ∪ META_TOOL_NAMES`. A test asserts that it equals the
set of names actually registered.

### How the classification was checked

The first version of this section said every `registerTool` body of a GET-mapped or meta tool
had been scanned for `client.post/put/patch/delete`, that none was found, and that the only GET
with a side effect was `trigger_git_webhook`. That scan was incomplete. It looked only at
`registerTool` bodies in this repo, so it missed helpers they call (`runSelfCheck`'s
environment listing posts `/api/environments/{id}/test`) and everything Dockhand does inside a
GET handler (helper containers, exec, webhook triggers). The security review read the upstream
handlers at the pinned commit and found the cases now listed above.

Three tests now guard against a repeat:

- No read tool shares `{method, path}` with a write tool (`tests/tool-policy-coverage.test.ts`).
  That alone would have caught `get_git_stack_webhook`.
- Every `READ_ONLY_POST_TOOLS` entry maps to a POST, every `WRITE_GET_TOOLS` entry to a GET.
- Every registered meta tool handler runs against a recording client with `fetch` stubbed,
  under `MCP_READ_ONLY` and the default policy. Under `MCP_READ_ONLY` any non-GET request
  and any request to a host other than Dockhand fails the test; with the default policy, any
  non-GET request not on an explicit, commented allowlist
  (`tests/tools/meta.read-only-guard.test.ts`).

Revision 2 adds the exhaustive audit itself: every read tool was traced into the upstream
helpers it calls, not sampled.

## Integration

- `tool-policy.ts` exports `buildToolPolicy(env)`, a pure function returning
  `{ isRegistered(name), isReadOnly(name), summary }` or throwing a `ToolPolicyError`. It also
  exports a module-level `configureToolPolicy(policy)`/`currentToolPolicy()` pair. The default
  policy registers everything, so tests and existing deployments are unaffected.
- `src/index.ts` builds the policy right after the existing env validation. A
  `ToolPolicyError` is fatal (`process.exit(1)`), the same as an invalid `DOCKHAND_API_TOKEN`.
- `registerTool()` in `src/utils/tool-helper.ts` returns early when
  `!currentToolPolicy().isRegistered(name)`. It always passes MCP annotations, read-only or
  not: `readOnlyHint: isReadOnly(name)`, and `destructiveHint: true` for write tools. The SDK
  overload `tool(name, description, paramsSchema, annotations, cb)` is used.
- `get_server_info` and `self_check` report `toolPolicy: { readOnly, allow, deny, registered, total }`.
  The values are names and patterns only, never secrets.
- Startup log, one `info` line: mode, registered/total count. One `warn` line lists the write
  tools re-admitted through exact ALLOW names under READ_ONLY. Another `warn` line names any
  env variable that looks like one of the three policy variables but is not spelled exactly
  (`MCP_READONLY`, `mcp_read_only`); such a variable is ignored, so the operator is told.

## Error handling (startup, fatal)

| Condition | Message (sketch) |
|---|---|
| `MCP_READ_ONLY` has an unrecognised value | `MCP_READ_ONLY must be true/false (got "<value>")` |
| an ALLOW/DENY entry matches no tool | `MCP_TOOLS_DENY entry "contianer_*" matches no tool` |
| the final set is empty | `tool filter leaves no tools registered` |

An unmatched DENY entry is fatal on purpose: a typo there would silently leave a tool exposed
that the operator meant to remove. The same check on ALLOW catches the symmetric typo, a tool
the operator expects to have but does not.

## Testing

- `tests/tool-policy.test.ts` covers the pure `buildToolPolicy`:
  - READ_ONLY base set;
  - exact re-admission vs. pattern non-re-admission;
  - ALLOW as whitelist and DENY beating ALLOW;
  - `*` matching in every position, multiple `*` and a bare `*`;
  - regex metacharacters in entries treated literally;
  - trimming and empty entries;
  - every fatal case, plus unknown name ⇒ write.
- Coverage test: the registered tool names equal `U`, every name is classified, the three
  exception sets contain only existing tools of the expected method, and no read tool shares an
  endpoint with a write tool.
- Meta guard: the meta tool handlers make no unlisted non-GET request (see "How the
  classification was checked").
- Guard test: a snapshot list of all GET-mapped read tools. A new GET tool fails it until it
  is added either to the snapshot (read) or to `WRITE_GET_TOOLS`. That catches the next
  `trigger_git_webhook`. New POST/PUT/DELETE tools need no action, because they default to
  write.
- `docs/tools.md` builder: rows, counts and mode per tool, from injected inputs.
- Integration test: build the server with `MCP_READ_ONLY=true` and assert, through the tool
  list, that no write tool is listed and that `readOnlyHint` is set as classified.

## Tool list (`docs/tools.md`)

Operators need the exact names to write ALLOW/DENY entries, and need to see which tools
READ_ONLY keeps. A generated, checked-in `docs/tools.md` provides both:

- It is generated by `scripts/generate-tool-list.mjs` from `TOOL_ENDPOINT_MAP`,
  `META_TOOL_NAMES` (`src/tools/meta.ts`), the classification in `tool-policy.ts` and each
  operation's `summary` in `docs/dockhand-openapi.json`.
- One table sorted by name, with the columns: tool · mode (`read` / `write`) · HTTP method ·
  Dockhand path · summary (first sentence). Meta tools show `—` for method and path.
- A header shows the counts (total / read / write) and points to the README section on
  filters.
- It joins the existing "Derived docs are in sync with the code" step in `ci.yml`. A PR that
  adds a tool or changes a classification without regenerating the list fails CI, as
  `docs/coverage.md` already does. The nightly `api-schema-sync.yml` regenerates it too.
- `npm run docs:tools` regenerates it.

The live server answers the same question through the existing `get_tool_manifest` tool. It
gains a `mode` field per tool and stays consistent with `docs/tools.md`, since both read the
same classification.

## Documentation

- README: a "Read-only mode and tool filter" section and three rows in the environment table.
  The docker-compose example carries commented `MCP_READ_ONLY` / `MCP_TOOLS_*` lines.
- `docs/adr/0003-tool-read-write-classification.md` records the classification rule, the
  exception sets and the "unknown ⇒ write" default as a binding rule for future tools.
  The ADR registry gets a new row.

## Security review (final step)

Before the PR is marked ready, run a dedicated security review of the change. It covers:

- **Bypass:**
  - Can any tool that changes state or has an outbound side effect be registered under
    `MCP_READ_ONLY` without an exact ALLOW name?
  - Re-verify every member of `READ_ONLY_POST_TOOLS` and every `META_TOOL_NAMES` handler against
    the Dockhand v1.0.54 handler source.
  - Spot-check GET handlers for side effects.
- **Fail-open paths:**
  - Any parse error, unknown value or empty list that results in *more* tools than intended.
  - Default policy leaking into production when env parsing throws.
- **Information exposure:** the `toolPolicy` block in `get_server_info`/`self_check` and the
  log lines carry only names and patterns.
- **Interaction with existing auth:** the filter is additive to Dockhand RBAC,
  `MCP_AUTH_TOKEN` and `DOCKHAND_API_TOKEN`, and it neither replaces nor weakens them. The
  README must say so.

Findings are fixed in the same PR or, if out of scope, recorded as issues and listed in the PR
body.
