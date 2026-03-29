---
applyTo: '**'
---

# Copilot Code Review Instructions

When reviewing pull requests in this repository:

1. **Verify against upstream Dockhand API** — check `finsys/dockhand` source code for correct HTTP methods, parameter names, and response formats. Flag any mismatch as HIGH priority.
2. **Check all path parameters** use `encodePath()` from `src/utils/encode-path.ts` — this is a security requirement.
3. **Verify Zod schemas** have `.describe()` on all parameters — LLMs need these descriptions.
4. **Flag generic types** like `Record<string, unknown>` — prefer explicit parameter definitions.
5. **Verify environment scoping** — all environment-specific tools must pass `env` query parameter.
6. **Check for breaking changes** in dependency updates — especially Zod v3 to v4 and Node.js major versions.
7. **Ensure SSE handling** for deploy/start/stop operations uses `postSSE` method.
8. **Validate error handling** — all tool handlers must catch and format errors properly.
9. **Check merge order** — `additionalConfig`/`additionalSettings` must be merged BEFORE explicit fields, not after.
10. **Verify tests** — new tools need test coverage, existing tests must not have false positives.
11. **Check for performance** — avoid unnecessary API calls (e.g. GET before every PUT just to read one field).
