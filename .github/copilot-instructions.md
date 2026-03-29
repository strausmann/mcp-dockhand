# Copilot Instructions — MCP-Dockhand

## Project Context

This is a Model Context Protocol (MCP) server for Dockhand Docker Management.
It wraps the Dockhand REST API into 130+ MCP tools using Streamable HTTP transport.

## Code Review Guidelines

When reviewing PRs, focus on:

### Security
- All path parameters MUST use `encodeURIComponent()` to prevent injection
- No hardcoded credentials or tokens
- Session cookies must not be logged
- Environment filter must be applied on all environment-scoped endpoints

### MCP Tool Quality
- All parameters must have Zod validation with `.describe()` annotations
- Tool descriptions must be clear and actionable for LLMs
- Prefer explicit typed parameters over generic `Record<string, unknown>`
- Required vs optional parameters must match the Dockhand API

### TypeScript
- Strict mode — no `any` types unless absolutely necessary
- Use `z.infer<>` for type derivation from Zod schemas
- All async operations must have proper error handling

### Dependency Updates (Dependabot)
- **Patch/Minor updates:** Auto-merge if CI passes
- **Major updates:** Review carefully for breaking changes
- **Zod v3 → v4:** Breaking change — requires migration (do NOT auto-merge)
- **Node.js major:** Check Dockerfile compatibility
- **MCP SDK updates:** Check for API changes in the SDK changelog

### Docker
- Multi-stage build must be maintained
- Non-root user (`node`) required
- Healthcheck must be present
- Base image should be Alpine-based for minimal size

## Known Issues

- Zod v4 migration pending (PR #13 will fail CI)
- Some tools use generic `config: Record<string, unknown>` instead of typed params (#17)
- Inconsistent `encodeURIComponent` usage (#16)
