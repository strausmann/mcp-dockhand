---
applyTo: '**'
---

# Gemini Code Assist Review Instructions

This repository wraps the Dockhand REST API (https://github.com/finsys/dockhand) into MCP tools.

## Upstream Verification (CRITICAL)

For every MCP tool change, verify against the upstream Dockhand source:

- **API Routes:** `src/routes/api/**/+server.ts` in finsys/dockhand defines the actual endpoints
- **HTTP Methods:** Each `+server.ts` exports named functions (GET, POST, PUT, DELETE, PATCH)
- **Request Bodies:** Check what the route handler actually parses from the request
- **Hawser Protocol:** `internal/protocol/messages.go` in finsys/hawser for agent communication

If an MCP tool uses a different HTTP method or parameter name than the upstream source, flag as HIGH.

## Code Quality Checks

1. All path parameters must use `encodePath()` (path injection prevention)
2. All Zod parameters must have `.describe()` annotations
3. No `Record<string, unknown>` — use explicit typed parameters
4. `additionalConfig`/`additionalSettings` merged BEFORE explicit fields
5. No unnecessary API calls (don't fetch just to read connectionType)
6. Tests must actually validate what they claim (no loose string matching)
7. API schema (`docs/dockhand-api-schema.json`) must stay deterministic
