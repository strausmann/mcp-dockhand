import { describe, it, expect, afterEach } from 'vitest';
import { validateConfig } from '../../src/tools/meta.js';

const ENV_KEYS = ['DOCKHAND_URL', 'DOCKHAND_USERNAME', 'DOCKHAND_PASSWORD'] as const;

describe('validateConfig', () => {
  const originalEnv: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
  }

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('reports all env present and valid credentials when the login probe completes auth (200 + session cookie)', async () => {
    process.env.DOCKHAND_URL = 'https://dock.example.test';
    process.env.DOCKHAND_USERNAME = 'admin';
    process.env.DOCKHAND_PASSWORD = 'super-secret-password';

    const result = await validateConfig({
      attemptLogin: async () => ({ statusCode: 200, completedAuth: true }),
    });

    expect(result).toEqual({
      requiredEnvPresent: {
        DOCKHAND_URL: true,
        DOCKHAND_USERNAME: true,
        DOCKHAND_PASSWORD: true,
      },
      credentialsValid: true,
      statusCode: 200,
    });
  });

  it('does not attempt a login when a required env var (DOCKHAND_PASSWORD) is missing', async () => {
    process.env.DOCKHAND_URL = 'https://dock.example.test';
    process.env.DOCKHAND_USERNAME = 'admin';
    delete process.env.DOCKHAND_PASSWORD;

    let loginCalled = false;
    const result = await validateConfig({
      attemptLogin: async () => {
        loginCalled = true;
        return { statusCode: 200, completedAuth: true };
      },
    });

    expect(result.requiredEnvPresent).toEqual({
      DOCKHAND_URL: true,
      DOCKHAND_USERNAME: true,
      DOCKHAND_PASSWORD: false,
    });
    expect(loginCalled).toBe(false);
    expect(result.credentialsValid).toBe(false);
    expect(result.statusCode).toBeNull();
  });

  it('reports invalid credentials when the login probe returns 401', async () => {
    process.env.DOCKHAND_URL = 'https://dock.example.test';
    process.env.DOCKHAND_USERNAME = 'admin';
    process.env.DOCKHAND_PASSWORD = 'wrong-password';

    const result = await validateConfig({
      attemptLogin: async () => ({ statusCode: 401, completedAuth: false }),
    });

    expect(result.credentialsValid).toBe(false);
    expect(result.statusCode).toBe(401);
  });

  it('reports credentialsValid:false while still surfacing statusCode:200 for a 200-but-MFA-pending login (Fix round 2, Finding 3)', async () => {
    // The core of the fix: a 200 response is not on its own proof of a completed,
    // non-interactively-usable login — an MFA account returns 200 + requiresMfa:true
    // with no session cookie. attemptRawLogin() (the real wiring) turns that into
    // completedAuth:false while still reporting the true statusCode.
    process.env.DOCKHAND_URL = 'https://dock.example.test';
    process.env.DOCKHAND_USERNAME = 'mfa-user';
    process.env.DOCKHAND_PASSWORD = 'correct-password-but-mfa-required';

    const result = await validateConfig({
      attemptLogin: async () => ({ statusCode: 200, completedAuth: false }),
    });

    expect(result.credentialsValid).toBe(false);
    expect(result.statusCode).toBe(200);
  });

  it('degrades to credentialsValid:false, statusCode:null when the login probe throws (network error)', async () => {
    process.env.DOCKHAND_URL = 'https://dock.example.test';
    process.env.DOCKHAND_USERNAME = 'admin';
    process.env.DOCKHAND_PASSWORD = 'super-secret-password';

    const result = await validateConfig({
      attemptLogin: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    expect(result.credentialsValid).toBe(false);
    expect(result.statusCode).toBeNull();
  });

  it('never includes secret env values (username/password) in the result — secret-safe by construction', async () => {
    process.env.DOCKHAND_URL = 'https://dock.example.test';
    process.env.DOCKHAND_USERNAME = 'sentinel-username-value';
    process.env.DOCKHAND_PASSWORD = 'sentinel-password-value';

    const result = await validateConfig({
      attemptLogin: async () => ({ statusCode: 200, completedAuth: true }),
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sentinel-username-value');
    expect(serialized).not.toContain('sentinel-password-value');
  });
});
