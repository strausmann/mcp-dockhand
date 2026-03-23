/**
 * HTTP Client for the Dockhand REST API.
 * Handles cookie-based auth, auto-relogin, SSE parsing, and env parameter injection.
 */

import { SessionManager } from '../auth/session.js';
import type { DockhandConfig, SSEResult } from '../types/dockhand.js';

/** Timeout for SSE streaming responses (5 minutes). */
const SSE_TIMEOUT_MS = 300_000;

export class DockhandClient {
  private session: SessionManager;
  private baseUrl: string;

  constructor(config: DockhandConfig) {
    this.baseUrl = config.url.replace(/\/+$/, '');
    this.session = new SessionManager(config);
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
   */
  async delete<T = unknown>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>('DELETE', url);
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

    const response = await fetch(url, {
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
      const retryResponse = await fetch(url, {
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

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(SSE_TIMEOUT_MS),
    });

    if (response.status === 401) {
      this.session.invalidate();
      const retryCookie = await this.session.getCookie();
      headers['Cookie'] = retryCookie;
      const retryResponse = await fetch(url, {
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

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const cookie = await this.session.getCookie();

    const headers: Record<string, string> = {
      'Cookie': cookie,
      'Accept': 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Auto-relogin on 401
    if (response.status === 401) {
      this.session.invalidate();
      const retryCookie = await this.session.getCookie();
      headers['Cookie'] = retryCookie;
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `Dockhand API error: ${method} ${url} returned ${response.status}: ${errorBody || response.statusText}`
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
