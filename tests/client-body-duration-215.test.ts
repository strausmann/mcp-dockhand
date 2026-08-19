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
 * A real `Response` whose body streams out in two chunks — the SECOND chunk is
 * only enqueued (after `chunkDelayMs`) once the stream's `pull()` is invoked a
 * second time, which only happens once a consumer has actually read the FIRST
 * chunk. The delay clock therefore starts at body-CONSUMPTION time, not at
 * response-construction time — unlike a `start()`-based delay (the original
 * version of this fixture), whose clock started the instant this function was
 * called, before `fetch()` even resolved. That made the "ms spans body read"
 * test flaky: the fixed window (e.g. 60ms) had to absorb whatever unrelated
 * overhead (dynamic import, cookie lookup, scheduler jitter) sat between
 * construction and the client actually starting to read — sometimes eating
 * enough of the window that the measured `ms` dropped under the threshold
 * with NO code defect (reproduced: ms=49,36,40,39,24 across repeated runs).
 * Tying the delay to `pull()` removes that race entirely: the delay is now
 * guaranteed to happen strictly after the client begins reading the body.
 */
function delayedBodyResponse(
  text: string,
  opts: { status?: number; contentType?: string | null; chunkDelayMs?: number } = {},
): Response {
  const { status = 200, contentType = 'application/json', chunkDelayMs = 40 } = opts;
  const encoded = new TextEncoder().encode(text);
  const mid = Math.max(1, Math.floor(encoded.length / 2));
  let pullCount = 0;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      pullCount += 1;
      if (pullCount === 1) {
        controller.enqueue(encoded.slice(0, mid));
        return;
      }
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

/** A real `Response` whose body is a genuine (non-null) `ReadableStream` that
 * resolves immediately — used where a test needs a truthy, streamable body
 * without caring about timing (e.g. exercising the `cancel()` path, Finding 3:
 * a `Response(null, ...)` body is `null`, which takes the immediate-emit
 * "nothing to wrap" branch and never touches the proxy stream at all). */
function streamedResponse(text: string, opts: { status?: number; contentType?: string | null } = {}): Response {
  const { status = 200, contentType = 'application/json' } = opts;
  const encoded = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
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

  it('ms grows by (about) the mocked body delay — proves ms spans body read, not just header time (Finding 1 fix: RELATIVE comparison, no fixed absolute threshold)', async () => {
    // Three calls against the SAME already-imported client instance so all
    // three share whatever fixed overhead exists (cookie lookup, event-loop
    // scheduling) — but the FIRST call in a fresh process additionally pays a
    // one-off cold-start cost (module JIT, the very first ReadableStream ever
    // constructed) that has nothing to do with the mocked delay and can be
    // LARGER than the delay itself. Measured directly (outside vitest, a
    // throwaway script instrumented for this): an instant response as the
    // very first call read ms=101/150/186/90 across runs, while the SAME
    // instant response as the SECOND call (after a throwaway first call)
    // read ms=1-3 every time. Comparing an un-warmed baseline against a
    // warmed-up delayed call (or vice versa) makes the diff swing on cold-
    // start noise, not on the delay — which is exactly why the two-call
    // version of this test (baseline then delayed, no warmup) failed
    // intermittently at ~44ms against an 80ms delay. A throwaway WARMUP call
    // absorbs that one-off cost before either measured call runs.
    const instance = await client();

    const warmupBody = JSON.stringify({ success: true, jobId: 'warmup' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(warmupBody, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await instance.postSSE('/api/stacks/paperless/start');
    written.length = 0; // discard the warmup call's line — not part of the measurement

    // Baseline: identical call shape, no artificial delay — stands in for
    // "what would header-time alone have measured for this exact request
    // machinery", now with cold-start cost already paid by the warmup call.
    const baselineBody = JSON.stringify({ success: true, jobId: 'baseline' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(baselineBody, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await instance.postSSE('/api/stacks/paperless/start');
    const [baselineLine] = debugLines();
    expect(baselineLine).toBeDefined();

    written.length = 0; // isolate the delayed call's line from the baseline's

    const chunkDelayMs = 80;
    const delayedBody = JSON.stringify({ success: true, jobId: 'delayed' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(delayedBodyResponse(delayedBody, { chunkDelayMs }));
    await instance.postSSE('/api/stacks/paperless/start');
    const [delayedLine] = debugLines();
    expect(delayedLine).toBeDefined();

    // The delayed call's ms must exceed the baseline's by roughly the mocked
    // delay. 30ms of slack absorbs scheduler jitter without weakening the
    // claim: header-time-only (the pre-fix behaviour) would show ~0 growth
    // here, since fetch() itself resolves immediately either way — all 80ms
    // live in the body stream, which only a body-inclusive measurement sees.
    expect(delayedLine.ms - baselineLine.ms).toBeGreaterThanOrEqual(chunkDelayMs - 30);
    expect(delayedLine.ms).toBeGreaterThan(baselineLine.ms);
    expect(delayedLine.bytes).toBe(Buffer.byteLength(delayedBody));
  });

  it('COUNTER-CHECK: a header-time-only measurement of the same delayed body reads near-zero, NOT the body delay', async () => {
    // Documents, executably, what a header-time-only implementation would
    // have measured for the exact same mocked delay: constructing the
    // response (equivalent to fetch() resolving with headers) is
    // near-instant; only READING the body (what the fix's measurement spans)
    // takes ~chunkDelayMs. This is a relative comparison (bodyInclusiveMs vs
    // headerTimeMs), same style as the fix above — not an absolute floor.
    const started = Date.now();
    const response = delayedBodyResponse(JSON.stringify({ ok: true }), { chunkDelayMs: 60 });
    const headerTimeMs = Date.now() - started; // what a header-time-only measurement would log

    const bodyStarted = Date.now();
    await response.text();
    const bodyInclusiveMs = Date.now() - bodyStarted;

    expect(bodyInclusiveMs).toBeGreaterThan(headerTimeMs);
    expect(bodyInclusiveMs - headerTimeMs).toBeGreaterThanOrEqual(35);
  });

  it('401 then success on postSSE: TWO debug lines, none lost (discarded attempt is cancelled via a REAL stream, not silently dropped)', async () => {
    // Finding 3: a `Response(null, { status: 401 })` body is `null`, which
    // takes the immediate-emit "nothing to wrap" branch — the proxy stream
    // and its cancel() handler are never even constructed, so this test
    // previously proved nothing about the cancel() path (confirmed: removing
    // `emitDebug()` from cancel() left every test green). Mocking a REAL
    // streamed 401 body forces the discard to actually go through
    // `response.body?.cancel()` -> the proxy's `cancel()` handler.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(streamedResponse('{"error":"unauthorized"}', { status: 401 }))
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
    // The 401 attempt's body was never read by anyone — cancelled, not consumed.
    expect(lines[0].bytes).toBe(0);
    expect(lines[1].bytes).toBeGreaterThan(0);
  });

  it('body-read error mid-stream emits a WARN line with status + ms + errType (no line existed for this before the fix)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(erroringBodyResponse({ status: 200 }));

    const instance = await client();
    await expect(instance.get('/api/stacks')).rejects.toThrow();

    const [line] = warnLines();
    expect(line).toBeDefined();
    // Finding 4: status is known here (headers DID arrive) — distinguishes
    // "500 that then broke mid-body" from "200 that broke mid-body".
    expect(line.status).toBe(200);
    expect(line.errType).toBe('AbortError');
    expect(typeof line.ms).toBe('number');
    expect(line.ms).toBeGreaterThanOrEqual(0);
    // No debug (success) line for this attempt.
    expect(debugLines()).toHaveLength(0);
  });

  it('fetch() rejecting (headers never arrive) still emits the warn line unchanged — no status field (no response ever arrived)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));

    const instance = await client();
    await expect(instance.get('/api/stacks')).rejects.toThrow('fetch failed');

    const [line] = warnLines();
    expect(line).toBeDefined();
    expect(line.errType).toBe('TypeError');
    expect(typeof line.ms).toBe('number');
    expect(line.status).toBeUndefined();
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

  it('never leaks a value: route stays a template, query stays names-only (Finding 2 fix: assertions scoped to route/query fields, not the whole serialised line)', async () => {
    // The original version of this test asserted `not.toContain('42')` over
    // the ENTIRE serialised line, including pino's ISO `time` field (e.g.
    // "...:06.421Z" contains the substring "42") and `pid` — a blind
    // substring search over unrelated numeric fields, guaranteed to
    // eventually collide by pure timestamp coincidence. Scoping the
    // assertions to the specific fields that could actually leak (`route`,
    // `query`) removes that false-positive surface entirely. The secret
    // marker itself is also now non-numeric, so it can never coincidentally
    // match a timestamp/pid digit run either.
    const body = JSON.stringify({ success: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const instance = await client();
    await instance.post('/api/git/webhook/9001', undefined, { secret: 'zzz-marker-should-never-leak-zzz' });

    const [line] = debugLines();
    expect(line.route).not.toContain('zzz-marker-should-never-leak-zzz');
    expect(line.route).not.toContain('9001');
    expect(JSON.stringify(line.query)).not.toContain('zzz-marker-should-never-leak-zzz');
    expect(line.query).toEqual(['secret']);
  });
});
