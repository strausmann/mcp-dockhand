/**
 * HTTP Client for the Dockhand REST API.
 * Handles cookie-based auth, auto-relogin, SSE parsing, and env parameter injection.
 */

import { SessionManager } from '../auth/session.js';
import type { DockhandConfig, SSEResult } from '../types/dockhand.js';
import { normalizeBaseUrl } from '../utils/url.js';
import { redactQueryStrings } from '../utils/redact.js';
import { log, currentLogContext } from '../utils/log-context.js';

/** Timeout for SSE streaming responses (5 minutes). */
const SSE_TIMEOUT_MS = 300_000;

/**
 * Fallback for calls made outside a tool context (login, self-check): the first two
 * path segments. Coarse on purpose — it is enough to tell /api/auth from /api/stacks
 * and short enough that it cannot contain an identifier.
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
   * It logs the endpoint TEMPLATE from the call context, never `url`. That is not
   * politeness: `url` carries stack names, container ids and — for
   * trigger_git_webhook — a secret in the query string. There is deliberately no code
   * path here that can write a value, rather than a filter that has to keep up with
   * every parameter a future tool introduces.
   */
  private async loggedFetch(method: string, url: string, init: RequestInit): Promise<Response> {
    const started = Date.now();
    const parsed = new URL(url);
    const route = currentLogContext().route ?? coarseRoute(parsed.pathname);
    const query = [...parsed.searchParams.keys()];

    try {
      const response = await fetch(url, init);
      log().debug(
        {
          component: 'client',
          method,
          route,
          ...(query.length ? { query } : {}),
          status: response.status,
          ms: Date.now() - started,
        },
        'dockhand request',
      );
      return response;
    } catch (error) {
      log().warn(
        {
          component: 'client',
          method,
          route,
          ms: Date.now() - started,
          err: { type: 'NetworkError', message: error instanceof Error ? error.message : 'unknown' },
        },
        'dockhand request failed',
      );
      throw error;
    }
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
