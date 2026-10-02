/**
 * Background-job tools — poll and cancel the jobs that Dockhand's long-running
 * operations hand back as `{ jobId }` (git stack deploys, stack restarts, image pulls,
 * update checks, prunes…) when the client does not hold the SSE stream open.
 *
 * Contracts read off the real handler (Finsys/dockhand, pinned commit):
 *   src/routes/api/jobs/[id]/+server.ts
 *     GET    (path id!:string) - `{ id, status, lines, result }`. `lines` is EVERY
 *            accumulated `{ event, data }` line on every call (the server keeps no
 *            per-client cursor); `result` is null until the job finishes.
 *     DELETE (path id!:string) - `{ cancelled }`. Only requests cancellation: the
 *            operation checks the flag between units of work and stops at the next
 *            boundary, so the job can still report `running` right after this call.
 *   Both return 404 `Job not found` for an unknown id AND for a job the caller does not
 *   own (non-admin) — the server hides existence, so a 404 is not proof the id is wrong.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerJobTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_job',
    {
      jobId: z.string().min(1).describe('Job id (UUID) returned as `jobId` by a long-running operation (a git stack deploy, a stack restart, …)'),
    },
    async ({ jobId }) => {
      return jsonResponse(await client.get(`/api/jobs/${encodePath(jobId)}`));
    }
  );

  registerTool(server, 'cancel_job',
    {
      jobId: z.string().min(1).describe('Job id (UUID) of a running background job'),
    },
    async ({ jobId }) => {
      return jsonResponse(await client.delete(`/api/jobs/${encodePath(jobId)}`));
    }
  );
}
