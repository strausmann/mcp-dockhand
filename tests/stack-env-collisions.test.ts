import { describe, it, expect, vi } from 'vitest';
import { registerStackTools } from '../src/tools/stacks.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
function jsonOut(res: unknown): Record<string, unknown> {
  return JSON.parse((res as { content: { text: string }[] }).content[0].text);
}
function setup() {
  const handlers = new Map<string, ToolHandler>();
  const server = { tool: (n: string, _d: string, _s: unknown, cb: ToolHandler) => handlers.set(n, cb) };
  const client = { get: vi.fn(), put: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerStackTools(server as any, client as any);
  const handler = handlers.get('check_stack_env_collisions');
  if (!handler) throw new Error('check_stack_env_collisions not registered');
  return { handler, client };
}

describe('check_stack_env_collisions', () => {
  it('reports keys that are both DB secret and in .env', async () => {
    const { handler, client } = setup();
    client.get.mockImplementation((path: string) =>
      path.endsWith('/env/raw')
        ? Promise.resolve('TZ=x\nDB_PASSWORD=leak\n')
        : Promise.resolve({ variables: [
            { key: 'DB_PASSWORD', value: '***', isSecret: true },
            { key: 'TZ', value: 'x', isSecret: false },
          ] }));
    const out = jsonOut(await handler({ environmentId: 10, name: 'x' }));
    expect(out.collisions).toEqual(['DB_PASSWORD']);
    expect(typeof out.note).toBe('string');
  });

  it('no collisions → empty list, no note', async () => {
    const { handler, client } = setup();
    client.get.mockImplementation((path: string) =>
      path.endsWith('/env/raw')
        ? Promise.resolve('TZ=x\n')
        : Promise.resolve({ variables: [{ key: 'DB_PASSWORD', value: '***', isSecret: true }] }));
    const out = jsonOut(await handler({ environmentId: 10, name: 'x' }));
    expect(out.collisions).toEqual([]);
    expect(out.note).toBeUndefined();
  });
});
