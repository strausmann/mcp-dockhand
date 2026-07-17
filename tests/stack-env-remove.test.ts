import { describe, it, expect, vi } from 'vitest';
import { registerStackTools } from '../src/tools/stacks.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
function jsonOut(res: unknown): Record<string, unknown> {
  return JSON.parse((res as { content: { text: string }[] }).content[0].text);
}
function setup() {
  const handlers = new Map<string, ToolHandler>();
  const server = { tool: (n: string, _d: string, _s: unknown, cb: ToolHandler) => handlers.set(n, cb) };
  const client = { get: vi.fn(), put: vi.fn().mockResolvedValue({ success: true }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerStackTools(server as any, client as any);
  const handler = handlers.get('remove_stack_env_vars');
  if (!handler) throw new Error('remove_stack_env_vars not registered');
  return { handler, client };
}
// get() is called twice: first structured /env, then raw /env/raw.
function wireGet(client: { get: ReturnType<typeof vi.fn> }, structured: unknown, raw: string) {
  client.get.mockImplementation((path: string) =>
    path.endsWith('/env/raw') ? Promise.resolve(raw) : Promise.resolve(structured));
}

describe('remove_stack_env_vars', () => {
  it('removes a secret: rebuilds the DB set without it (remaining secrets masked)', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: [
      { key: 'DB_PASSWORD', value: '***', isSecret: true },
      { key: 'API_KEY', value: '***', isSecret: true },
    ] }, 'TZ=Europe/Berlin\n');
    const out = jsonOut(await handler({ environmentId: 10, name: 'x', keys: ['API_KEY'] }));
    // PUT to /env with only the remaining secret, masked
    const envPut = client.put.mock.calls.find((c) => String(c[0]).endsWith('/env'));
    expect(envPut?.[1]).toEqual({ variables: [{ key: 'DB_PASSWORD', value: '***', isSecret: true }] });
    expect(out.removed).toEqual(['API_KEY']);
  });

  it('removes a non-secret that lives in .env: rewrites .env without it, no /env PUT', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: [{ key: 'TZ', value: 'Europe/Berlin', isSecret: false }] },
      'TZ=Europe/Berlin\nHOST=h\n');
    const out = jsonOut(await handler({ environmentId: 10, name: 'x', keys: ['TZ'] }));
    const rawPut = client.put.mock.calls.find((c) => String(c[0]).endsWith('/env/raw'));
    expect(rawPut?.[1]).toEqual({ content: 'HOST=h\n' });
    expect(client.put.mock.calls.some((c) => String(c[0]).endsWith('/env') && !String(c[0]).endsWith('/env/raw'))).toBe(false);
    expect(out.removed).toEqual(['TZ']);
  });

  it('reports keys present in neither store as not_found', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: [] }, '');
    const out = jsonOut(await handler({ environmentId: 10, name: 'x', keys: ['NOPE'] }));
    expect(out.not_found).toEqual(['NOPE']);
  });

  it('backend PUT error on .env rewrite → partial report (DB-managed targets already removed)', async () => {
    const { handler, client } = setup();
    wireGet(client, { variables: [
      { key: 'SEC', value: '***', isSecret: true },
      { key: 'TZ', value: 'x', isSecret: false },
    ] }, 'TZ=x\n');
    client.put.mockImplementation((path: string) =>
      String(path).endsWith('/env/raw') ? Promise.reject(new Error('500')) : Promise.resolve({ success: true }));
    const out = jsonOut(await handler({ environmentId: 10, name: 'x', keys: ['SEC', 'TZ'] }));
    expect(out.removed).toEqual(['SEC']);
    expect(typeof out.error).toBe('string');
  });

  it('network error on initial GET propagates (nothing mutated)', async () => {
    const { handler, client } = setup();
    client.get.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(handler({ environmentId: 10, name: 'x', keys: ['A'] })).resolves.toBeDefined();
    expect(client.put).not.toHaveBeenCalled();
  });
});
