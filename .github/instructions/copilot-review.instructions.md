---
applyTo: '**'
---

# Copilot Code Review Instructions

When reviewing pull requests in this repository:

1. **Check all path parameters** use `encodeURIComponent()` — this is a security requirement
2. **Verify Zod schemas** have `.describe()` on all parameters — LLMs need these descriptions
3. **Flag generic types** like `Record<string, unknown>` — prefer explicit parameter definitions
4. **Verify environment scoping** — all environment-specific tools must pass `env` query parameter
5. **Check for breaking changes** in dependency updates — especially Zod v3→v4 and Node.js major versions
6. **Ensure SSE handling** for deploy/start/stop operations uses `postSSE` method
7. **Validate error handling** — all tool handlers must catch and format errors properly
