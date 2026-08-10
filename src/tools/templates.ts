/**
 * Application/stack template and template-source tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerTemplateTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_templates',
    {},
    async () => {
      return jsonResponse(await client.get('/api/templates'));
    }
  );

  registerTool(server, 'create_template_compose',
    {
      template: z.record(z.string(), z.unknown()).describe('The full template object (title, image/repository, ports, volumes, env, restartPolicy, network) as returned by list_templates'),
    },
    async ({ template }) => {
      // The handler reads `const { template } = await request.json()` — send the object under a `template` key.
      return jsonResponse(await client.post('/api/templates/compose', { template }));
    }
  );

  registerTool(server, 'list_template_sources',
    {},
    async () => {
      return jsonResponse(await client.get('/api/templates/sources'));
    }
  );

  registerTool(server, 'create_template_source',
    {
      config: z.record(z.string(), z.unknown()).describe('Template source configuration (e.g. name and URL)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/templates/sources', config));
    }
  );

  registerTool(server, 'update_template_source',
    {
      id: z.number().describe('Template source ID'),
      config: z.record(z.string(), z.unknown()).describe('Fields to update, e.g. enabled, name, url'),
    },
    async ({ id, config }) => {
      // The PUT handler reads id + fields from the JSON body (not a query/path param).
      return jsonResponse(await client.put('/api/templates/sources', { id, ...config }));
    }
  );

  registerTool(server, 'delete_template_source',
    {
      id: z.number().describe('Template source ID'),
    },
    async ({ id }) => {
      return jsonResponse(await client.delete('/api/templates/sources', { id }));
    }
  );
}
