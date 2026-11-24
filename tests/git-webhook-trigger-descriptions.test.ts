/**
 * Regression cover for Issue #317.
 *
 * `get_git_stack_webhook` (GET /api/git/stacks/{id}/webhook) and `get_git_webhook`
 * (GET /api/git/webhook/{id}) are named and were described like reads, but both
 * upstream handlers are webhook TRIGGERS (Finsys/dockhand v1.0.59,
 * src/routes/api/git/stacks/[id]/webhook/+server.ts and
 * src/routes/api/git/webhook/[id]/+server.ts, GET): they deploy when the secret
 * matches (or, with ALLOW_WEBHOOKS_WITHOUT_SECRET=true and no secret configured,
 * without one) and write an audit row otherwise. Neither returns webhook configuration.
 *
 * The fix keeps both tool names (removing them would be a breaking change) but:
 *   - describes both as triggers that can deploy, marks them deprecated and points at
 *     the real alternatives (trigger_git_webhook; get_git_stack / get_git_repository for
 *     webhookEnabled + hasWebhookSecret),
 *   - gives get_git_webhook the optional `secret` query parameter its own spec-derived
 *     description already promised, so the trigger is usable.
 */
import { describe, it, expect, vi } from 'vitest';
import { describeTool } from '../src/openapi/describe-tool.js';
import { registerGitStackTools } from '../src/tools/git-stacks.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[] }>;

function setup() {
  const handlers = new Map<string, ToolHandler>();
  const schemas = new Map<string, Record<string, unknown>>();
  const server = {
    tool: (name: string, _description: string, schema: Record<string, unknown>, _annotations: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
      schemas.set(name, schema);
    },
  };
  const client = { get: vi.fn().mockResolvedValue({ success: true }), post: vi.fn(), put: vi.fn(), delete: vi.fn(), postSSE: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerGitStackTools(server as any, client as any);
  return { handlers, schemas, client };
}

describe('webhook trigger tools are described as triggers, not reads (#317)', () => {
  for (const tool of ['get_git_stack_webhook', 'get_git_webhook']) {
    it(`${tool}: says it triggers a deploy and is deprecated, never that it retrieves configuration`, () => {
      const description = describeTool(tool);
      expect(description).not.toMatch(/retrieve the inbound webhook/i);
      expect(description).not.toMatch(/get webhook details/i);
      expect(description).toMatch(/deprecated/i);
      expect(description).toMatch(/deploy/i);
      expect(description).toMatch(/hasWebhookSecret/);
    });
  }

  it('get_git_stack_webhook points at trigger_git_webhook as its replacement', () => {
    expect(describeTool('get_git_stack_webhook')).toMatch(/trigger_git_webhook/);
  });

  it('get_git_webhook points at get_git_repository for the webhook state', () => {
    expect(describeTool('get_git_webhook')).toMatch(/get_git_repository/);
  });

  // Security audit run 8 (hardening): an LLM that only wants to READ the webhook state must
  // be sent to the read tool first, not to a trigger.
  for (const [tool, reader] of [['get_git_stack_webhook', 'get_git_stack'], ['get_git_webhook', 'get_git_repository']] as const) {
    it(`${tool}: the read pointer (${reader}) comes before any trigger wording`, () => {
      const d = describeTool(tool);
      const readAt = d.indexOf(`\`${reader}\``);
      expect(readAt).toBeGreaterThanOrEqual(0);
      expect(readAt).toBeLessThan(d.search(/deprecated/i));
      expect(readAt).toBeLessThan(d.indexOf('trigger_git_webhook') === -1 ? Infinity : d.indexOf('trigger_git_webhook'));
    });
  }
});

describe('get_git_webhook sends the optional secret as the `secret` query parameter (#317)', () => {
  it('declares an optional secret argument', () => {
    const { schemas } = setup();
    expect(schemas.get('get_git_webhook')).toHaveProperty('secret');
  });

  it('passes the secret as the query parameter when given', async () => {
    const { handlers, client } = setup();
    await handlers.get('get_git_webhook')!({ webhookId: 3, secret: 'example-secret' });
    expect(client.get).toHaveBeenCalledWith('/api/git/webhook/3', { secret: 'example-secret' });
  });

  it('sends no query parameter when the secret is omitted', async () => {
    const { handlers, client } = setup();
    await handlers.get('get_git_webhook')!({ webhookId: 3 });
    expect(client.get).toHaveBeenCalledWith('/api/git/webhook/3', undefined);
  });
});
