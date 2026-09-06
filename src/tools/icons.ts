/**
 * Icon tools — container/stack icon overrides (custom uploads or name references) and
 * the selfh.st app-icon catalog Dockhand proxies/caches for the icon picker.
 *
 * Every contract below was read off the real handler (Finsys/dockhand, pinned commit),
 * not just the `@openapi` annotation summary:
 *   src/routes/api/container-icons/+server.ts          GET (query env?:int) - name ->
 *     icon map for every container with an override in that environment.
 *   src/routes/api/container-icons/[name]/+server.ts   GET (path name!:string, query
 *     env?:int) - the container's UPLOADED custom icon as raw image/webp bytes (404 if
 *     none set, i.e. the icon is a lucide/selfhst reference instead); POST (same path/
 *     query, body {icon?, image?}) sets EITHER a reference (lucide name / `selfhst:
 *     <ref>`) OR an uploaded image (base64 data URL, ~300KB); DELETE removes the
 *     override entirely (falls back to automatic matching).
 *   src/routes/api/stacks/[name]/icon/+server.ts       Same three verbs, same body
 *     shape, for a stack instead of a container.
 *   src/routes/api/icons/selfhst-manifest/+server.ts   GET (no params) - the full
 *     selfh.st index.json manifest (~2880 entries), disk-cached with a 7-day TTL.
 *   src/routes/api/icons/selfhst/[ref]/+server.ts      GET (path ref!:string) - a
 *     single selfh.st icon as raw image/svg+xml bytes. Never 404s: an unresolvable ref
 *     gets a neutral placeholder SVG (200), so a caller cannot use this to probe which
 *     refs exist.
 *   src/routes/api/icons/selfhst/batch/+server.ts      POST (body {refs:string[]}) -
 *     resolves many selfh.st icons in ONE call, each returned as a data:image/svg+xml
 *     URI keyed by ref; unresolvable/invalid refs are simply omitted from the result
 *     (no per-ref errors).
 *
 * The two GET-binary-image endpoints (container/stack custom icon) use client.getRaw()
 * + `textResponse(`base64:${...}`)`, the same framing download_container_file and
 * download_backup_snapshot_file use for their own raw bytes — a UTF-8 round-trip would
 * corrupt a binary webp. get_selfhst_icon does the same for its SVG bytes, even though
 * SVG is technically text: the handler can return either a cached upstream SVG OR a
 * hand-written placeholder, and treating both uniformly as opaque bytes avoids having
 * to special-case which one it got.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerIconTools(server: McpServer, client: DockhandClient): void {

  // --- Container icon overrides ---

  registerTool(server, 'get_container_icon_overrides',
    {
      environmentId: z.number().optional().describe('Environment ID (omit for all environments)'),
    },
    async ({ environmentId }) => {
      return jsonResponse(await client.get('/api/container-icons', { env: environmentId }));
    }
  );

  registerTool(server, 'get_container_icon',
    {
      containerName: z.string().describe('Container name'),
      environmentId: z.number().optional().describe('Environment ID the container belongs to'),
    },
    async ({ containerName, environmentId }) => {
      const buffer = await client.getRaw(`/api/container-icons/${encodePath(containerName)}`, { env: environmentId });
      return textResponse(`base64:${buffer.toString('base64')}`);
    }
  );

  registerTool(server, 'set_container_icon',
    {
      containerName: z.string().describe('Container name'),
      environmentId: z.number().optional().describe('Environment ID the container belongs to'),
      icon: z.string().optional().describe('A lucide icon name or `selfhst:<ref>` reference; use this OR image'),
      image: z.string().optional().describe('A base64-encoded image data URL to upload as a custom icon (~300KB limit); use this OR icon'),
    },
    async ({ containerName, environmentId, icon, image }) => {
      const body: Record<string, unknown> = {};
      if (icon !== undefined) body.icon = icon;
      if (image !== undefined) body.image = image;
      return jsonResponse(
        await client.post(`/api/container-icons/${encodePath(containerName)}`, body, { env: environmentId })
      );
    }
  );

  registerTool(server, 'remove_container_icon',
    {
      containerName: z.string().describe('Container name'),
      environmentId: z.number().optional().describe('Environment ID the container belongs to'),
    },
    async ({ containerName, environmentId }) => {
      return jsonResponse(
        await client.delete(`/api/container-icons/${encodePath(containerName)}`, { env: environmentId })
      );
    }
  );

  // --- Stack icon overrides ---

  registerTool(server, 'get_stack_icon',
    {
      stackName: z.string().describe('Stack name'),
      environmentId: z.number().optional().describe('Environment ID the stack belongs to'),
    },
    async ({ stackName, environmentId }) => {
      const buffer = await client.getRaw(`/api/stacks/${encodePath(stackName)}/icon`, { env: environmentId });
      return textResponse(`base64:${buffer.toString('base64')}`);
    }
  );

  registerTool(server, 'set_stack_icon',
    {
      stackName: z.string().describe('Stack name'),
      environmentId: z.number().optional().describe('Environment ID the stack belongs to'),
      icon: z.string().optional().describe('A lucide icon name or `selfhst:<ref>` reference; use this OR image'),
      image: z.string().optional().describe('A base64-encoded image data URL to upload as a custom icon (~300KB limit); use this OR icon'),
    },
    async ({ stackName, environmentId, icon, image }) => {
      const body: Record<string, unknown> = {};
      if (icon !== undefined) body.icon = icon;
      if (image !== undefined) body.image = image;
      return jsonResponse(
        await client.post(`/api/stacks/${encodePath(stackName)}/icon`, body, { env: environmentId })
      );
    }
  );

  registerTool(server, 'remove_stack_icon',
    {
      stackName: z.string().describe('Stack name'),
      environmentId: z.number().optional().describe('Environment ID the stack belongs to'),
    },
    async ({ stackName, environmentId }) => {
      return jsonResponse(
        await client.delete(`/api/stacks/${encodePath(stackName)}/icon`, { env: environmentId })
      );
    }
  );

  // --- selfh.st icon catalog ---

  registerTool(server, 'get_selfhst_icon_manifest',
    {},
    async () => {
      return jsonResponse(await client.get('/api/icons/selfhst-manifest'));
    }
  );

  registerTool(server, 'get_selfhst_icon',
    {
      ref: z.string().describe('selfh.st icon reference (lowercase letters, digits, hyphens), e.g. "plex"'),
    },
    async ({ ref }) => {
      const buffer = await client.getRaw(`/api/icons/selfhst/${encodePath(ref)}`);
      return textResponse(`base64:${buffer.toString('base64')}`);
    }
  );

  registerTool(server, 'batch_get_selfhst_icons',
    {
      refs: z.array(z.string()).describe('selfh.st icon references to resolve in one call (capped server-side at 200)'),
    },
    async ({ refs }) => {
      return jsonResponse(await client.post('/api/icons/selfhst/batch', { refs }));
    }
  );
}
