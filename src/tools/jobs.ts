// GET/DELETE /api/jobs/{id}: `lines` holds every line on each call; a cancel stops at the next unit of work.

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
