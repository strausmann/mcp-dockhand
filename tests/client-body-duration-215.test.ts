/**
 * #215 — `loggedFetch`'s `ms` used to measure only time-to-headers (the `fetch()`
 * call resolves once headers arrive, before the body is consumed), so for streamed
 * responses (SSE via `parseSSEResponse`, `getRaw`'s `arrayBuffer()`) it lied: a tiny
 * `ms` while the body kept streaming for minutes. `bytes` never existed at all —
 * this also adds it, as the real consumed body size.
 *
 * Fix (Variante A): `loggedFetch` wraps `response.body` in a counting proxy stream
 * and returns a new `Response` over it. The debug/warn line now fires when the BODY
 * is done (flush), errors (body-read failure), or is cancelled (discarded 401
 * attempt) — never right after `fetch()` resolves. `loggedFetch` stays the single
 * emission point; callers read the body exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A real `Response` whose body streams out in two chunks with a delay between
 * them — so a header-time measurement stays near 0 while a body-inclusive
 * measurement spans (at least) `chunkDelayMs`.
 */
function delayedBodyResponse(
  text: string,
  opts: { status?: number; contentType?: string | null; chunkDelayMs?: number } = {},
): Response {
  const { status = 200, contentType = 'application/json', chunkDelayMs = 40 } = opts;
  const encoded = new TextEncoder().encode(text);
  const mid = Math.max(1, Math.floor(encoded.length / 2));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoded.slice(0, mid));
      await delay(chunkDelayMs);
      controller.enqueue(encoded.slice(mid));
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: contentType ? { 'content-type': contentType } : undefined,
  });
}

/** A custom, named error — avoids relying on DOMException's exact prototype chain. */
class MockAbortError extends Error {
  override name = 'AbortError';
}

/** A `Response` whose body errors partway through the read (simulates an SSE
 * timeout or a dropped connection mid-stream). */
function erroringBodyResponse(opts: { status?: number; contentType?: string } = {}): Response {
  const { status = 200, contentType = 'application/json' } = opts;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'));
      await delay(5);
      controller.error(new MockAbortError('aborted mid-body'));
    },
  });
  return new Response(stream, { status, headers: { 'content-type': contentType } });
}

describe('loggedFetch body-inclusive duration + real bytes (#215)', () => {
  let written: string[];

  beforeEach(() => {
    vi.resetModules();
    process.env['LOG_LEVEL'] = 'debug';
    written = [];
    // Same rationale as tests/client-debug-logging.test.ts: pino.destination() is a
    // SonicBoom stream that writes via fs.writeSync directly, not process.stderr.write.
    vi.spyOn(fs, 'writeSync').mockImplementation((_fd: unknown, chunk: unknown) => {
      const text = String(chunk);
      written.push(text);
      return Buffer.byteLength(text);
    });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance as any).session = { getCookie: async () => 'session=x', invalidate: () => {} };
    return instance;
  }

  function debugLines() {
    const joined = written.join('').trim();
    if (!joined) return [];
    return joined
      .split('\n')
      .map((l) => JSON.parse(l))
      .filter((l) => l.component === 'client' && l.level === 'debug');
  }

  function warnLines() {
    const joined = written.join('').trim();
    if (!joined) return [];
    return joined
      .split('\n')
      .map((l) => JSON.parse(l))
      .filter((l) => l.component === 'client' && l.level === 'warn');
  }

  it('reports real bytes for a small JSON response, not 0', async () => {
    const body = '{"stacks":[]}';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const instance = await client();
    await instance.get('/api/stacks');

    const [line] = debugLines();
    expect(line.status).toBe(200);
    expect(typeof line.ms).toBe('number');
    expect(line.ms).toBeGreaterThanOrEqual(0);
    expect(line.bytes).toBe(Buffer.byteLength(body));
    expect(line.bytes).toBeGreaterThan(0);
  });

  it('ms spans the (mocked) body read, not just time-to-headers — SSE/delayed body', async () => {
    const body = JSON.stringify({ success: true, jobId: 'abc' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(delayedBodyResponse(body, { chunkDelayMs: 60 }));

    const instance = await client();
    const started = Date.now();
    await instance.postSSE('/api/stacks/paperless/start');
    const wallClockElapsed = Date.now() - started;

    const [line] = debugLines();
    // Header-time alone (the pre-fix behaviour) would be ~0ms here, because fetch()
    // itself resolves immediately (mockResolvedValueOnce) — all the delay lives in
    // the body stream, which only the FIX's body-inclusive measurement can see.
    expect(line.ms).toBeGreaterThanOrEqual(50);
    // Sanity: the logged ms is not larger than the actual wall-clock time this test
    // took end to end (would indicate a bogus/huge value, not a real duration).
    expect(line.ms).toBeLessThanOrEqual(wallClockElapsed + 50);
    expect(line.bytes).toBe(Buffer.byteLength(body));
  });

  it('COUNTER-CHECK: against the pre-fix header-time emission, the above assertion goes RED', async () => {
    // This test does not call the client at all — it documents, executably, what
    // the pre-fix code measured for the exact same mocked delay: `fetch()` resolves
    // as soon as headers are available, so a header-time timer reads ~0ms even
    // though the body linked to that same Response takes 60ms to fully drain.
    // (Full counter-check — literally running the OLD loggedFetch against this
    // fixture and observing red — is reproduced by hand in the report per the
    // brief; this in-suite version keeps the claim executable without requiring a
    // git-stash dance inside CI.)
    const started = Date.now();
    const response = delayedBodyResponse(JSON.stringify({ ok: true }), { chunkDelayMs: 60 });
    const headerTimeMs = Date.now() - started; // what the pre-fix code would have logged
    expect(headerTimeMs).toBeLessThan(50); // ~0, NOT the 60ms body delay

    // The body-inclusive duration (what the FIX measures) is materially larger.
    const bodyStarted = Date.now();
    await response.text();
    const bodyInclusiveMs = Date.now() - bodyStarted;
    expect(bodyInclusiveMs).toBeGreaterThanOrEqual(50);
    expect(bodyInclusiveMs).toBeGreaterThan(headerTimeMs);
  });

  it('401 then success on postSSE: TWO debug lines, none lost (discarded attempt is cancelled, not silently dropped)', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const instance = await client();
    await instance.postSSE('/api/stacks/paperless/start');

    const lines = debugLines();
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.status)).toEqual([401, 200]);
    expect(lines[0].bytes).toBe(0);
    expect(lines[1].bytes).toBeGreaterThan(0);
  });

  it('body-read error mid-stream emits a WARN line with ms + errType (no line existed for this before the fix)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(erroringBodyResponse());

    const instance = await client();
    await expect(instance.get('/api/stacks')).rejects.toThrow();

    const [line] = warnLines();
    expect(line).toBeDefined();
    expect(line.errType).toBe('AbortError');
    expect(typeof line.ms).toBe('number');
    expect(line.ms).toBeGreaterThanOrEqual(0);
    // No debug (success) line for this attempt.
    expect(debugLines()).toHaveLength(0);
  });

  it('fetch() rejecting (headers never arrive) still emits the warn line unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));

    const instance = await client();
    await expect(instance.get('/api/stacks')).rejects.toThrow('fetch failed');

    const [line] = warnLines();
    expect(line).toBeDefined();
    expect(line.errType).toBe('TypeError');
    expect(typeof line.ms).toBe('number');
    expect(debugLines()).toHaveLength(0);
  });

  it('emits immediately for a null body (e.g. a 204) — no stream to wrap, bytes 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));

    const instance = await client();
    await instance.get('/api/stacks/paperless/start');

    const lines = debugLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].status).toBe(204);
    expect(lines[0].bytes).toBe(0);
    expect(typeof lines[0].ms).toBe('number');
  });

  it('never leaks a value: route stays a template, query stays names-only', async () => {
    const body = JSON.stringify({ success: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const instance = await client();
    await instance.post('/api/git/webhook/42', undefined, { secret: 'hunter2' });

    const serialised = JSON.stringify(debugLines());
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('42');
    expect(debugLines()[0].query).toEqual(['secret']);
  });
});
