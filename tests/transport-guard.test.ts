import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import {
  createBearerAuthGuard,
  createHostOriginGuard,
  getTransportSecurityConfig,
  isHostOriginEnforcementActive,
} from '../src/auth/transport-guard.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

// --- getTransportSecurityConfig -------------------------------------------

describe('getTransportSecurityConfig', () => {
  it('defaults allowedHosts to an empty (disabled) allowlist when MCP_ALLOWED_HOSTS is unset -- opt-in, compatible default', () => {
    const config = getTransportSecurityConfig(8080, {});
    expect(config.allowedHosts).toEqual([]);
  });

  it('defaults MCP_ALLOWED_ORIGINS to an empty (disabled) allowlist when unset', () => {
    const config = getTransportSecurityConfig(8080, {});
    expect(config.allowedOrigins).toEqual([]);
  });

  it('does not derive a default allowlist from the port when MCP_ALLOWED_HOSTS is unset, regardless of port value', () => {
    const config = getTransportSecurityConfig(48213, {});
    expect(config.allowedHosts).toEqual([]);
  });

  it('defaults authToken to undefined when MCP_AUTH_TOKEN is unset', () => {
    const config = getTransportSecurityConfig(8080, {});
    expect(config.authToken).toBeUndefined();
  });

  it('parses a comma-separated MCP_ALLOWED_HOSTS, trimming whitespace', () => {
    const config = getTransportSecurityConfig(8080, {
      MCP_ALLOWED_HOSTS: ' dock.strausmann.cloud , 127.0.0.1:8080 ',
    });
    expect(config.allowedHosts).toEqual(['dock.strausmann.cloud', '127.0.0.1:8080']);
  });

  it('an explicit empty MCP_ALLOWED_HOSTS disables the Host allowlist (empty array, not the default)', () => {
    const config = getTransportSecurityConfig(8080, { MCP_ALLOWED_HOSTS: '' });
    expect(config.allowedHosts).toEqual([]);
  });

  it('parses a comma-separated MCP_ALLOWED_ORIGINS', () => {
    const config = getTransportSecurityConfig(8080, {
      MCP_ALLOWED_ORIGINS: 'https://a.example, https://b.example',
    });
    expect(config.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('reads MCP_AUTH_TOKEN and trims surrounding whitespace', () => {
    const config = getTransportSecurityConfig(8080, { MCP_AUTH_TOKEN: '  s3cr3t  ' });
    expect(config.authToken).toBe('s3cr3t');
  });

  it('treats a blank/whitespace-only MCP_AUTH_TOKEN as unset', () => {
    const config = getTransportSecurityConfig(8080, { MCP_AUTH_TOKEN: '   ' });
    expect(config.authToken).toBeUndefined();
  });

  it('defaults to process.env when no env argument is passed', () => {
    vi.stubEnv('MCP_ALLOWED_HOSTS', 'stubbed.example:1234');
    const config = getTransportSecurityConfig(1234);
    expect(config.allowedHosts).toEqual(['stubbed.example:1234']);
  });
});

// --- isHostOriginEnforcementActive -----------------------------------------

describe('isHostOriginEnforcementActive', () => {
  it('is false when both allowlists are empty (compatible default)', () => {
    expect(isHostOriginEnforcementActive({ allowedHosts: [], allowedOrigins: [] })).toBe(false);
  });

  it('is true when allowedHosts is non-empty', () => {
    expect(isHostOriginEnforcementActive({ allowedHosts: ['localhost:8080'], allowedOrigins: [] })).toBe(true);
  });

  it('is true when allowedOrigins is non-empty', () => {
    expect(isHostOriginEnforcementActive({ allowedHosts: [], allowedOrigins: ['https://good.example'] })).toBe(true);
  });
});

// --- createHostOriginGuard --------------------------------------------------

function mockReqRes(headers: Record<string, string | undefined>) {
  const req = { headers } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  const next = vi.fn();
  return { req, res, status, json, next };
}

describe('createHostOriginGuard', () => {
  it('allows a request whose Host header is in the allowlist', () => {
    const guard = createHostOriginGuard(['127.0.0.1:8080'], []);
    const { req, res, next, status } = mockReqRes({ host: '127.0.0.1:8080' });
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('matches the Host allowlist case-insensitively', () => {
    const guard = createHostOriginGuard(['Localhost:8080'], []);
    const { req, res, next } = mockReqRes({ host: 'LOCALHOST:8080' });
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a request whose Host header is not in the allowlist (403)', () => {
    const guard = createHostOriginGuard(['127.0.0.1:8080', 'localhost:8080'], []);
    const { req, res, next, status, json } = mockReqRes({ host: 'evil.attacker.example' });
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Invalid Host header') }));
  });

  it('rejects a request with no Host header at all when an allowlist is configured', () => {
    const guard = createHostOriginGuard(['127.0.0.1:8080'], []);
    const { req, res, next, status } = mockReqRes({});
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it('skips the Host check entirely when allowedHosts is empty', () => {
    const guard = createHostOriginGuard([], []);
    const { req, res, next, status } = mockReqRes({ host: 'anything.example' });
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('allows a request with no Origin header even when an Origin allowlist is configured', () => {
    const guard = createHostOriginGuard([], ['https://good.example']);
    const { req, res, next, status } = mockReqRes({ host: 'irrelevant' });
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('allows a request whose Origin header is in the allowlist', () => {
    const guard = createHostOriginGuard([], ['https://good.example']);
    const { req, res, next } = mockReqRes({ host: 'irrelevant', origin: 'https://good.example' });
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a request whose Origin header is present but not allowlisted (403)', () => {
    const guard = createHostOriginGuard([], ['https://good.example']);
    const { req, res, next, status, json } = mockReqRes({ host: 'irrelevant', origin: 'https://evil.example' });
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Invalid Origin header') }));
  });

  it('checks Host before Origin: a disallowed Host is rejected even with an allowed Origin', () => {
    const guard = createHostOriginGuard(['localhost:8080'], ['https://good.example']);
    const { req, res, next, status, json } = mockReqRes({ host: 'evil.example', origin: 'https://good.example' });
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Invalid Host header') }));
  });
});

// --- createBearerAuthGuard ---------------------------------------------------

describe('createBearerAuthGuard', () => {
  it('is a no-op (always calls next) when no token is configured', () => {
    const guard = createBearerAuthGuard(undefined);
    const { req, res, next, status } = mockReqRes({});
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header when a token is configured (401)', () => {
    const guard = createBearerAuthGuard('s3cr3t');
    const { req, res, next, status, json } = mockReqRes({});
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'unauthorized' });
  });

  it('rejects a request with the wrong bearer token (401)', () => {
    const guard = createBearerAuthGuard('s3cr3t');
    const { req, res, next, status } = mockReqRes({ authorization: 'Bearer wrong-token' });
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects a request with a token of different length than expected (401, no throw)', () => {
    const guard = createBearerAuthGuard('s3cr3t');
    const { req, res, next, status } = mockReqRes({ authorization: 'Bearer short' });
    expect(() => guard(req, res, next)).not.toThrow();
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects a request that omits the "Bearer " prefix (401)', () => {
    const guard = createBearerAuthGuard('s3cr3t');
    const { req, res, next, status } = mockReqRes({ authorization: 's3cr3t' });
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('allows a request with the correct bearer token', () => {
    const guard = createBearerAuthGuard('s3cr3t');
    const { req, res, next, status } = mockReqRes({ authorization: 'Bearer s3cr3t' });
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });
});
