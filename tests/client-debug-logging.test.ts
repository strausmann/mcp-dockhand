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

    const serialised = JSON.stringify(debugLines());
    expect(serialised).not.toContain('paperless');
  });

  it('falls back to a coarse template outside a tool context', async () => {
    // Login and self-check calls run without a tool context, so there is no entry in
    // TOOL_ENDPOINT_MAP to consult. Two segments is enough to tell auth from stacks
    // and cannot contain an identifier.
    const instance = await client();
    await instance.get('/api/stacks/paperless/env/raw');

    expect(debugLines()[0].route).toBe('/api/stacks');
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
    expect(line.route).toBe('/api/stacks');
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
});
