/**
 * Resource label tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerLabelTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_labels', 'List all defined resource labels used to organise and filter containers and stacks; attach a label to environments with `add_label`.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/labels'));
    }
  );

  registerTool(server, 'add_label', 'Attach a label to one or more environments — this is how a label first comes into existence in Dockhand (there is no separate create step). View the existing labels with `list_labels`.',
    {
      label: z.string().describe('Label name'),
      environmentIds: z.array(z.number()).describe('Environment IDs to attach the label to'),
    },
    async ({ label, environmentIds }) => {
      return jsonResponse(await client.post('/api/labels', { action: 'add', label, environmentIds }));
    }
  );
}
