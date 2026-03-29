# Copilot Instructions — MCP-Dockhand

## Project Context

This is a Model Context Protocol (MCP) server for [Dockhand](https://github.com/finsys/dockhand) Docker Management.
It wraps the Dockhand REST API into 130+ MCP tools using Streamable HTTP transport.

**Upstream repositories (source of truth for API behavior):**
- **Dockhand Server:** https://github.com/finsys/dockhand (SvelteKit, Bun)
- **Hawser Agent:** https://github.com/finsys/hawser (Go)

## Critical: Verify Against Upstream

When reviewing MCP tool implementations, **always cross-reference with the upstream Dockhand source code**:

1. **HTTP Methods:** Check `src/routes/api/**/+server.ts` in finsys/dockhand for the correct HTTP method (GET/POST/PUT/DELETE/PATCH). Our MCP tools MUST match.
2. **Request Body Fields:** Check the actual request parsing in the Dockhand route handlers to verify parameter names and types match what our tools send.
3. **Response Format:** Verify our tools correctly handle the response structure (JSON object vs array, pagination, error format).
4. **Hawser Protocol:** For environment/hawser-related tools, check `internal/protocol/messages.go` and `internal/docker/compose.go` in finsys/hawser.
5. **API Schema:** Compare against `docs/dockhand-api-schema.json` (auto-generated daily from upstream source).

**If a tool's implementation differs from upstream, flag it as HIGH priority.**

## Code Review Guidelines

### Security
- All path parameters MUST use `encodePath()` from `src/utils/encode-path.ts`
- No hardcoded credentials or tokens
- Session cookies must not be logged
- Environment filter must be applied on all environment-scoped endpoints
- `additionalConfig`/`additionalSettings` must be merged BEFORE explicit fields (not after)

### MCP Tool Quality
- All parameters must have Zod validation with `.describe()` annotations
- Tool descriptions must be clear and actionable for LLMs
- Prefer explicit typed parameters over generic `Record<string, unknown>`
- Required vs optional parameters must match the Dockhand API
- `connectionType` gating: host/port only for `hawser-standard`, not `hawser-edge`

### TypeScript
- Strict mode — no `any` types unless absolutely necessary
- Use `z.infer<>` for type derivation from Zod schemas
- All async operations must have proper error handling
- No unnecessary GET requests (e.g. don't fetch just to read one field)

### Tests
- All new tools MUST have corresponding test coverage
- `tests/path-encoding.test.ts`: every `${...}` in API paths must use `encodePath()`
- `tests/tool-registration.test.ts`: every tool module must have its register function called
- `tests/environment-scope.test.ts`: tools with `environmentId` must pass it as `env` query param
- Verify tests actually test what they claim (no false positives from loose matching)

### Dependency Updates (Dependabot)
- **Patch/Minor updates:** Auto-merge if CI passes
- **Major updates:** Review carefully for breaking changes
- **Zod v3 to v4:** Breaking change — requires migration (do NOT auto-merge)
- **Node.js major:** Check Dockerfile compatibility
- **MCP SDK updates:** Check for API changes in the SDK changelog

### Docker
- Multi-stage build must be maintained
- Non-root user (`node`) required
- Healthcheck must be present
- Base image should be Alpine-based for minimal size
