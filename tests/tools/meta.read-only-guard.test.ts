/**
 * Behavioural guard for the meta tools under MCP_READ_ONLY (issue #254, security review).
 * Meta tools are classified `read` by name, so nothing else stops one of them from calling
 * a Dockhand write endpoint. The original design claimed "no meta tool posts" from a scan
 * of registerTool() bodies only; self_check's helper did POST /api/environments/{id}/test.
 *
 * This runs every META_TOOL_NAMES handler for real against a recording fake client, with
 * fetch() stubbed, and fails on any non-GET request that is not on NON_GET_ALLOWLIST.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { registerMetaTools } from '../../src/tools/meta.js';
import { META_TOOL_NAMES } from '../../src/utils/meta-tool-names.js';
import { TOOL_ENDPOINT_MAP } from '../../src/openapi/tool-endpoint-map.js';
import {
  buildToolPolicy,
  configureToolPolicy,
  defaultToolPolicy,
  type ToolPolicy,
} from '../../src/utils/tool-policy.js';
import { logger } from '../../src/utils/logger.js';

const BASE_URL = 'http://dockhand.test';

/**
 * Non-GET requests a meta tool may make under MCP_READ_ONLY, with the reason.
 * The login probe (self_check, validate_config) POSTs /api/auth/login through fetch():
 * upstream that writes an audit entry and counts against the login rate limiter. Accepted
 * exception, see ADR-0003 — the server logs in the same way during normal operation.
 */
const NON_GET_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  self_check: ['POST /api/auth/login'],
  validate_config: ['POST /api/auth/login'],
};

/**
 * Additionally allowed only when read-only mode is OFF: self_check's per-environment
 * connection test is a write upstream and is skipped under MCP_READ_ONLY.
 */
const NON_GET_ALLOWLIST_DEFAULT_ONLY: Readonly<Record<string, readonly string[]>> = {
  self_check: ['POST /api/environments/1/test'],
};

type Handler = (args: Record<string, never>) => Promise<{ isError?: boolean }>;

/** Client and fetch() requests of the handler currently running, as "METHOD /path". */
let calls: string[] = [];

function collectHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const server = {
    tool(...args: unknown[]) {
      handlers.set(args[0] as string, args[args.length - 1] as Handler);
    },
  };
  // Every DockhandClient request method records itself; get/getRaw are the only GETs.
  const client = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'getBaseUrl') return () => BASE_URL;
        return async (path: string) => {
          const method = prop === 'get' || prop === 'getRaw' ? 'GET' : prop.toUpperCase();
          calls.push(`${method} ${path}`);
          if (prop === 'post') return { success: true };
          if (path === '/api/changelog') return [{ version: '1.0.0' }];
          if (path === '/api/environments') return [{ id: 1, name: 'env-1', connectionType: 'socket' }];
          if (path === '/api/hawser/connect') return { connections: [] };
          return {};
        };
      },
    },
  );
  registerMetaTools(server as never, client as never);
  return handlers;
}

/** Runs every meta handler; returns the requests each one made. */
async function runAll(policy: ToolPolicy): Promise<Map<string, string[]>> {
  configureToolPolicy(policy);
  const handlers = collectHandlers();
  const byTool = new Map<string, string[]>();
  for (const name of META_TOOL_NAMES) {
    const handler = handlers.get(name);
    expect(handler, `${name} registered`).toBeDefined();
    calls = [];
    const result = await handler!({});
    expect(result.isError, `${name} ran without error`).toBeFalsy();
    byTool.set(name, calls);
  }
  return byTool;
}

function nonGet(calls: readonly string[]): string[] {
  return calls.filter((c) => !c.startsWith('GET '));
}

describe('meta tools make no unlisted non-GET request', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    vi.stubEnv('DOCKHAND_URL', BASE_URL);
    vi.stubEnv('DOCKHAND_USERNAME', 'admin');
    vi.stubEnv('DOCKHAND_PASSWORD', 'secret');
    vi.stubEnv('DOCKHAND_API_TOKEN', '');
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const where = url.origin === BASE_URL ? url.pathname : `${url.host}${url.pathname}`;
      calls.push(`${(init?.method ?? 'GET').toUpperCase()} ${where}`);
      if (url.host === 'api.github.com') {
        return new Response(JSON.stringify({ tag_name: 'v0.0.1' }), { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    configureToolPolicy(defaultToolPolicy());
  });

  it('under MCP_READ_ONLY=true', async () => {
    const policy = buildToolPolicy(
      { MCP_READ_ONLY: 'true' },
      { endpointMap: TOOL_ENDPOINT_MAP, metaToolNames: META_TOOL_NAMES },
    );
    const byTool = await runAll(policy);

    for (const name of META_TOOL_NAMES) {
      const unlisted = nonGet(byTool.get(name)!).filter((c) => !(NON_GET_ALLOWLIST[name] ?? []).includes(c));
      expect(unlisted, name).toEqual([]);
    }
    // The fake really records: self_check listed environments without testing them.
    expect(byTool.get('self_check')).toContain('GET /api/environments');
  });

  it('with the default policy, only the documented read-only-gated request is added', async () => {
    const byTool = await runAll(defaultToolPolicy());

    for (const name of META_TOOL_NAMES) {
      const allowed = [...(NON_GET_ALLOWLIST[name] ?? []), ...(NON_GET_ALLOWLIST_DEFAULT_ONLY[name] ?? [])];
      const unlisted = nonGet(byTool.get(name)!).filter((c) => !allowed.includes(c));
      expect(unlisted, name).toEqual([]);
    }
    // Proves the gate is what keeps it out under read-only, not a broken fake.
    expect(byTool.get('self_check')).toContain('POST /api/environments/1/test');
  });
});
