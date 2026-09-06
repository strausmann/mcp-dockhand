/**
 * Backup stack-path probe tools — resolve/validate a stack's backup path before
 * configuring a backup destination/schedule.
 *
 * Ground truth: Finsys/dockhand v1.0.46, both `GET`, guarded by
 * `requireBackups(auth,'view')`, query `target!` (stack name) + `env?` (environment
 * ID, integer):
 *   src/routes/api/backup/stack-dir-listing/+server.ts   probeStackDir()
 *   src/routes/api/backup/stack-path/+server.ts           previewStackBackupPath()
 *
 * Neither handler throws for an OPERATIONAL failure (host unreachable, compose file
 * not resolvable, etc.) — both catch internally and return 200 with
 * `{ kind: 'unknown', reason }`. `target` missing is the one case that short-circuits
 * BEFORE the try/catch with a 400 `{ error: 'target is required' }`; zod enforces this
 * client-side (required string), so a caller going through the tool's schema can only
 * hit that 400 by construction error upstream, not by omission here.
 *
 * Tool naming: neither endpoint fetches a stored resource (there's nothing to
 * `list_`/`get_` — no persisted "stack-dir-listing" or "stack-path" object exists).
 * Both actively probe/preview live host state, matching the existing verb-prefixed
 * convention for this shape of GET tool in this repo — `probe_secret_provider`
 * (src/tools/secret-providers.ts) for "contact something live and report what's
 * there", and `get_stack_delete_preview` (src/tools/stacks.ts) for "show what would
 * happen without doing it" (its `preview_` naming lives in the tool suffix here
 * instead of a `get_..._preview` prefix since there's no underlying noun to prefix —
 * "preview_backup_stack_path" reads the same way "probe_backup_stack_dir" does).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

const probeArgs = {
  target: z.string().describe('Target stack name to probe/preview the backup path for'),
  environmentId: z.number().optional().describe('Environment ID the stack belongs to (from GET /api/environments)'),
};

export function registerBackupProbeTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'probe_backup_stack_dir',
    probeArgs,
    async ({ target, environmentId }) => {
      return jsonResponse(await client.get('/api/backup/stack-dir-listing', { target, env: environmentId }));
    }
  );

  registerTool(server, 'preview_backup_stack_path',
    probeArgs,
    async ({ target, environmentId }) => {
      return jsonResponse(await client.get('/api/backup/stack-path', { target, env: environmentId }));
    }
  );
}
