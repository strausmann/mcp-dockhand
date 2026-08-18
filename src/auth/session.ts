/**
 * Session-based cookie authentication for Dockhand.
 * Handles login, cookie storage, auto-relogin on 401, and session timeout.
 */

import type { DockhandConfig, SessionInfo } from '../types/dockhand.js';
import { describeLoginFailure, normalizeBaseUrl } from '../utils/url.js';
import { log } from '../utils/log-context.js';

const SESSION_TIMEOUT_MS = 23 * 60 * 60 * 1000; // 23h (conservative, actual is 24h)

export class SessionManager {
  private config: DockhandConfig;
  private session: SessionInfo | null = null;
  private loginPromise: Promise<void> | null = null;

  constructor(config: DockhandConfig) {
    this.config = config;
  }

  /**
   * Login to Dockhand and store the session cookie.
   */
  async login(): Promise<void> {
    // Prevent concurrent login attempts
    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = this.performLogin();
    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  private async performLogin(): Promise<void> {
    const url = `${normalizeBaseUrl(this.config.url)}/api/auth/login`;

    const response = await this.loggedLoginFetch(url);

    // Read body once and cache it to avoid double-read errors
    const responseBody = await response.text().catch(() => '');

    if (!response.ok) {
      const detail = describeLoginFailure(response.status, response.headers.get('location'), responseBody, response.statusText);
      // Fail loud: a login failure only ever surfaces to the caller as a
      // structured MCP tool error (src/utils/tool-helper.ts), which is never
      // written to stderr/docker logs on its own. Logged here at 'error' —
      // the most restrictive level — so a failed login is always diagnosable
      // from `docker logs` no matter what LOG_LEVEL is set to. See Issue #116.
      //
      // Through log() rather than the bare logger so it carries req/sid/call/tool
      // when a request is what triggered it. This is the line Issue #116 is about:
      // without them an operator sees 'tool failed' with a call id and 'login
      // failed' with nothing to join it to, and has to match the two up by
      // timestamp.
      log().error(
        { component: 'session', user: this.config.username, status: response.status, detail },
        'login failed',
      );
      throw new Error(`Dockhand login failed (HTTP ${response.status}): ${detail}`);
    }

    // Extract session cookie from Set-Cookie header
    const setCookie = response.headers.getSetCookie?.() ?? [];
    let sessionCookie = '';

    for (const cookie of setCookie) {
      // Look for the session cookie
      const match = cookie.match(/^([^=]+=[^;]+)/);
      if (match) {
        if (sessionCookie) {
          sessionCookie += '; ';
        }
        sessionCookie += match[1];
      }
    }

    // Fallback: try raw header
    if (!sessionCookie) {
      const rawCookie = response.headers.get('set-cookie');
      if (rawCookie) {
        const match = rawCookie.match(/^([^=]+=[^;]+)/);
        if (match) {
          sessionCookie = match[1];
        }
      }
    }

    if (!sessionCookie) {
      throw new Error(
        `No session cookie received from Dockhand login. Response: ${responseBody.slice(0, 200)}`
      );
    }

    this.session = {
      cookie: sessionCookie,
      expiresAt: Date.now() + SESSION_TIMEOUT_MS,
    };

    log().info({ component: 'session', user: this.config.username }, 'logged in to Dockhand');
  }

  /**
   * The login is the one request to Dockhand that does not go through
   * DockhandClient.loggedFetch — SessionManager holds no client, it is what the client
   * is built on. So it was the one request with no debug line: at LOG_LEVEL=debug
   * against an unreachable Dockhand an operator saw the tool failure and not a single
   * component:"client" line, for the exact request Issue #116 is about.
   *
   * Same shape as loggedFetch, not the same function: component, method, route, status
   * and duration on success; a warn carrying only the exception's NAME when the call
   * never got that far (that path is the interesting one — an unreachable host throws
   * rather than answering).
   *
   * `route` is a constant. loggedFetch derives it from the call context or truncates a
   * caller-supplied path to two segments; here the path is fixed at the one call site
   * above, and /api/auth is what that truncation would produce. Nothing derived from
   * the URL, the body or the credentials is passed to the logger at all — which is
   * what keeps the debug level's no-values guarantee true with a second call site
   * (tests/no-console.test.ts allowlists this file for exactly that reason).
   */
  private async loggedLoginFetch(url: string): Promise<Response> {
    const started = Date.now();
    const route = '/api/auth';

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.config.username,
          password: this.config.password,
          provider: 'local',
        }),
        redirect: 'manual',
      });
    } catch (error) {
      // `err: { type }` and no message, mirroring the client: an exception name is
      // bounded to the DOM/Node vocabulary (TypeError, TimeoutError, ...), the message
      // is free text from an exception this code did not construct.
      log().warn(
        {
          component: 'client',
          method: 'POST',
          route,
          ms: Date.now() - started,
          err: { type: error instanceof Error ? error.name : 'UnknownError' },
        },
        'dockhand request failed',
      );
      throw error;
    }

    log().debug(
      { component: 'client', method: 'POST', route, status: response.status, ms: Date.now() - started },
      'dockhand request',
    );
    return response;
  }

  /**
   * Get the current session cookie, logging in if needed.
   */
  async getCookie(): Promise<string> {
    if (!this.session || Date.now() >= this.session.expiresAt) {
      await this.login();
    }
    return this.session!.cookie;
  }

  /**
   * Invalidate current session (triggers re-login on next request).
   */
  invalidate(): void {
    this.session = null;
    log().info({ component: 'session' }, 'session invalidated, will re-login on next request');
  }

  /**
   * Check if we have an active session.
   */
  isAuthenticated(): boolean {
    return this.session !== null && Date.now() < this.session.expiresAt;
  }
}
