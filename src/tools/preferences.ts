/**
 * User sidebar preference tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerPreferenceTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'get_sidebar_preferences', 'Read the current sidebar layout and visibility preferences; change them with `set_sidebar_preferences` or restore the defaults with `reset_sidebar_preferences`.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/preferences/sidebar'));
    }
  );

  registerTool(server, 'set_sidebar_preferences', 'Persist the sidebar layout and visibility preferences; read the current state first with `get_sidebar_preferences` or restore defaults via `reset_sidebar_preferences`.',
    {
      preferences: z.record(z.string(), z.unknown()).describe('Sidebar preference object (layout/visibility settings)'),
    },
    async ({ preferences }) => {
      return jsonResponse(await client.post('/api/preferences/sidebar', preferences));
    }
  );

  registerTool(server, 'reset_sidebar_preferences', 'Reset the sidebar preferences back to defaults, clearing the stored layout; read the current state with `get_sidebar_preferences` or set a new one with `set_sidebar_preferences`.',
    {},
    async () => {
      return jsonResponse(await client.delete('/api/preferences/sidebar'));
    }
  );
}
