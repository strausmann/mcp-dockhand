/**
 * Tools and contract params added for the Dockhand 1.0.55–1.0.59 endpoints (#340).
 *
 * Request shapes were read off the real Finsys/dockhand v1.0.59 handlers (0b194bd), not
 * the changelog or the spec alone:
 *   src/routes/api/exposure-status/+server.ts
 *     GET -> {warn, dismissed}. (POST dismisses the warning; omitted, see the registry.)
 *   src/routes/api/preferences/language/+server.ts
 *     GET -> {language}. PUT body {language: <locale> | null}; anything else is 400.
 *   src/routes/api/scheduled-actions/[containerName]/+server.ts
 *     GET/PUT ?env=<id> (required). PUT body {startAt, stopAt, enabled}: an empty or
 *     missing time is read as null, both null deletes the schedule, enabled only applies
 *     when a schedule is written.
 *   src/routes/api/settings/pinned-digest-report/+server.ts
 *     GET -> {enabled}. POST body {enabled}; anything but `true` stores false.
 *   src/routes/api/git/stacks/[id]/detach/+server.ts
 *     POST, no body. Deletes the git stack row, its sync schedule and its checkout.
 *   src/routes/api/stacks/[name]/attach/+server.ts
 *     POST ?env=<id>, body {repositoryId | url+repoName+branch+credentialId, composePath,
 *     envFilePath, autoUpdate*, webhook*, contextDir, build/pull flags, secretProviderId,
 *     envVars, deployNow}. Returns the new git stack row.
 *   New optional fields: stacks POST / compose PUT / deploy POST (pullBase,
 *   respectPullPolicy), git/stacks POST (takeOverExternalStack), secret-providers probe
 *   (stack, env), stacks env/validate (compose, variables, envValues), vulnerabilities
 *   count (groupBy).
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { registerSystemTools } from '../../src/tools/system.js';
import { registerPreferenceTools } from '../../src/tools/preferences.js';
import { registerScheduleTools } from '../../src/tools/schedules.js';
import { registerSettingsTools } from '../../src/tools/settings.js';
import { registerGitStackTools } from '../../src/tools/git-stacks.js';
import { registerStackTools } from '../../src/tools/stacks.js';
import { registerSecretProviderTools } from '../../src/tools/secret-providers.js';
import { registerVulnerabilityTools } from '../../src/tools/vulnerabilities.js';
import { describeTool } from '../../src/openapi/describe-tool.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type ZodShape = Record<string, z.ZodTypeAny>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  postSSE: ReturnType<typeof vi.fn>;
  putSSE: ReturnType<typeof vi.fn>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Register = (server: any, client: any) => void;

function setup(register: Register) {
  const handlers = new Map<string, ToolHandler>();
  const schemas = new Map<string, ZodShape>();
  const server = {
    tool: (name: string, _d: string, s: ZodShape, _a: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
      schemas.set(name, s);
    },
  };
  const client: MockClient = {
    get: vi.fn().mockResolvedValue({ ok: true }),
    post: vi.fn().mockResolvedValue({ ok: true }),
    put: vi.fn().mockResolvedValue({ ok: true }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
    postSSE: vi.fn().mockResolvedValue({ ok: true }),
    putSSE: vi.fn().mockResolvedValue({ ok: true }),
  };
  register(server, client);
  return { handlers, schemas, client };
}

function handlerOf(ctx: ReturnType<typeof setup>, name: string): ToolHandler {
  const handler = ctx.handlers.get(name);
  if (!handler) throw new Error(`${name} was not registered`);
  return handler;
}

async function call(register: Register, name: string, args: Record<string, unknown>) {
  const ctx = setup(register);
  const result = await handlerOf(ctx, name)(args);
  return { ...ctx, result };
}

function out(res: unknown): unknown {
  return JSON.parse((res as { content: { text: string }[] }).content[0]!.text);
}

function isError(res: unknown): boolean {
  return (res as { isError?: boolean }).isError === true;
}

function parse(ctx: ReturnType<typeof setup>, name: string, args: Record<string, unknown>) {
  return z.object(ctx.schemas.get(name)!).safeParse(args);
}

/** Backend 4xx/5xx and network failures both reach the caller as a tool error, not a crash. */
async function expectFailureSurfaces(
  register: Register,
  name: string,
  method: keyof MockClient,
  args: Record<string, unknown>,
) {
  for (const error of [new Error('400: rejected by Dockhand'), new Error('500: Internal Server Error'), new TypeError('fetch failed: ECONNREFUSED')]) {
    const ctx = setup(register);
    ctx.client[method].mockRejectedValueOnce(error);
    const result = await handlerOf(ctx, name)(args);
    expect(ctx.client[method]).toHaveBeenCalledTimes(1);
    expect(isError(result)).toBe(true);
    expect((out(result) as { error?: string }).error).toContain(error.message.split(':')[0]);
  }
}

describe('get_exposure_status (#340)', () => {
  it('reads GET /api/exposure-status and returns {warn, dismissed}', async () => {
    const ctx = setup(registerSystemTools);
    ctx.client.get.mockResolvedValueOnce({ warn: false, dismissed: false });
    const result = await handlerOf(ctx, 'get_exposure_status')({});
    expect(ctx.client.get).toHaveBeenCalledWith('/api/exposure-status');
    expect(out(result)).toEqual({ warn: false, dismissed: false });
  });

  it('surfaces backend and network errors', async () => {
    await expectFailureSurfaces(registerSystemTools, 'get_exposure_status', 'get', {});
  });

  it('does not register a tool that dismisses the warning', () => {
    const ctx = setup(registerSystemTools);
    expect([...ctx.handlers.keys()].filter((n) => n.includes('exposure'))).toEqual(['get_exposure_status']);
  });
});

describe('get_language_preference / set_language_preference (#340)', () => {
  it('reads GET /api/preferences/language', async () => {
    const { client } = await call(registerPreferenceTools, 'get_language_preference', {});
    expect(client.get).toHaveBeenCalledWith('/api/preferences/language');
  });

  it('sets a locale with PUT {language}', async () => {
    const { client } = await call(registerPreferenceTools, 'set_language_preference', { language: 'de' });
    expect(client.put).toHaveBeenCalledWith('/api/preferences/language', { language: 'de' });
  });

  it('sends null (not an omitted field) to go back to following the browser', async () => {
    const { client } = await call(registerPreferenceTools, 'set_language_preference', { language: null });
    expect(client.put).toHaveBeenCalledWith('/api/preferences/language', { language: null });
  });

  it('requires language: an omitted value is not a valid request (the handler would 400)', () => {
    const ctx = setup(registerPreferenceTools);
    expect(parse(ctx, 'set_language_preference', {}).success).toBe(false);
    expect(parse(ctx, 'set_language_preference', { language: null }).success).toBe(true);
    expect(parse(ctx, 'set_language_preference', { language: 'fr-CA' }).success).toBe(true);
  });

  it('surfaces backend and network errors on read and write', async () => {
    await expectFailureSurfaces(registerPreferenceTools, 'get_language_preference', 'get', {});
    await expectFailureSurfaces(registerPreferenceTools, 'set_language_preference', 'put', { language: 'xx' });
  });
});

describe('get_container_start_stop_schedule / set_container_start_stop_schedule (#340)', () => {
  it('reads with the env query param and an encoded container name', async () => {
    const { client } = await call(registerScheduleTools, 'get_container_start_stop_schedule', { environmentId: 3, containerName: 'web/1 a' });
    expect(client.get).toHaveBeenCalledWith('/api/scheduled-actions/web%2F1%20a', { env: 3 });
  });

  it('writes both times and enabled with PUT ?env', async () => {
    const { client } = await call(registerScheduleTools, 'set_container_start_stop_schedule', {
      environmentId: 3, containerName: 'web', startAt: '07:00', stopAt: '0 23 * * 1-5', enabled: false,
    });
    expect(client.put).toHaveBeenCalledWith('/api/scheduled-actions/web', { startAt: '07:00', stopAt: '0 23 * * 1-5', enabled: false }, { env: 3 });
  });

  it('sends a null time explicitly and leaves enabled out when omitted (an existing row keeps its state)', async () => {
    const { client } = await call(registerScheduleTools, 'set_container_start_stop_schedule', {
      environmentId: 3, containerName: 'web', startAt: '07:00', stopAt: null,
    });
    expect(client.put).toHaveBeenCalledWith('/api/scheduled-actions/web', { startAt: '07:00', stopAt: null }, { env: 3 });
  });

  it('requires environmentId, startAt and stopAt: an omitted time would silently clear it', () => {
    const ctx = setup(registerScheduleTools);
    const name = 'set_container_start_stop_schedule';
    expect(parse(ctx, name, { environmentId: 3, containerName: 'web', startAt: '07:00' }).success).toBe(false);
    expect(parse(ctx, name, { environmentId: 3, containerName: 'web', stopAt: '23:00' }).success).toBe(false);
    expect(parse(ctx, name, { containerName: 'web', startAt: null, stopAt: null }).success).toBe(false);
    expect(parse(ctx, name, { environmentId: 3, containerName: 'web', startAt: null, stopAt: null }).success).toBe(true);
    expect(parse(ctx, 'get_container_start_stop_schedule', { containerName: 'web' }).success).toBe(false);
  });

  it('surfaces backend and network errors on read and write', async () => {
    await expectFailureSurfaces(registerScheduleTools, 'get_container_start_stop_schedule', 'get', { environmentId: 3, containerName: 'web' });
    await expectFailureSurfaces(registerScheduleTools, 'set_container_start_stop_schedule', 'put', { environmentId: 3, containerName: 'web', startAt: '7', stopAt: null });
  });
});

describe('get_pinned_digest_report / set_pinned_digest_report (#340)', () => {
  it('reads GET /api/settings/pinned-digest-report', async () => {
    const { client } = await call(registerSettingsTools, 'get_pinned_digest_report', {});
    expect(client.get).toHaveBeenCalledWith('/api/settings/pinned-digest-report');
  });

  it('writes POST {enabled}', async () => {
    const { client } = await call(registerSettingsTools, 'set_pinned_digest_report', { enabled: true });
    expect(client.post).toHaveBeenCalledWith('/api/settings/pinned-digest-report', { enabled: true });
  });

  it('requires enabled: the handler stores false for anything but true, so an omitted value would switch it off', () => {
    const ctx = setup(registerSettingsTools);
    expect(parse(ctx, 'set_pinned_digest_report', {}).success).toBe(false);
    expect(parse(ctx, 'set_pinned_digest_report', { enabled: 'true' }).success).toBe(false);
  });

  it('surfaces backend and network errors on read and write', async () => {
    await expectFailureSurfaces(registerSettingsTools, 'get_pinned_digest_report', 'get', {});
    await expectFailureSurfaces(registerSettingsTools, 'set_pinned_digest_report', 'post', { enabled: false });
  });
});

describe('detach_git_stack (#340)', () => {
  it('posts to /api/git/stacks/{id}/detach without a body', async () => {
    const { client, result } = await call(registerGitStackTools, 'detach_git_stack', { stackId: 7 });
    expect(client.post).toHaveBeenCalledWith('/api/git/stacks/7/detach');
    expect(out(result)).toEqual({ ok: true });
  });

  it('surfaces backend (409 not deployed) and network errors', async () => {
    await expectFailureSurfaces(registerGitStackTools, 'detach_git_stack', 'post', { stackId: 7 });
  });

  it('says in its description that the git stack record and its checkout are deleted', () => {
    const description = describeTool('detach_git_stack');
    expect(description).toMatch(/deletes the git stack record/i);
    expect(description).toMatch(/checkout/i);
  });
});

describe('attach_stack_to_git (#340)', () => {
  it('posts only the supplied fields to /api/stacks/{name}/attach with ?env', async () => {
    const { client } = await call(registerGitStackTools, 'attach_stack_to_git', {
      environmentId: 2, name: 'my app', repositoryId: 4, composePath: 'deploy/compose.yaml', secretProviderId: null, deployNow: false,
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/stacks/my%20app/attach',
      { repositoryId: 4, composePath: 'deploy/compose.yaml', secretProviderId: null, deployNow: false },
      { env: 2 },
    );
  });

  it('passes the new-repository and webhook fields through', async () => {
    const { client } = await call(registerGitStackTools, 'attach_stack_to_git', {
      environmentId: 2, name: 'app', url: 'https://git.example.invalid/app.git', repoName: 'app', branch: 'main', credentialId: 5,
      webhookEnabled: true, webhookSecret: 'not-a-real-secret', envVars: [{ key: 'A', value: '1', isSecret: false }],
    });
    expect(client.post.mock.calls[0]![1]).toEqual({
      url: 'https://git.example.invalid/app.git', repoName: 'app', branch: 'main', credentialId: 5,
      webhookEnabled: true, webhookSecret: 'not-a-real-secret', envVars: [{ key: 'A', value: '1', isSecret: false }],
    });
  });

  it('never returns a stored webhook secret in the created git stack row', async () => {
    const ctx = setup(registerGitStackTools);
    ctx.client.post.mockResolvedValueOnce({ id: 9, stackName: 'app', webhookSecret: 'not-a-real-secret' });
    const result = await handlerOf(ctx, 'attach_stack_to_git')({ environmentId: 2, name: 'app', repositoryId: 4 });
    const text = (result as { content: { text: string }[] }).content[0]!.text;
    expect(text).not.toContain('not-a-real-secret');
    expect(out(result)).toEqual({ id: 9, stackName: 'app', hasWebhookSecret: true });
  });

  it('requires environmentId and name', () => {
    const ctx = setup(registerGitStackTools);
    expect(parse(ctx, 'attach_stack_to_git', { name: 'app', repositoryId: 4 }).success).toBe(false);
    expect(parse(ctx, 'attach_stack_to_git', { environmentId: 2, repositoryId: 4 }).success).toBe(false);
  });

  it('surfaces backend and network errors', async () => {
    await expectFailureSurfaces(registerGitStackTools, 'attach_stack_to_git', 'post', { environmentId: 2, name: 'app', repositoryId: 4 });
  });
});

describe('create_git_stack takeOverExternalStack (#340)', () => {
  it('sends the explicit field, winning over config', async () => {
    const { client } = await call(registerGitStackTools, 'create_git_stack', {
      config: { stackName: 'app', takeOverExternalStack: false }, takeOverExternalStack: true,
    });
    expect(client.post).toHaveBeenCalledWith('/api/git/stacks', { stackName: 'app', takeOverExternalStack: true });
  });

  it('leaves the body alone when omitted', async () => {
    const { client } = await call(registerGitStackTools, 'create_git_stack', { config: { stackName: 'app' } });
    expect(client.post).toHaveBeenCalledWith('/api/git/stacks', { stackName: 'app' });
  });
});

describe('pullBase / respectPullPolicy on stack deploy paths (#340)', () => {
  it('create_stack forwards both when supplied', async () => {
    const { client } = await call(registerStackTools, 'create_stack', {
      environmentId: 1, name: 's', compose: 'services: {}', pull: true, build: true, pullBase: true, respectPullPolicy: true,
    });
    expect(client.postSSE.mock.calls[0]![1]).toMatchObject({ pull: true, build: true, pullBase: true, respectPullPolicy: true });
  });

  it('create_stack omits both when not supplied', async () => {
    const { client } = await call(registerStackTools, 'create_stack', { environmentId: 1, name: 's', compose: 'services: {}' });
    expect(client.postSSE.mock.calls[0]![1]).not.toHaveProperty('pullBase');
    expect(client.postSSE.mock.calls[0]![1]).not.toHaveProperty('respectPullPolicy');
  });

  it('update_stack_compose forwards both on the restart path', async () => {
    const { client } = await call(registerStackTools, 'update_stack_compose', {
      environmentId: 1, name: 's', content: 'services: {}', restart: true, pullBase: false, respectPullPolicy: true,
    });
    expect(client.putSSE.mock.calls[0]![1]).toMatchObject({ pullBase: false, respectPullPolicy: true });
  });

  it('deploy_stack forwards both and keeps its pull/build/forceRecreate defaults', async () => {
    const { client } = await call(registerStackTools, 'deploy_stack', { environmentId: 1, name: 's', build: true, pullBase: true, respectPullPolicy: true });
    expect(client.postSSE).toHaveBeenCalledWith('/api/stacks/s/deploy', { pull: true, build: true, forceRecreate: false, pullBase: true, respectPullPolicy: true }, { env: 1 });
  });

  it('deploy_stack sends exactly the three defaults when neither is supplied', async () => {
    const { client } = await call(registerStackTools, 'deploy_stack', { environmentId: 1, name: 's' });
    expect(client.postSSE).toHaveBeenCalledWith('/api/stacks/s/deploy', { pull: true, build: false, forceRecreate: false }, { env: 1 });
  });
});

describe('probe_secret_provider stack/env (#340)', () => {
  it('maps environmentId onto the body field env, next to stack', async () => {
    const { client } = await call(registerSecretProviderTools, 'probe_secret_provider', { id: 2, stack: 'app', environmentId: 5 });
    expect(client.post).toHaveBeenCalledWith('/api/secret-providers/2/probe', { stack: 'app', env: 5 });
  });

  it('keeps the old body when neither is supplied', async () => {
    const { client } = await call(registerSecretProviderTools, 'probe_secret_provider', { id: 2, selector: 'prod' });
    expect(client.post).toHaveBeenCalledWith('/api/secret-providers/2/probe', { selector: 'prod' });
  });
});

describe('validate_stack_env compose/variables/envValues (#340)', () => {
  it('sends the supplied fields as a JSON body', async () => {
    const { client } = await call(registerStackTools, 'validate_stack_env', {
      environmentId: 1, name: 's', compose: 'services: {}', variables: ['A'], envValues: { A: '${B}' },
    });
    expect(client.post).toHaveBeenCalledWith('/api/stacks/s/env/validate', { compose: 'services: {}', variables: ['A'], envValues: { A: '${B}' } }, { env: 1 });
  });

  it('sends no body when nothing is supplied, so the saved compose file and DB variables are used', async () => {
    const { client } = await call(registerStackTools, 'validate_stack_env', { environmentId: 1, name: 's' });
    expect(client.post).toHaveBeenCalledWith('/api/stacks/s/env/validate', undefined, { env: 1 });
  });
});

describe('get_vulnerability_count groupBy (#340)', () => {
  it('passes groupBy as a query param', async () => {
    const { client } = await call(registerVulnerabilityTools, 'get_vulnerability_count', { environmentId: 1, groupBy: 'stack' });
    expect(client.get).toHaveBeenCalledWith('/api/vulnerabilities/count', { env: 1, groupBy: 'stack' });
  });

  it('accepts only container, image or stack (the handler 400s on anything else)', () => {
    const ctx = setup(registerVulnerabilityTools);
    expect(parse(ctx, 'get_vulnerability_count', { environmentId: 1, groupBy: 'service' }).success).toBe(false);
    expect(parse(ctx, 'get_vulnerability_count', { environmentId: 1, groupBy: 'image' }).success).toBe(true);
  });

  it('keeps the old query when groupBy is omitted', async () => {
    const { client } = await call(registerVulnerabilityTools, 'get_vulnerability_count', { environmentId: 1 });
    expect(client.get).toHaveBeenCalledWith('/api/vulnerabilities/count', { env: 1 });
  });
});

describe('attach_stack_to_git description (#340, audit run 9)', () => {
  it('says that the repository compose replaces the running one on the next deploy', () => {
    const description = describeTool('attach_stack_to_git');
    expect(description).toMatch(/deployed from the repository/i);
    expect(description).toMatch(/replaces the running compose/i);
  });
});
