/**
 * URL normalization helpers shared by DockhandClient and SessionManager.
 *
 * Both classes build request URLs from the same `DOCKHAND_URL` config value,
 * but historically did so independently: DockhandClient stripped a trailing
 * slash before combining paths via `new URL(path, baseUrl)`, while
 * SessionManager concatenated `${config.url}/api/auth/login` directly. A
 * `DOCKHAND_URL` with a trailing slash (e.g. `https://host/`) therefore
 * produced a double-slash login URL (`https://host//api/auth/login`).
 *
 * Dockhand's `hooks.server.ts` auth gate matches the login route against a
 * public-path allowlist by exact pathname (`/api/auth/login`) or
 * `startsWith('/api/')`; a double-slash pathname (`//api/auth/login`)
 * matches neither, so the request falls through to the "unauthenticated UI
 * route" branch and gets redirected (`307` to `/login?redirect=...`) instead
 * of being processed as a login attempt. See Issue #116.
 */

/** Strip one or more trailing slashes from a base URL. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Build a diagnostic message for a login response that failed.
 *
 * A 3xx status with `redirect: 'manual'` means the server redirected the
 * login request instead of processing it — most commonly caused by a
 * misconfigured base URL (trailing slash, wrong path) or a reverse proxy
 * rewrite, not a rejected credential. Surfacing the Location header (when
 * present) turns an opaque "HTTP 307: Temporary Redirect" into an
 * actionable hint instead of a silent dead end.
 */
export function describeLoginFailure(
  status: number,
  location: string | null,
  bodyText: string,
  statusText: string,
): string {
  if (status >= 300 && status < 400) {
    const target = location ? `"${location}"` : '(no Location header)';
    return (
      `redirected to ${target} instead of authenticating — check DOCKHAND_URL for a ` +
      `trailing slash or a reverse-proxy rewrite in front of Dockhand`
    );
  }
  return bodyText || statusText;
}
