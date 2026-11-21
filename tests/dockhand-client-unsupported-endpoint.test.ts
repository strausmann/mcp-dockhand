/**
 * A route the connected Dockhand does not have answers 404 with SvelteKit's HTML error
 * page; a Dockhand handler reporting a missing stack/container answers 404 with JSON.
 * On Dockhand 1.0.24, for example, run_container_exec (POST .../exec/run),
 * list_stack_deploys (GET .../deploys) and get_stack_delete_preview (GET
 * .../delete-preview) all hit the HTML page. The client turns that case into a clear
 * "not supported by this Dockhand version" error and leaves JSON 404s alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockhandClient } from '../src/client/dockhand-client.js';

const HTML_404 = '<!doctype html>\n<html lang="en">\n\t<head>\n\t\t<meta charset="utf-8" />\n</head><body>Not Found</body></html>';

function html404() {
  return new Response(HTML_404, { status: 404, headers: { 'content-type': 'text/html' } });
}

function client() {
  return new DockhandClient({ url: 'https://dockhand.example.com', apiToken: 'dh_test' });
}

describe('DockhandClient — HTML 404 means the endpoint is missing on this Dockhand version', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('GET: throws a "not supported" error naming the route template, not the HTML page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html404()));
    const err = await client().get('/api/stacks/my-secret-stack/deploys', { env: 1 }).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toMatch(/^Not supported by this Dockhand version: GET \/api\/stacks\/\{name\}\/deploys does not exist/);
    expect(message).not.toContain('<!doctype');
    // The template, not the caller's identifiers or query.
    expect(message).not.toContain('my-secret-stack');
    expect(message).not.toContain('env=1');
  });

  it('POST: same for run_container_exec\'s route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html404()));
    const err = await client().post('/api/containers/abc123/exec/run', { cmd: ['true'] }, { envId: 1 }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Not supported by this Dockhand version: POST \/api\/containers\/\{id\}\/exec\/run/);
  });

  it('SSE: returns success:false with the same message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html404()));
    const result = await client().putSSE('/api/stacks/s/compose', { content: 'x', restart: true }, { env: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^Not supported by this Dockhand version: PUT \/api\/stacks\/\{name\}\/compose/);
  });

  it('a JSON 404 from a Dockhand handler (missing stack) keeps the normal API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Stack not found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    })));
    const err = await client().get('/api/stacks/missing/compose', { env: 1 }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/^Dockhand API error: GET .* returned 404: \{"error":"Stack not found"\}/);
    expect((err as Error).message).not.toMatch(/Not supported/);
  });

  it('an HTML 500 (e.g. a proxy error page) is not mistaken for a missing endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', {
      status: 502, headers: { 'content-type': 'text/html' },
    })));
    const err = await client().get('/api/stacks', { env: 1 }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/^Dockhand API error: GET .* returned 502/);
  });
});
