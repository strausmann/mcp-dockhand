/**
 * Global (instance-wide) settings tools that are not tied to a specific
 * environment. Currently just the semver update-check config; other
 * settings/* endpoints live in system.ts alongside general/scanner/theme.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse } from '../utils/tool-helper.js';

export function registerSettingsTools(server: McpServer, client: DockhandClient): void {

  // --- Semver update-check config ---
  //
  // Ground truth: Finsys/dockhand v1.0.46,
  // src/routes/api/settings/semver/+server.ts + src/lib/server/db.ts
  // (getGlobalSemverConfig/setGlobalSemverConfig, single row keyed
  // 'global_semver_check'). This decides HOW every version check (scheduled
  // or manual, on any environment) reads tags — it is GLOBAL, not
  // env-scoped, unlike most other settings/* endpoints (no `?env=` param).

  registerTool(server, 'get_semver_settings',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/semver'));
    }
  );

  registerTool(server, 'update_semver_settings',
    {
      enabled: z.boolean().optional().describe('Enable scheduled newer-version-tag (semver) detection. Omitted is treated as false by the real endpoint (it does not preserve the previously stored value).'),
      maxBump: z.enum(['patch', 'minor', 'major']).optional().describe('Highest semver bump level still considered a "newer version" candidate. An omitted or invalid value is defaulted server-side to "major".'),
      matchFlavor: z.boolean().optional().describe('Only match tags sharing the current tag\'s non-version suffix (e.g. "-alpine"). Omitted is defaulted server-side to true.'),
      includePrerelease: z.boolean().optional().describe('Include prerelease tags (e.g. "-rc1") as newer-version candidates. Omitted is treated as false by the real endpoint.'),
    },
    // IMPORTANT: this endpoint does NOT merge with the currently stored
    // config — the handler (setGlobalSemverConfig) always writes a brand-new
    // object built from the request body, applying the defaults above to
    // whatever field is missing. Passing only `maxBump`, for example, resets
    // `enabled`/`matchFlavor`/`includePrerelease` to their defaults rather
    // than leaving them at their current stored value. Callers that want to
    // change one field must first read the current config via
    // `get_semver_settings` and resend the full shape.
    async ({ enabled, maxBump, matchFlavor, includePrerelease }) => {
      const body: Record<string, unknown> = {};
      if (enabled !== undefined) body.enabled = enabled;
      if (maxBump !== undefined) body.maxBump = maxBump;
      if (matchFlavor !== undefined) body.matchFlavor = matchFlavor;
      if (includePrerelease !== undefined) body.includePrerelease = includePrerelease;
      return jsonResponse(await client.post('/api/settings/semver', body));
    }
  );
}
