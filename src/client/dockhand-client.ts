/**
 * HTTP Client for the Dockhand REST API.
 * Handles cookie-based auth, auto-relogin, SSE parsing, and env parameter injection.
 */

import { ReadableStream } from 'node:stream/web';
import { SessionManager } from '../auth/session.js';
import type { DockhandConfig, SSEResult } from '../types/dockhand.js';
import { normalizeBaseUrl } from '../utils/url.js';
import { redactQueryStrings } from '../utils/redact.js';
import { log } from '../utils/log-context.js';
import { matchRoute } from '../openapi/match-route.js';

/** Timeout for SSE streaming responses (5 minutes). */
const SSE_TIMEOUT_MS = 300_000;

/**
 * Fallback for calls made outside a tool context (login, self-check) and for any tool
 * with no `TOOL_ENDPOINT_MAP` entry — the latter arrives with caller-supplied path
 * parameters already substituted into `pathname`, same as the former. The first two
 * path segments are coarse on purpose — enough to tell /api/auth from /api/stacks and
 * short enough that it cannot contain an identifier.
 */
function coarseRoute(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean).slice(0, 2);
  return `/${segments.join('/')}`;
}

export class DockhandClient {
  private session: SessionManager;
  private baseUrl: string;

  constructor(config: DockhandConfig) {
    this.baseUrl = normalizeBaseUrl(config.url);
    this.session = new SessionManager(config);
  }

  /**
   * Returns the normalized base URL this client actually sends requests to (trailing
   * slash(es) stripped by `normalizeBaseUrl()`, see src/utils/url.ts / Issue #116) — as
   * opposed to the raw `DOCKHAND_URL` env var, which may still carry a trailing slash.
   * Used by `get_server_info` (src/tools/meta.ts) so that diagnostic tool reports what
   * this client actually does, not what the operator happened to type into the config.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Make an authenticated GET request.
   */
  async get<T = unknown>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>('GET', url);
  }

  /**
   * Make an authenticated POST request.
   */
  async post<T = unknown>(path: string, body?: unknown, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>('POST', url, body);
  }

  /**
   * Make an authenticated PUT request.
   */
  async put<T = unknown>(path: string, body?: unknown, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>('PUT', url, body);
  }

  /**
   * Make an authenticated DELETE request.
   *
   * `body` is optional because most DELETE endpoints take no payload — but a few
   * real Dockhand endpoints (e.g. `DELETE /api/users/{id}/roles`) read their
   * target from `request.json()` rather than from query params or the path, so
   * the client needs to support sending one. See `remove_user_role`.
   */
  async delete<T = unknown>(path: string, params?: Record<string, string | number | undefined>, body?: unknown): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>('DELETE', url, body);
  }

  /**
   * Make an authenticated GET request that returns raw bytes (e.g. tar archives).
   *
   * Fix #30 (MEDIUM): Refactored to reuse requestRaw() for auth/retry logic (PR #23).
   */
  async getRaw(path: string, params?: Record<string, string | number | undefined>): Promise<Buffer> {
    const url = this.buildUrl(path, params);
    const response = await this.requestRaw('GET', url);
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Make an authenticated POST request with multipart/form-data body.
   * Used for file upload endpoints that expect a 'files' field.
   *
   * Fix #30 (MEDIUM): Refactored to reuse requestRaw() for auth/retry logic (PR #23).
   */
  async postMultipart<T = unknown>(path: string, formData: FormData, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    const response = await this.requestRaw('POST', url, formData, { 'Accept': 'application/json' });

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    const text = await response.text();
    return text as unknown as T;
  }

  /**
   * Make a POST request that returns SSE (Server-Sent Events).
   * Used for deploy, start, stop, down, restart operations.
   */
  async postSSE(path: string, body?: unknown, params?: Record<string, string | number | undefined>): Promise<SSEResult> {
    const url = this.buildUrl(path, params);
    const cookie = await this.session.getCookie();

    const headers: Record<string, string> = {
      'Cookie': cookie,
      'Accept': 'text/event-stream',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await this.loggedFetch('POST', url, {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(SSE_TIMEOUT_MS),
    });

    if (response.status === 401) {
      this.session.invalidate();
      // This attempt's body is never read — cancel it so #215's proxy stream
      // still fires its (discarded-attempt) debug line instead of never firing.
      await response.body?.cancel();
      // Retry once after re-login
      const retryCookie = await this.session.getCookie();
      headers['Cookie'] = retryCookie;
      const retryResponse = await this.loggedFetch('POST', url, {
        method: 'POST',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(SSE_TIMEOUT_MS),
      });
      return this.parseSSEResponse(retryResponse);
    }

    return this.parseSSEResponse(response);
  }

  /**
   * Make a PUT request that may return SSE (e.g., compose update with restart=true).
   */
  async putSSE(path: string, body?: unknown, params?: Record<string, string | number | undefined>): Promise<SSEResult> {
    const url = this.buildUrl(path, params);
    const cookie = await this.session.getCookie();

    const headers: Record<string, string> = {
      'Cookie': cookie,
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
    };

    const response = await this.loggedFetch('PUT', url, {
      method: 'PUT',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(SSE_TIMEOUT_MS),
    });

    if (response.status === 401) {
      this.session.invalidate();
      // See postSSE() above: cancel this attempt's unread body so its #215
      // debug line still fires.
      await response.body?.cancel();
      const retryCookie = await this.session.getCookie();
      headers['Cookie'] = retryCookie;
      const retryResponse = await this.loggedFetch('PUT', url, {
        method: 'PUT',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(SSE_TIMEOUT_MS),
      });
      return this.parseSSEResponse(retryResponse);
    }

    return this.parseSSEResponse(response);
  }

  // --- Private helpers ---

  /**
   * The single place this client talks to the network, so the single place a debug
   * line belongs.
   *
   * It logs the endpoint TEMPLATE, never `url`. That is not politeness: `url` carries
   * stack names, container ids and — for trigger_git_webhook — a secret in the query
   * string. There is deliberately no code path here that can write a value, rather than
   * a filter that has to keep up with every parameter a future tool introduces.
   *
   * The template comes from `matchRoute()` (src/openapi/match-route.ts), which
   * reverse-matches THIS request's own `parsed.pathname` against the pinned spec's known
   * path templates — not from the tool-scope context. A tool that fans out to several
   * endpoints (e.g. remove_stack_env_vars hitting both `/env` and `/env/raw`) previously
   * logged the same context-supplied route for every one of its requests; matching each
   * request's own pathname gives each of them its own, correct route. `matchRoute()`
   * only ever returns one of the spec's known template strings, so this is exact, the
   * same way the context-supplied route used to be. For the `coarseRoute()` fallback —
   * used when the pathname matches no known template, e.g. a stale `TOOL_ENDPOINT_MAP`
   * entry pointing at a path the pinned spec no longer has, or the spec being
   * unavailable at runtime — it is a truncation argument instead: two path segments are
   * short enough that no identifier fits, even though the segments themselves come from
   * the same caller-supplied `pathname` that `url` would expose in full.
   */
  private async loggedFetch(method: string, url: string, init: RequestInit): Promise<Response> {
    const started = Date.now();
    const parsed = new URL(url);
    const route = matchRoute(parsed.pathname, method) ?? coarseRoute(parsed.pathname);
    const query = [...parsed.searchParams.keys()];

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      // Flat `errType`, not nested under `err`: pino's default error serializer
      // treats ANY object carrying a `message` key as error-like and overwrites
      // `type` with the constructor name — a nested `err: { type }` here would be
      // one added `message` field away from silently logging "type":"Object"
      // instead of the exception name. `error.name` is bounded to the DOM/Node
      // exception vocabulary (TypeError, TimeoutError, AbortError, ...) and —
      // unlike the previous hardcoded 'NetworkError' — actually reflects what
      // AbortSignal.timeout() throws when the SSE timeout fires.
      //
      // Headers never arrived here — there is no body to wrap, and no `response`
      // to hand back. Unchanged from before #215.
      log().warn(
        {
          component: 'client',
          method,
          route,
          ...(query.length ? { query } : {}),
          ms: Date.now() - started,
          errType: error instanceof Error ? error.name : 'UnknownError',
        },
        'dockhand request failed',
      );
      throw error;
    }

    return this.wrapBodyForLogging(response, { method, route, query, started });
  }

  /**
   * #215: `fetch()` resolves as soon as the response HEADERS arrive, before the
   * body is read — for a streamed response (SSE via `parseSSEResponse`, a large
   * `arrayBuffer()`) that made the debug line's `ms` time-to-headers instead of
   * request duration, and `bytes` never existed (no `Content-Length` at header
   * time for a chunked/streamed body).
   *
   * Fix: replace `response.body` with a small counting proxy stream and return a
   * new `Response` over it (status/statusText/headers copied, nothing else about
   * the response changes). Callers keep reading the body exactly as before
   * (`.json()`/`.text()`/`.arrayBuffer()`/SSE parsing) — the proxy is transparent
   * to them. `loggedFetch` stays the ONLY place that emits the debug/warn line;
   * it now just emits it later, at body completion instead of right after
   * `fetch()` resolves:
   *
   * - Body fully read (flush): debug line, `ms` spans the whole body read,
   *   `bytes` is the real consumed size.
   * - Body read throws mid-stream (e.g. the SSE `AbortSignal.timeout` firing
   *   while a stream is still open): warn line with `ms` + `errType` — there was
   *   no line at all for this before #215.
   * - Body cancelled without being read (the four call sites that discard a 401
   *   response's body before retrying call `response.body?.cancel()`): debug
   *   line fires exactly as if flushed, `bytes` reflects whatever was counted
   *   before the cancel (0 for an unread body).
   * - `response.body` is falsy (`null` for a real null-body response e.g. a 204,
   *   or `undefined` for the hand-rolled response objects several existing tests
   *   mock `fetch()` with — those never gained a `.body` property and must keep
   *   working unmodified): nothing to wrap, emit immediately with `bytes: 0`.
   *
   * An `emitted` guard makes sure exactly one of these fires per attempt, no
   * matter which path gets there first.
   */
  private wrapBodyForLogging(
    response: Response,
    ctx: { method: string; route: string; query: string[]; started: number },
  ): Response {
    const { method, route, query, started } = ctx;
    const status = response.status;
    let emitted = false;
    let bytes = 0;

    const emitDebug = () => {
      if (emitted) return;
      emitted = true;
      log().debug(
        {
          component: 'client',
          method,
          route,
          ...(query.length ? { query } : {}),
          status,
          ms: Date.now() - started,
          bytes,
        },
        'dockhand request',
      );
    };

    const emitWarn = (error: unknown) => {
      if (emitted) return;
      emitted = true;
      // Unlike the fetch()-reject warn in loggedFetch (no response ever arrived,
      // so no status to report), headers DID arrive here — `status` is known and
      // worth a triage signal: "500 that then broke mid-body" reads very
      // differently from "200 that broke mid-body".
      log().warn(
        {
          component: 'client',
          method,
          route,
          ...(query.length ? { query } : {}),
          status,
          ms: Date.now() - started,
          errType: error instanceof Error ? error.name : 'UnknownError',
        },
        'dockhand request failed',
      );
    };

    // No stream to wrap. Also covers the hand-rolled `{ ok, status, json, text,
    // headers }` response objects several existing tests mock `fetch()` with —
    // those never had a `.body` property (`undefined`), same "nothing to wrap"
    // treatment as a real null body (`null`).
    if (!response.body) {
      emitDebug();
      return response;
    }

    const source = response.body;
    const reader = source.getReader();

    // A `pull()` the runtime auto-triggers to pre-fill the queue (up to its
    // default high-water mark of 1) can still be in flight when a caller
    // cancels the discarded-401 body before ever reading from it. When that
    // happens, `reader.cancel()` resolves the pending `reader.read()` with
    // `{ done: true }` (or, depending on the underlying source, rejects it) —
    // but the stream's controller has by then already been torn down by the
    // cancellation itself, so `pull()`'s own `controller.close()` throws
    // "Invalid state: Controller is already closed". Left unguarded, that
    // caught exception looked exactly like a genuine body-read failure and
    // fired a spurious warn line instead of (and — via the `emitted` guard —
    // INSTEAD OF, not in addition to) the correct cancel-triggered debug
    // line, silently losing the discarded-attempt's log line. `cancelled` is
    // set synchronously as the first statement in `cancel()`, before any
    // `await` — since JS is single-threaded, any `pull()` continuation that
    // resumes afterward is guaranteed to see it, whether pull() resolves or
    // rejects, letting it recognise "this is fallout from a cancel that
    // already handled logging" and step aside instead of misreporting it.
    let cancelled = false;

    const proxied = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (done) {
            controller.close();
            emitDebug();
            return;
          }
          bytes += value.byteLength;
          controller.enqueue(value);
        } catch (error) {
          if (cancelled) return;
          // Let the stream error itself the normal way (a rejecting `pull()` is
          // spec'd to error the stream with that reason) — no need to also call
          // `controller.error()` ourselves.
          emitWarn(error);
          throw error;
        }
      },
      async cancel(reason) {
        // The four 401-discard call sites cancel a response whose body they never
        // read. Propagate to the real source so the underlying connection is
        // actually released, then emit — this is the ONLY place that attempt's
        // line would ever fire.
        cancelled = true;
        await reader.cancel(reason).catch(() => {});
        emitDebug();
      },
    });

    return new Response(proxied, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  /**
   * Low-level authenticated fetch with auto-relogin on 401.
   * Used by getRaw() and postMultipart() to avoid duplicating auth/retry logic.
   * Does NOT parse the response — callers handle that themselves.
   */
  private async requestRaw(
    method: string,
    url: string,
    body?: FormData | Buffer | string,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const cookie = await this.session.getCookie();
    const headers: Record<string, string> = { 'Cookie': cookie, ...extraHeaders };

    let response = await this.loggedFetch(method, url, { method, headers, body });

    if (response.status === 401) {
      this.session.invalidate();
      // See postSSE() above: cancel this attempt's unread body so its #215
      // debug line still fires.
      await response.body?.cancel();
      const retryCookie = await this.session.getCookie();
      headers['Cookie'] = retryCookie;
      response = await this.loggedFetch(method, url, { method, headers, body });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      // Fix round 3, Item B: redact any URL query string BEFORE this message reaches
      // ANY of its consumers — log().error (docker logs), errorResponse (the calling
      // MCP client), and recordError/get_runtime_stats (see src/utils/redact.ts's own
      // doc comment for the full rationale — a query param can carry a secret, e.g.
      // trigger_git_webhook's `?secret=<value>`).
      throw new Error(
        redactQueryStrings(
          `Dockhand API error: ${method} ${url} returned ${response.status}: ${errorBody || response.statusText}`
        )
      );
    }

    return response;
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const cookie = await this.session.getCookie();

    const headers: Record<string, string> = {
      'Cookie': cookie,
      'Accept': 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response = await this.loggedFetch(method, url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Auto-relogin on 401
    if (response.status === 401) {
      this.session.invalidate();
      // See postSSE() above: cancel this attempt's unread body so its #215
      // debug line still fires.
      await response.body?.cancel();
      const retryCookie = await this.session.getCookie();
      headers['Cookie'] = retryCookie;
      response = await this.loggedFetch(method, url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      // Fix round 3, Item B: redact any URL query string BEFORE this message reaches
      // ANY of its consumers — log().error (docker logs), errorResponse (the calling
      // MCP client), and recordError/get_runtime_stats (see src/utils/redact.ts's own
      // doc comment for the full rationale — a query param can carry a secret, e.g.
      // trigger_git_webhook's `?secret=<value>`).
      throw new Error(
        redactQueryStrings(
          `Dockhand API error: ${method} ${url} returned ${response.status}: ${errorBody || response.statusText}`
        )
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    // Return text for non-JSON responses
    const text = await response.text();
    return text as unknown as T;
  }

  private async parseSSEResponse(response: Response): Promise<SSEResult> {
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorBody || response.statusText}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';

    // If the response is JSON (not SSE), handle it directly
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return {
        success: true,
        output: JSON.stringify(data),
        jobId: (data as Record<string, unknown>).jobId as string | undefined,
      };
    }

    // Parse SSE stream
    const text = await response.text();
    const lines = text.split('\n');
    const results: SSEResult[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        try {
          const data = JSON.parse(trimmed.slice(6)) as SSEResult;
          results.push(data);
        } catch {
          // Non-JSON data line, collect as output
          results.push({ success: true, output: trimmed.slice(6) });
        }
      }
    }

    if (results.length === 0) {
      // Fallback: return raw text
      return { success: true, output: text };
    }

    // Return the last result event (usually the final status)
    const lastResult = results[results.length - 1];

    // Combine all output
    const combinedOutput = results
      .map((r) => r.output || r.error || '')
      .filter(Boolean)
      .join('\n');

    return {
      success: lastResult.success,
      output: combinedOutput || lastResult.output,
      error: lastResult.error,
      jobId: lastResult.jobId,
    };
  }
}
