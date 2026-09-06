/**
 * This is the file the whole "structural, not a filter list" argument rests on. The
 * client is the only place that ever holds a concrete URL, and it must never write
 * one.
 *
 * The webhook case is not hypothetical: trigger_git_webhook puts its secret in the
 * query string, which is exactly why src/utils/redact.ts exists for error messages.
 * A debug line that logged the URL would reopen that hole at a second surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

describe('client debug logging', () => {
  let written: string[];

  beforeEach(() => {
    vi.resetModules();
    process.env['LOG_LEVEL'] = 'debug';
    written = [];
    // NOT process.stderr.write: pino.destination({ fd: 2, sync: true }) is a SonicBoom
    // stream that calls fs.writeSync(fd, ...) directly and never touches
    // process.stderr.write, so a spy there captures nothing and the test reads as
    // "the logger wrote nothing" no matter what it wrote. Verified against Task 1's
    // logger while implementing Task 3. Spy on the DEFAULT import — a namespace
    // import is a frozen ESM object and vi.spyOn cannot replace a property on it.
    vi.spyOn(fs, 'writeSync').mockImplementation((_fd: unknown, chunk: unknown) => {
      const text = String(chunk);
      written.push(text);
      // SonicBoom reads this as the number of bytes it released from its internal
      // buffer. Returning 0 while data was actually captured makes it believe
      // nothing was written and retry the same buffer forever — an infinite loop
      // that OOMs the worker in a test that otherwise does almost nothing. Bit the
      // Task 7 implementer on its first run; reproduced here on the first run of
      // this file before this fix.
      return Buffer.byteLength(text);
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });

  afterEach(() => {
    delete process.env['LOG_LEVEL'];
    vi.restoreAllMocks();
  });

  async function client() {
    const { DockhandClient } = await import('../src/client/dockhand-client.js');
    const instance = new DockhandClient({
      url: 'https://dockhand.example',
      username: 'svc',
      password: 'pw',
    });
    // The session manager would try to log in first; hand it a cookie.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance as any).session = { getCookie: async () => 'session=x', invalidate: () => {} };
    return instance;
  }

  function debugLines() {
    const joined = written.join('').trim();
    // written stays empty when the level filter suppresses every debug call — no
    // fs.writeSync happens at all, so there is nothing to split/parse.
    if (!joined) return [];
    return joined
      .split('\n')
      .map((l) => JSON.parse(l))
      .filter((l) => l.component === 'client');
  }

  it('logs the method, status and duration', async () => {
    const instance = await client();
    await instance.get('/api/stacks');

    const [line] = debugLines();
    expect(line.level).toBe('debug');
    expect(line.method).toBe('GET');
    expect(line.status).toBe(200);
    expect(typeof line.ms).toBe('number');
  });

  it('never writes a query value, only the parameter names', async () => {
    const instance = await client();
    await instance.post('/api/git/webhook/42', undefined, { secret: 'hunter2', env: 'prod' });

    const serialised = JSON.stringify(debugLines());
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('prod');
    expect(debugLines()[0].query.sort()).toEqual(['env', 'secret']);
  });

  it('never writes the concrete path', async () => {
    const instance = await client();
    await instance.get('/api/stacks/paperless/env/raw');

    // Non-empty first: "contains no path" is trivially true of a line that was never
    // written, which would make this test green against the very version it exists to
    // rule out (see the identical guard on 'never carries the ...' tests elsewhere).
    const lines = debugLines();
    expect(lines.length).toBeGreaterThan(0);

    const serialised = JSON.stringify(lines);
    expect(serialised).not.toContain('paperless');
  });

  it('emits exactly one route key inside a tool context — no stale tool-wide route (Codex #219)', async () => {
    // The production path: a request made from inside a tool invocation. registerTool used
    // to BIND the tool's single route into the log context, log() baked it into the pino
    // child, and loggedFetch's own matched route did not replace it — pino serialized BOTH
    // keys, so a fan-out line carried the stale tool-wide route alongside the correct one.
    // JSON.parse silently keeps the last duplicate, which is exactly why the other tests in
    // this file (which parse) never saw it — this one asserts on the RAW line.
    const { runWithLogContext } = await import('../src/utils/log-context.js');
    const instance = await client();
    await runWithLogContext({ sid: 's', req: 'r', call: 'c', tool: 'remove_stack_env_vars' }, async () => {
      await instance.get('/api/stacks/paperless/env/raw');
    });

    const clientLine = written
      .join('')
      .trim()
      .split('\n')
      .find((l) => l.includes('"component":"client"'));
    expect(clientLine).toBeDefined();
    // Exactly one "route" in the raw JSON — a duplicate is the bug.
    expect((clientLine!.match(/"route"/g) ?? []).length).toBe(1);
    // And it is the request's own matched template, not any tool-wide value.
    expect((JSON.parse(clientLine!) as { route: string }).route).toBe('/api/stacks/{name}/env/raw');
  });

  it('matches a request to its own template regardless of tool context', async () => {
    // The route now comes from matchRoute() reverse-matching THIS request's own
    // pathname against the spec (src/openapi/match-route.ts) — not from a tool-scope
    // context — so a request outside a tool context (login, self-check; here simulated
    // by calling the client directly, with no runWithLogContext() wrapping it) still
    // gets its own exact template, the same as a request made through a tool.
    const instance = await client();
    await instance.get('/api/stacks/paperless/env/raw');

    expect(debugLines()[0].route).toBe('/api/stacks/{name}/env/raw');
  });

  it('falls back to a coarse template for a pathname matching no known template', async () => {
    // Two segments is enough to tell one area of the API from another and cannot
    // contain an identifier — the fallback for a path the spec has no template for
    // (a stale TOOL_ENDPOINT_MAP entry, or the spec being unavailable at runtime).
    const instance = await client();
    await instance.get('/api/does-not-exist/foo/bar');

    expect(debugLines()[0].route).toBe('/api/does-not-exist');
  });

  it('says nothing at all at info level', async () => {
    process.env['LOG_LEVEL'] = 'info';
    vi.resetModules();
    const instance = await client();
    await instance.get('/api/stacks');

    expect(debugLines()).toHaveLength(0);
  });

  it('logs a network failure at warn without leaking the URL, and still throws', async () => {
    // Every other test uses mockResolvedValue, so fetch never rejects and this branch
    // never runs — meaning the secret guarantee on the warn line was, until this test,
    // held by review alone, not by a test. The wrapper's catch block is the only place
    // in the file this can be exercised.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const instance = await client();
    await expect(instance.get('/api/stacks/paperless/env/raw')).rejects.toThrow('fetch failed');

    const [line] = debugLines();
    expect(line.level).toBe('warn');
    expect(line.route).toBe('/api/stacks/{name}/env/raw');
    expect(line.errType).toBe('TypeError');
    expect(JSON.stringify(line)).not.toContain('paperless');
  });

  it('logs the 401 retry as its own line with the same route', async () => {
    // The whole point of one shared wrapper instead of patching each of the eight
    // call sites individually: a retry after a 401 shows up as a second, independent
    // line — which is exactly what you want to see when debugging an auth problem.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );

    const instance = await client();
    await instance.get('/api/stacks');

    const lines = debugLines();
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.status)).toEqual([401, 200]);
    expect(lines[0].route).toBe(lines[1].route);
  });

  it('gives two calls to different endpoints two distinct, correct routes (Issue #214)', async () => {
    // The bug this fixes: a tool that fans out to several endpoints (e.g.
    // remove_stack_env_vars hitting both /env and /env/raw) used to log the SAME
    // route — the tool's single TOOL_ENDPOINT_MAP entry — for every request it made,
    // regardless of which endpoint actually got hit. Each request now derives its own
    // route from its own pathname, so two calls to two different endpoints on the same
    // client produce two distinct, individually-correct route values.
    const instance = await client();
    // The shared `beforeEach` mock resolves to a single Response instance; a second
    // read of its already-consumed body throws, so each call needs its own instance.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await instance.get('/api/stacks/paperless/env');
    await instance.get('/api/stacks/paperless/env/raw');

    const lines = debugLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]?.route).toBe('/api/stacks/{name}/env');
    expect(lines[1]?.route).toBe('/api/stacks/{name}/env/raw');
    expect(lines[0]?.route).not.toBe(lines[1]?.route);
  });
});
