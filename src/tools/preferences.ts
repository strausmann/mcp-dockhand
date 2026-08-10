/**
 * User sidebar preference tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerPreferenceTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_sidebar_preferences',
    {},
    async () => {
      return jsonResponse(await client.get('/api/preferences/sidebar'));
    }
  );

  registerTool(server, 'set_sidebar_preferences',
    {
      preferences: z.record(z.string(), z.unknown()).describe('Sidebar preference object (layout/visibility settings)'),
    },
    async ({ preferences }) => {
      return jsonResponse(await client.post('/api/preferences/sidebar', preferences));
    }
  );

  registerTool(server, 'reset_sidebar_preferences',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/preferences/sidebar'));
    }
  );
}
