/**
 * Resource label tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerLabelTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_labels',
    {},
    async () => {
      return jsonResponse(await client.get('/api/labels'));
    }
  );

  registerTool(server, 'add_label',
    {
      label: z.string().describe('Label name'),
      environmentIds: z.array(z.number()).describe('Environment IDs to attach the label to'),
    },
    async ({ label, environmentIds }) => {
      return jsonResponse(await client.post('/api/labels', { action: 'add', label, environmentIds }));
    }
  );
}
