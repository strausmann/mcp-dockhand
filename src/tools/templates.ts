/**
 * Application/stack template and template-source tools.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerTemplateTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_templates', 'List all available application/stack templates aggregated from the configured feeds; manage those feeds via `list_template_sources` and `create_template_source`.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/templates'));
    }
  );

  registerTool(server, 'create_template_compose', 'Render/create a Docker Compose definition from a template payload so it can be deployed as a stack; browse the available templates first with `list_templates`.',
    {
      config: z.record(z.string(), z.unknown()).describe('Template payload (e.g. template id/reference and variable values)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/templates/compose', config));
    }
  );

  registerTool(server, 'list_template_sources', 'List the configured template source feeds (URLs) that templates are pulled from; add one with `create_template_source`, modify with `update_template_source`, or remove with `delete_template_source`.',
    {},
    async () => {
      return jsonResponse(await client.get('/api/templates/sources'));
    }
  );

  registerTool(server, 'create_template_source', 'Add a new template source feed (URL) to pull templates from; view existing feeds with `list_template_sources` or the resulting templates via `list_templates`.',
    {
      config: z.record(z.string(), z.unknown()).describe('Template source configuration (e.g. name and URL)'),
    },
    async ({ config }) => {
      return jsonResponse(await client.post('/api/templates/sources', config));
    }
  );

  registerTool(server, 'update_template_source', 'Update an existing template source feed by id; list current feeds with `list_template_sources` or remove one with `delete_template_source`.',
    {
      id: z.number().describe('Template source ID'),
      config: z.record(z.string(), z.unknown()).describe('Updated template source configuration'),
    },
    async ({ id, config }) => {
      return jsonResponse(await client.put('/api/templates/sources', config, { id }));
    }
  );

  registerTool(server, 'delete_template_source', 'Delete a template source feed by id, removing it and its templates from the list; see `list_template_sources` for ids or `create_template_source` to add one.',
    {
      id: z.number().describe('Template source ID'),
    },
    async ({ id }) => {
      return jsonResponse(await client.delete('/api/templates/sources', { id }));
    }
  );
}
