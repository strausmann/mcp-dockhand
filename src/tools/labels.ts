/**
 * Resource label tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerLabelTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_labels', 'List all defined resource labels used to organise and filter containers and stacks; create a new one with `create_label`.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/labels'));
    }
  );

  registerTool(server, 'create_label', 'Create a new resource label (e.g. name and colour) for organising containers and stacks; view the existing labels with `list_labels`.',
    {
      config: z.record(z.string(), z.unknown()).describe('Label configuration (e.g. name, color)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/labels', config));
    }
  );
}
