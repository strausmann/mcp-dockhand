/**
 * Backup restore tools — trigger, preview, and cancel restic RESTORES. This is the
 * most destructive surface in the whole API: an in-place restore overwrites the LIVE
 * containers/volumes of the target stack, irreversibly.
 *
 * Ground truth: Finsys/dockhand v1.0.46,
 * src/routes/api/backup/restore/preview/+server.ts   POST (preview)
 * src/routes/api/backup/restore/+server.ts           POST (run)
 * src/routes/api/backup/restore/stop/+server.ts       POST (stop/cancel)
 *
 * PERMISSION NOTE (Finsys/dockhand#1534, filed upstream): the preview handler's own
 * `@openapi` annotation says its 403 is "needs backups:view", but the handler itself
 * calls `requireBackups(auth, 'manage')` — it actually requires `backups:manage`, same
 * as run and stop. This tool follows the HANDLER, not the (wrong) annotation; the field
 * descriptions below say so explicitly since neither the derived MCP description nor
 * docs/dockhand-openapi.json's response-description text is corrected for this (the
 * bug lives entirely in the upstream repo, not in anything this project generates).
 *
 * Job-polling: all three POST handlers are backed by createJobResponse()
 * (src/lib/server/sse.ts upstream) — preview via the thin `jobResult()` wrapper, run
 * directly. A caller sending `Accept: application/json` (and not `text/event-stream`)
 * gets the buffered FINAL result synchronously (`prefersJSON()`,
 * src/lib/server/sse-parser.ts) instead of a `{jobId}` to poll. DockhandClient's shared
 * `request()` always sets `Accept: application/json` (verified by reading
 * src/client/dockhand-client.ts), so all three tools below use the plain client.post()
 * — NEVER client.postSSE(), which would only ever get `{jobId}` back here and there is
 * no polling tool for it (same reasoning as run_backup_config/run_backup_destination_task
 * in backup-configs.ts/backup-destinations.ts).
 *
 * preview_backup_restore body (verified against preview/+server.ts):
 *   destinationId!, snapshotId! (required — handler 400s without both)
 *   includeTargets? (metadata-only preview when omitted/false)
 *   targetEnvId? (early enterprise-access hint on the TARGET environment)
 *   When `mode` is ALSO supplied ('in-place'|'new-location'), the handler additionally
 *   resolves + probes the REAL restore targets on the target host (previewRestoreTargets(),
 *   +server.ts lines ~50-66) — reading these extra fields, all optional:
 *   environmentId?, targetType?, targetName?, targetPath?, volumeDestinations?,
 *   skipStackFiles?, mergeStackFiles?, volumes?. `mergeStackFiles` in particular is NOT
 *   mentioned by the endpoint's `@openapi body:` annotation at all — found only by
 *   reading previewRestoreTargets()'s call in the handler and its downstream
 *   resolveRestoreTargets()/RestoreTargetInput type
 *   (src/lib/server/backups/restore-targets.ts): true = keep the existing stack-dir
 *   contents and only overlay the snapshot (merge); false/omitted = the restored dir
 *   replaces it (stale files cleared) — the flag governs `stackFiles.overwrite` in the
 *   preview response. This is preview-only plumbing: the RUN endpoint below never reads
 *   `body.mergeStackFiles` (its own runRestore() call omits it entirely).
 *   Modeled as ONE combined optional shape (rather than two tools) since it is the SAME
 *   endpoint/body — mode present or absent only changes how rich the response is.
 *
 * run_backup_restore body — modeled off the handler's own runRestore() call
 * (+server.ts):
 *   destinationId!, snapshotId! (required)
 *   mode? ('in-place'|'new-location') — handler DEFAULTS anything else (including
 *     omitted) to 'new-location': `body.mode === 'in-place' ? 'in-place' : 'new-location'`
 *   targetType? (handler coerces: exactly 'stack' -> 'stack', anything else -> 'container'
 *     — so this is deliberately z.string(), not an enum, matching that permissive coercion)
 *   targetName?, targetPath?
 *   volumes?: string[]
 *   volumeDestinations?: array of {volume, kind, target} — shape verified against
 *     validateRestoreRequest() (src/lib/server/backups/validate.ts): `kind:'path'` needs
 *     an absolute, non-'..' `target`; `kind:'volume'` needs a Docker-volume-name-shaped
 *     `target`; `volume` must be a non-empty string. Modeled precisely (not a bare
 *     passthrough object) since the exact shape is now known.
 *   environmentId?
 *   postRestore? ('start'|'recreate'|'redeploy'|'none') — handler whitelists EXACTLY
 *     these four (`['start','recreate','redeploy','none'].includes(body.postRestore)`);
 *     anything else silently becomes `undefined` server-side (not a 400) — modeled as a
 *     zod enum so an invalid value is rejected client-side with a clear message instead
 *     of being silently dropped.
 *   restoreSecrets? (handler default true via `body.restoreSecrets !== false`; explicit
 *     false = bring the stack up WITHOUT its captured secrets — only a stack redeploy
 *     consumes this, container restores ignore it)
 *   skipStackFiles? (handler default false via `body.skipStackFiles === true`; true =
 *     data-only restore, skip the captured compose/.env)
 *   confirmOverwrite? — see SAFETY below
 *
 * SAFETY — confirmOverwrite is CONDITIONALLY required, never unconditionally:
 *   validateRestoreRequest() (src/lib/server/backups/validate.ts:122) 400s when
 *   mode==='in-place' and confirmOverwrite!==true; a new-location restore does NOT need
 *   it at all. Mirrored client-side via `runBackupRestoreBodySchema`'s `.superRefine()`
 *   below, so the dangerous case fails fast and locally with a clear message — WITHOUT
 *   making confirmOverwrite unconditionally required (that would wrongly block every
 *   new-location restore, which is the common, non-destructive case).
 *
 *   This tool's OWN derived MCP description does NOT carry this warning on its own:
 *   deriveToolDescription() (src/openapi/derive-description.ts) surfaces only the
 *   operation's `summary` field plus curated cross-refs extracted from `description` —
 *   it deliberately NEVER surfaces the operation's full `description` prose, and the
 *   real endpoint's "An in-place restore is destructive and requires
 *   confirmOverwrite:true" sentence lives in `description`, not `summary` (verified
 *   against docs/dockhand-openapi.json: the `summary` for POST /api/backup/restore is
 *   just "Restore a backup snapshot in-place or to a new location, streaming progress as
 *   a Server-Sent Events job" — no mention of "destructive" or "confirmOverwrite" at
 *   all). Left alone, the derived description would silently drop the warning entirely.
 *   This is the SAME shape as `run_backup_destination_task`
 *   (src/openapi/description-suffixes.ts, BACKUP_DESTINATION_TASK_DESTRUCTIVE): a
 *   generically-named tool hides a destructive branch inside one enum value among
 *   several, and the endpoint's own summary doesn't single it out. Handled the same way
 *   here — via a new TOOL_DESCRIPTION_SUFFIXES entry (RESTORE_IN_PLACE_DESTRUCTIVE,
 *   description-suffixes.ts), APPENDED to the derived description rather than replacing
 *   it (per that module's own doc comment: append when the spec-derived text is correct
 *   but incomplete for a caller-side operating rule; this is exactly that case, not
 *   invented as a new categorical exception).
 *
 * stop_backup_restore body (verified against stop/+server.ts):
 *   snapshotId?: string, environmentId?: number — BOTH optional; the handler does
 *   `request.json().catch(() => ({}))`, so a missing/empty body is valid. Omitting
 *   snapshotId stops ALL running restore helpers, not just one (per the handler's own
 *   doc comment: "kills the restore helper for the given snapshotId, or all restore
 *   helpers if omitted").
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, errorResponse } from '../utils/tool-helper.js';

/**
 * A single volume's restore destination for a new-location CLONE (populate real
 * destinations on the target env). Shape verified against validateRestoreRequest()
 * (src/lib/server/backups/validate.ts): `kind:'path'` needs an absolute, `..`-free
 * `target`; `kind:'volume'` needs a Docker-volume-name-shaped `target`.
 * `.passthrough()` so an upstream addition to this object isn't silently stripped
 * before it reaches the server, which does the authoritative validation anyway.
 */
const volumeDestinationShape = z.object({
  volume: z.string().describe('Volume name being restored — must be among the requested `volumes`'),
  kind: z.enum(['volume', 'path']).describe('Destination kind: a new Docker volume ("volume") or a host path ("path")'),
  target: z.string().describe('For kind "volume": a valid Docker volume name. For kind "path": an absolute path (no "..")'),
}).passthrough();

/**
 * Shared field definitions for `run_backup_restore` — used BOTH as the MCP tool's flat
 * registration shape (per-field JSON schema, no cross-field constraint possible there)
 * AND, wrapped in `z.object(...).superRefine(...)` below, as the schema the handler
 * re-parses to enforce the confirmOverwrite safety rule before the request ever reaches
 * the server.
 */
const runBackupRestoreShape = {
  destinationId: z.number().describe('Backup destination id holding the snapshot (from list_backup_destinations)'),
  snapshotId: z.string().describe('Snapshot id to restore (from list_backup_snapshots)'),
  mode: z.enum(['in-place', 'new-location']).optional().describe('Restore mode. "in-place" OVERWRITES the live containers/volumes of the target — destructive and IRREVERSIBLE, requires confirmOverwrite:true. "new-location" restores into a separate path/volume without touching anything live. Omitted defaults to "new-location" server-side.'),
  targetType: z.string().optional().describe('Target kind. The handler treats exactly "stack" as a stack restore; any other value (including omitted) is treated as a container restore'),
  targetName: z.string().optional().describe('Container or stack name to restore into / bring up afterwards'),
  targetPath: z.string().optional().describe('Host path to extract into for a new-location restore (required by the server for a plain new-location restore unless every volume has a volumeDestinations entry)'),
  volumes: z.array(z.string()).optional().describe('Specific volume keys to restore; omitted/empty restores all volumes in the snapshot'),
  volumeDestinations: z.array(volumeDestinationShape).optional().describe('Per-volume destinations for a new-location CLONE (populate real volumes/paths on the target env, optionally followed by postRestore recreate/redeploy)'),
  environmentId: z.number().optional().describe('Target environment id to restore into (from GET /api/environments)'),
  postRestore: z.enum(['start', 'recreate', 'redeploy', 'none']).optional().describe('Action to take after the restore completes. The server whitelists exactly these four values; anything else is silently ignored server-side, so this is validated client-side too'),
  restoreSecrets: z.boolean().optional().describe('Reproduce the stack\'s captured secrets on redeploy (default true server-side). Only consumed by a stack redeploy; container restores ignore it. Set false to bring the stack up WITHOUT its captured secrets'),
  skipStackFiles: z.boolean().optional().describe('For a new-location STACK restore: skip the captured compose/.env and restore only data (default false server-side)'),
  confirmOverwrite: z.boolean().optional().describe('REQUIRED (must be true) when mode is "in-place": an in-place restore overwrites the live containers/volumes of the target and is IRREVERSIBLE. Not required, and has no effect, for mode "new-location".'),
};

/**
 * Full request schema for `run_backup_restore`, INCLUDING the cross-field safety rule
 * that a flat MCP tool shape cannot express: mode:'in-place' requires
 * confirmOverwrite:true. Exported so it can be exercised directly
 * (`.safeParse(...)`) without going through the registered tool handler.
 */
export const runBackupRestoreBodySchema = z.object(runBackupRestoreShape).superRefine((val, ctx) => {
  if (val.mode === 'in-place' && val.confirmOverwrite !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmOverwrite'],
      message: 'an in-place restore overwrites the live containers/volumes of the target and is irreversible — confirmOverwrite must be true',
    });
  }
});

export function registerBackupRestoreTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'preview_backup_restore',
    {
      destinationId: z.number().describe('Backup destination id holding the snapshot (from list_backup_destinations)'),
      snapshotId: z.string().describe('Snapshot id to preview (from list_backup_snapshots)'),
      includeTargets: z.boolean().optional().describe('Also resolve and probe the concrete restore targets (host paths / volumes) on the target host. Without this, returns the metadata-only preview'),
      targetEnvId: z.number().optional().describe('Early access hint for the TARGET environment (enterprise RBAC); the snapshot\'s OWNING environment is always gated server-side regardless'),
      mode: z.enum(['in-place', 'new-location']).optional().describe('Restore mode to preview targets for. Supplying this (together with includeTargets-adjacent fields below) makes the handler ALSO resolve the exact on-disk targets the real restore would use'),
      environmentId: z.number().optional().describe('Target environment id (from GET /api/environments) — only read when mode is supplied'),
      targetType: z.string().optional().describe('Target kind ("stack" or "container") — only read when mode is supplied'),
      targetName: z.string().optional().describe('Container or stack name — only read when mode is supplied'),
      targetPath: z.string().optional().describe('Host path for a new-location preview — only read when mode is supplied'),
      volumeDestinations: z.array(volumeDestinationShape).optional().describe('Per-volume destinations to preview for a new-location clone — only read when mode is supplied'),
      skipStackFiles: z.boolean().optional().describe('Preview a data-only restore (captured compose/.env skipped) — only read when mode is supplied'),
      mergeStackFiles: z.boolean().optional().describe('Preview the stack-dir restore as a MERGE (existing files kept, snapshot overlaid) instead of a full overwrite (stale files cleared). Read only by this preview endpoint — the run endpoint below never reads it. Not covered by the endpoint\'s own @openapi body: annotation; found only by reading previewRestoreTargets()\'s call and restore-targets.ts\'s RestoreTargetInput'),
      volumes: z.array(z.string()).optional().describe('Specific volume keys to preview targets for — only read when mode is supplied'),
    },
    async ({ destinationId, snapshotId, includeTargets, targetEnvId, mode, environmentId, targetType, targetName, targetPath, volumeDestinations, skipStackFiles, mergeStackFiles, volumes }) => {
      const body: Record<string, unknown> = { destinationId, snapshotId };
      if (includeTargets !== undefined) body.includeTargets = includeTargets;
      if (targetEnvId !== undefined) body.targetEnvId = targetEnvId;
      if (mode !== undefined) body.mode = mode;
      if (environmentId !== undefined) body.environmentId = environmentId;
      if (targetType !== undefined) body.targetType = targetType;
      if (targetName !== undefined) body.targetName = targetName;
      if (targetPath !== undefined) body.targetPath = targetPath;
      if (volumeDestinations !== undefined) body.volumeDestinations = volumeDestinations;
      if (skipStackFiles !== undefined) body.skipStackFiles = skipStackFiles;
      if (mergeStackFiles !== undefined) body.mergeStackFiles = mergeStackFiles;
      if (volumes !== undefined) body.volumes = volumes;
      // Plain client.post(): the handler is backed by jobResult()/createJobResponse(),
      // which honours Accept: application/json (always sent by DockhandClient) with a
      // synchronous buffered result — see the file header. NEVER client.postSSE() here.
      return jsonResponse(await client.post('/api/backup/restore/preview', body));
    }
  );

  registerTool(server, 'run_backup_restore',
    runBackupRestoreShape,
    async (args) => {
      // Re-parse with the full schema (INCLUDING the superRefine) — the flat shape
      // above only gives the MCP client per-field types, it cannot express the
      // cross-field confirmOverwrite rule. This is the client-side mirror of the
      // server's validateRestoreRequest(); see the file header SAFETY section.
      const parsed = runBackupRestoreBodySchema.safeParse(args);
      if (!parsed.success) {
        return errorResponse(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      }
      const { destinationId, snapshotId, mode, targetType, targetName, targetPath, volumes, volumeDestinations, environmentId, postRestore, restoreSecrets, skipStackFiles, confirmOverwrite } = parsed.data;
      const body: Record<string, unknown> = { destinationId, snapshotId };
      if (mode !== undefined) body.mode = mode;
      if (targetType !== undefined) body.targetType = targetType;
      if (targetName !== undefined) body.targetName = targetName;
      if (targetPath !== undefined) body.targetPath = targetPath;
      if (volumes !== undefined) body.volumes = volumes;
      if (volumeDestinations !== undefined) body.volumeDestinations = volumeDestinations;
      if (environmentId !== undefined) body.environmentId = environmentId;
      if (postRestore !== undefined) body.postRestore = postRestore;
      if (restoreSecrets !== undefined) body.restoreSecrets = restoreSecrets;
      if (skipStackFiles !== undefined) body.skipStackFiles = skipStackFiles;
      if (confirmOverwrite !== undefined) body.confirmOverwrite = confirmOverwrite;
      // Plain client.post(): createJobResponse() honours Accept: application/json
      // (always sent by DockhandClient) with a synchronous buffered final result —
      // see the file header. NEVER client.postSSE() here — it would only ever get
      // `{jobId}` back and there is no polling tool for it.
      return jsonResponse(await client.post('/api/backup/restore', body));
    }
  );

  registerTool(server, 'stop_backup_restore',
    {
      snapshotId: z.string().optional().describe('Snapshot id whose restore helper to kill. Omitted stops ALL running restore helpers'),
      environmentId: z.number().optional().describe('Environment id to scope the cancel to (from GET /api/environments)'),
    },
    async ({ snapshotId, environmentId }) => {
      const body: Record<string, unknown> = {};
      if (snapshotId !== undefined) body.snapshotId = snapshotId;
      if (environmentId !== undefined) body.environmentId = environmentId;
      return jsonResponse(await client.post('/api/backup/restore/stop', body));
    }
  );
}
