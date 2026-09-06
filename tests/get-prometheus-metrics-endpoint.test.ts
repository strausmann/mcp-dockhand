import { describe, it, expect, vi } from 'vitest';
import { registerSystemTools } from '../src/tools/system.js';

/**
 * `get_prometheus_metrics` must call the REAL Dockhand route, `/metrics`
 * (Prometheus convention — see `src/routes/metrics/+server.ts` in
 * `Finsys/dockhand` v1.0.46) — NOT `/api/metrics`, which is not a route at
 * all and 404s. Ground truth: `/opt/repos/dockhand-upstream-analyse` tag
 * `v1.0.46`, `src/routes/metrics/+server.ts` (Refs #234, #242).
 *
 * Prior to v1.0.46 the route had no `@openapi` annotation and was treated as
 * a deliberate registry/coverage gap throughout the codebase (see
 * `src/tools/meta.ts`, `scripts/generate-tool-endpoint-map.mjs`,
 * `scripts/validate-mcp-tools.mjs`) — that special-casing is now obsolete
 * and removed as part of this fix.
 */

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function setupHandlers() {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (n: string, _d: string, _s: unknown, cb: ToolHandler) => handlers.set(n, cb),
  };
  const client = {
    get: vi.fn().mockResolvedValue('# HELP dockhand_up 1\n# TYPE dockhand_up gauge\ndockhand_up 1\n'),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerSystemTools(server as any, client as any);
  return { handlers, client };
}

describe('get_prometheus_metrics', () => {
  it('calls GET /metrics (the real Dockhand route), not the stale /api/metrics', async () => {
    const { handlers, client } = setupHandlers();
    const handler = handlers.get('get_prometheus_metrics');
    expect(handler).toBeDefined();

    await handler!({});

    expect(client.get).toHaveBeenCalledWith('/metrics');
    expect(client.get).not.toHaveBeenCalledWith('/api/metrics');
  });
});
