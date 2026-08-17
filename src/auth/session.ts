/**
 * Session-based cookie authentication for Dockhand.
 * Handles login, cookie storage, auto-relogin on 401, and session timeout.
 */

import type { DockhandConfig, SessionInfo } from '../types/dockhand.js';
import { describeLoginFailure, normalizeBaseUrl } from '../utils/url.js';
import { logger } from '../utils/logger.js';

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

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
        provider: 'local',
      }),
      redirect: 'manual',
    });

    // Read body once and cache it to avoid double-read errors
    const responseBody = await response.text().catch(() => '');

    if (!response.ok) {
      const detail = describeLoginFailure(response.status, response.headers.get('location'), responseBody, response.statusText);
      // Fail loud: a login failure only ever surfaces to the caller as a
      // structured MCP tool error (src/utils/tool-helper.ts), which is never
      // written to stderr/docker logs on its own. Logged here at 'error' —
      // the most restrictive level — so a failed login is always diagnosable
      // from `docker logs` no matter what LOG_LEVEL is set to. See Issue #116.
      logger.error(
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

    logger.info({ component: 'session', user: this.config.username }, 'logged in to Dockhand');
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
    logger.info({ component: 'session' }, 'session invalidated, will re-login on next request');
  }

  /**
   * Check if we have an active session.
   */
  isAuthenticated(): boolean {
    return this.session !== null && Date.now() < this.session.expiresAt;
  }
}
