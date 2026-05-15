/**
 * Authentication for Dockhand.
 *
 * Two modes:
 *   1. **API token** — when `config.apiToken` is set (env `DOCKHAND_API_TOKEN`),
 *      requests carry `Authorization: Bearer <token>`. No session login, no
 *      relogin, no cookie state. Compatible with MFA-protected accounts.
 *   2. **Session cookie** — fallback when only username + password are set.
 *      Logs in to `/api/auth/login` and caches the session cookie with
 *      auto-relogin on expiry.
 */

import type { DockhandConfig, SessionInfo } from '../types/dockhand.js';

const SESSION_TIMEOUT_MS = 23 * 60 * 60 * 1000; // 23h (conservative, actual is 24h)

export class SessionManager {
  private config: DockhandConfig;
  private session: SessionInfo | null = null;
  private loginPromise: Promise<void> | null = null;

  constructor(config: DockhandConfig) {
    this.config = config;
    if (!config.apiToken && (!config.username || !config.password)) {
      throw new Error(
        'Dockhand auth requires either DOCKHAND_API_TOKEN or both DOCKHAND_USERNAME + DOCKHAND_PASSWORD',
      );
    }
  }

  private isTokenMode(): boolean {
    return typeof this.config.apiToken === 'string' && this.config.apiToken.length > 0;
  }

  /**
   * Login to Dockhand and store the session cookie. No-op in token mode.
   */
  async login(): Promise<void> {
    if (this.isTokenMode()) return;

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
    const url = `${this.config.url}/api/auth/login`;

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
      throw new Error(
        `Dockhand login failed (HTTP ${response.status}): ${responseBody || response.statusText}`
      );
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

    console.error(`[session] Logged in to Dockhand as ${this.config.username}`);
  }

  /**
   * Get the auth headers to attach to a request. In token mode returns
   * `{ Authorization: 'Bearer …' }`. In session mode returns
   * `{ Cookie: '…' }`, logging in first if necessary.
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    if (this.isTokenMode()) {
      return { Authorization: `Bearer ${this.config.apiToken}` };
    }
    if (!this.session || Date.now() >= this.session.expiresAt) {
      await this.login();
    }
    return { Cookie: this.session!.cookie };
  }

  /**
   * Get the raw session cookie (session-mode only).
   * @deprecated Use `getAuthHeaders()` instead — survives both auth modes.
   */
  async getCookie(): Promise<string> {
    if (this.isTokenMode()) {
      throw new Error(
        'getCookie() is invalid in API-token mode — use getAuthHeaders() instead',
      );
    }
    if (!this.session || Date.now() >= this.session.expiresAt) {
      await this.login();
    }
    return this.session!.cookie;
  }

  /**
   * Invalidate current session (triggers re-login on next request).
   * No-op in token mode.
   */
  invalidate(): void {
    if (this.isTokenMode()) return;
    this.session = null;
    console.error('[session] Session invalidated, will re-login on next request');
  }

  /**
   * Check if we have an active session.
   */
  isAuthenticated(): boolean {
    if (this.isTokenMode()) return true;
    return this.session !== null && Date.now() < this.session.expiresAt;
  }
}
