/**
 * Session-based cookie authentication for Dockhand.
 * Handles login, cookie storage, auto-relogin on 401, and session timeout.
 */

import type { DockhandConfig, SessionInfo } from '../types/dockhand.js';

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

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Dockhand login failed (HTTP ${response.status}): ${body || response.statusText}`
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
      // Some Dockhand versions return session in body
      const body = await response.text().catch(() => '');
      throw new Error(
        `No session cookie received from Dockhand login. Response: ${body.slice(0, 200)}`
      );
    }

    this.session = {
      cookie: sessionCookie,
      expiresAt: Date.now() + SESSION_TIMEOUT_MS,
    };

    console.error(`[session] Logged in to Dockhand as ${this.config.username}`);
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
    console.error('[session] Session invalidated, will re-login on next request');
  }

  /**
   * Check if we have an active session.
   */
  isAuthenticated(): boolean {
    return this.session !== null && Date.now() < this.session.expiresAt;
  }
}
