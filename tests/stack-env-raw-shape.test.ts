/**
 * Regression guard for #196 — the raw .env response is JSON, not a string.
 *
 * `GET /api/stacks/{name}/env/raw` answers with `json({ content })` on every
 * return path of Dockhand's handler (`src/routes/api/stacks/[name]/env/raw/
 * +server.ts`), and our HTTP client parses `application/json` into an object.
 * The call sites used to narrow that with `typeof raw === 'string' ? raw : ''`,
 * so the merge base was ALWAYS empty:
 *
 *   - update_stack_env (merge) rebuilt the .env from the payload alone and
 *     deleted every variable the caller had not sent — real data loss, 13
 *     variables reduced to 1 on a production stack, reported as success,
 *   - remove_stack_env_vars never saw .env keys and reported them not_found,
 *   - check_stack_env_collisions could never report a collision.
 *
 * Every test below fails against the pre-fix implementation — that is the point
 * of the file. The counter-check was run explicitly: with the old narrowing
 * restored, "preserves variables ... " fails on the truncated PUT body rather
 * than passing for the wrong reason.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerStackTools } from '../src/tools/stacks.js';
import { extractDotEnvContent } from '../src/utils/env-helpers.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface MockClient {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function setup(toolName: string): { handler: ToolHandler; client: MockClient } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _description: string, _schema: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  };
  const client: MockClient = {
    get: vi.fn(),
    put: vi.fn().mockResolvedValue({ ok: true }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerStackTools(server as any, client as any);
  const handler = handlers.get(toolName);
  if (!handler) throw new Error(`${toolName} handler was not registered`);
  return { handler, client };
}

/** Mocks the two GETs exactly as Dockhand answers them. */
function wireRealShape(client: MockClient, structured: unknown, envFileContent: string) {
  client.get.mockImplementation((path: string) =>
    path.endsWith('/env/raw')
      ? Promise.resolve({ content: envFileContent })
      : Promise.resolve(structured));
}

function rawPut(client: MockClient) {
  return client.put.mock.calls.find((c) => String(c[0]).endsWith('/env/raw'));
}

function jsonOut(res: unknown): Record<string, unknown> {
  const text = (res as { content: { text: string }[] }).content[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

describe('extractDotEnvContent', () => {
  it('unwraps the real Dockhand shape', () => {
    expect(extractDotEnvContent({ content: 'A=1\nB=2\n' })).toBe('A=1\nB=2\n');
  });

  it('treats "no env file" as a legitimately empty base', () => {
    expect(extractDotEnvContent({ content: '', noEnvFile: true })).toBe('');
  });

  it('still accepts a bare string (plain-text response)', () => {
    expect(extractDotEnvContent('A=1\n')).toBe('A=1\n');
  });

  it('throws on an error body instead of returning an empty base', () => {
    expect(() => extractDotEnvContent({ error: 'Failed to get environment file' }))
      .toThrow(/Failed to get environment file/);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object without content', { unexpected: true }],
    ['a non-string content', { content: 123 }],
  ])('throws on %s rather than silently yielding an empty base', (_label, value) => {
    expect(() => extractDotEnvContent(value)).toThrow(/Refusing to continue/);
  });
});

describe('update_stack_env — #196 data-loss regression', () => {
  it('preserves variables that are only in the .env file when adding one non-secret', async () => {
    const { handler, client } = setup('update_stack_env');
    // Mirrors the production incident: a populated .env, an empty DB store.
    // The real file held POSTGRES_PASSWORD / PAPERLESS_SECRET_KEY / TZ and ten
    // more; the fixture uses neutral key names so secret scanners do not flag
    // test data as a credential. What matters here is only that these keys are
    // present in .env, absent from the payload, and must survive the write.
    const existing = 'KEEP_ONE=value-one\nKEEP_TWO=value-two\nTZ=Europe/Berlin\n';
    wireRealShape(client, { variables: [] }, existing);

    const res = await handler({
      environmentId: 8,
      name: 'paperless',
      variables: [{ key: 'PAPERLESS_USERNAME', value: 'Strausmann', isSecret: false }],
    });

    const written = (rawPut(client)?.[1] as { content: string }).content;
    expect(written).toContain('KEEP_ONE=value-one');
    expect(written).toContain('KEEP_TWO=value-two');
    expect(written).toContain('TZ=Europe/Berlin');
    expect(written).toContain('PAPERLESS_USERNAME=Strausmann');

    // The summary counts the untouched keys instead of claiming an empty
    // baseline — pre-fix this was `preserved: 0`, which is exactly what made
    // the incident look like a successful merge in the tool response.
    expect(jsonOut(res).summary).toEqual(
      expect.objectContaining({ added: 1, preserved: 3, removed: 0 }),
    );
  });

  it('aborts the write when the raw GET returns an unexpected shape', async () => {
    const { handler, client } = setup('update_stack_env');
    client.get.mockImplementation((path: string) =>
      path.endsWith('/env/raw')
        ? Promise.resolve({ unexpected: 'shape' })
        : Promise.resolve({ variables: [] }));

    const res = await handler({
      environmentId: 8,
      name: 'paperless',
      variables: [{ key: 'PLAIN', value: 'x', isSecret: false }],
    });

    // No truncated file may be written — better to fail loudly than to succeed wrongly.
    expect(rawPut(client)).toBeUndefined();
    expect(JSON.stringify(jsonOut(res))).toMatch(/Refusing to continue/);
  });
});

describe('remove_stack_env_vars — #196: .env keys are visible again', () => {
  it('removes a key that exists only in the .env file', async () => {
    const { handler, client } = setup('remove_stack_env_vars');
    wireRealShape(client, { variables: [] }, 'KEEP=1\nDROP=2\n');

    const res = await handler({ environmentId: 8, name: 'paperless', keys: ['DROP'] });

    const written = (rawPut(client)?.[1] as { content: string }).content;
    expect(written).toContain('KEEP=1');
    expect(written).not.toContain('DROP=2');
    expect(jsonOut(res)).toEqual(expect.objectContaining({ removed: ['DROP'] }));
  });
});

describe('check_stack_env_collisions — #196: the check can actually fire', () => {
  it('reports a key present in both the DB secrets and the .env file', async () => {
    const { handler, client } = setup('check_stack_env_collisions');
    wireRealShape(client, { variables: [{ key: 'DUPE', value: '***', isSecret: true }] }, 'DUPE=from-env\nOTHER=1\n');

    const out = jsonOut(await handler({ environmentId: 8, name: 'paperless' }));

    expect(out.collisions).toEqual(['DUPE']);
  });
});
