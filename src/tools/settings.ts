/**
 * Global (instance-wide) settings tools that are not tied to a specific
 * environment: the semver update-check config and the minimum image release
 * age. Other settings/* endpoints live in system.ts alongside
 * general/scanner/theme.
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
      rejectOlderImages: z.boolean().optional().describe('Drop a candidate whose image was built before the running one (catches old tags that sort high, e.g. lidarr:8.1.2135 from 2021). Unlike the other fields, an omitted value keeps the stored setting (default true).'),
    },
    // IMPORTANT: this endpoint does NOT merge with the currently stored
    // config — the handler (setGlobalSemverConfig) always writes a brand-new
    // object built from the request body, applying the defaults above to
    // whatever field is missing. Passing only `maxBump`, for example, resets
    // `enabled`/`matchFlavor`/`includePrerelease` to their defaults rather
    // than leaving them at their current stored value. Callers that want to
    // change one field must first read the current config via
    // `get_semver_settings` and resend the full shape. The one exception is
    // `rejectOlderImages` (Dockhand 1.0.54): an omitted value keeps the stored one.
    async ({ enabled, maxBump, matchFlavor, includePrerelease, rejectOlderImages }) => {
      const body: Record<string, unknown> = {};
      if (enabled !== undefined) body.enabled = enabled;
      if (maxBump !== undefined) body.maxBump = maxBump;
      if (matchFlavor !== undefined) body.matchFlavor = matchFlavor;
      if (includePrerelease !== undefined) body.includePrerelease = includePrerelease;
      if (rejectOlderImages !== undefined) body.rejectOlderImages = rejectOlderImages;
      return jsonResponse(await client.post('/api/settings/semver', body));
    }
  );

  // --- Minimum image release age (Dockhand 1.0.54, #301) ---
  //
  // Ground truth: Finsys/dockhand v1.0.54,
  // src/routes/api/settings/minimum-release-age/+server.ts. Global default; an
  // environment can override it via set_environment_update_check. POST answers 409
  // when the MINIMUM_RELEASE_AGE_HOURS env var pins the value.

  registerTool(server, 'get_minimum_release_age',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/minimum-release-age'));
    }
  );

  registerTool(server, 'set_minimum_release_age',
    {
      hours: z.number().int().min(0).max(720).describe('Minimum age in hours (whole number, 0 to 720) a new image digest must reach before automatic updates use it; a manual pull is only warned. 0 disables the cooldown'),
    },
    async ({ hours }) => {
      return jsonResponse(await client.post('/api/settings/minimum-release-age', { hours }));
    }
  );

  // --- Moved digest on a pinned image (Dockhand 1.0.55+, #340) ---
  //
  // Ground truth: Finsys/dockhand v1.0.59,
  // src/routes/api/settings/pinned-digest-report/+server.ts. Global. The POST stores
  // `enabled === true`, so anything else (including an omitted field) switches the
  // report off — hence `enabled` is required here.

  registerTool(server, 'get_pinned_digest_report',
    {},
    async () => {
      return jsonResponse(await client.get('/api/settings/pinned-digest-report'));
    }
  );

  registerTool(server, 'set_pinned_digest_report',
    {
      enabled: z.boolean().describe('Instance-wide (needs settings:edit). Report when the digest behind a pinned image tag moves (true) or stay silent (false). Required: the endpoint stores false for anything but true'),
    },
    async ({ enabled }) => {
      return jsonResponse(await client.post('/api/settings/pinned-digest-report', { enabled }));
    }
  );
}
