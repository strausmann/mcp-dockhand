/**
 * Backup snapshot + instance tools — restic snapshots stored inside a backup
 * destination's repository, plus this install's own stable instance id.
 *
 * Ground truth: Finsys/dockhand v1.0.46,
 * src/routes/api/backup/snapshots/+server.ts               GET (list)
 * src/routes/api/backup/snapshots/diff/+server.ts           GET (diff)
 * src/routes/api/backup/snapshots/[id]/+server.ts           DELETE (forget/prune)
 * src/routes/api/backup/snapshots/[id]/browse/+server.ts    GET (browse)
 * src/routes/api/backup/snapshots/[id]/dump/+server.ts      GET (dump — preview AND
 *                                                                  binary download, #247)
 * src/routes/api/backup/snapshots/[id]/metadata/+server.ts  GET (metadata, server-redacted)
 * src/routes/api/backup/instance/+server.ts                 GET (this install's instance id)
 *
 * Job-polling: all five GET handlers above are backed by `jobResult()`/
 * `createJobResponse()` (src/lib/server/sse.ts upstream). A caller sending
 * `Accept: application/json` (and NOT `text/event-stream`) gets the buffered result
 * synchronously — `prefersJSON()` in src/lib/server/sse-parser.ts. DockhandClient.request()
 * (the shared method behind client.get/post/put/delete) always sets exactly that header
 * (verified by reading src/client/dockhand-client.ts's `request()`), so every tool below
 * uses the plain client.get()/client.delete() — never postSSE(), which would only ever
 * get `{jobId}` back here and there is no polling tool for it (same reasoning as
 * run_backup_config in backup-configs.ts and run_backup_destination_task in
 * backup-destinations.ts).
 *
 * list_backup_snapshots query params (verified against the handler's own
 * `url.searchParams.get(...)` reads, not just its `@openapi query:` annotation):
 * `configId` and `destinationId` are each optional but mutually exclusive in practice —
 * the handler 400s only when BOTH are absent (`'configId or destinationId parameter is
 * required'`), so this tool does not enforce mutual exclusivity client-side either
 * (matching list_backup_configs' filter style: forward whatever was given, let the
 * server validate). `allDestinations` is read via a literal string comparison
 * (`url.searchParams.get('allDestinations') === 'true'`) — this tool accepts it as a
 * zod boolean for a natural caller-facing type and stringifies it before it reaches
 * `client.get()` (whose params type is `string | number | undefined`, matching the
 * pattern `force: force ? 'true' : undefined` already used for `delete_stack` in
 * stacks.ts). Unlike delete_stack's boolean flags, `allDestinations` IS forwarded even
 * when explicitly `false` (as the literal string `'false'`) rather than omitted — kept
 * for symmetry with the "multi-filter query forwards each param" contract this whole
 * list tool follows (list_backup_configs' `list_backup_configs` test asserts the same
 * for its own no-filter call); the handler's `=== 'true'` check treats an explicit
 * `'false'` and an absent param identically, so this is a style choice, not a
 * behavioral requirement.
 *
 * diff_backup_snapshots: all three query params (`destinationId`, `snapshotA`,
 * `snapshotB`) are required — the handler 400s if any is missing.
 *
 * delete_backup_snapshot: DELETE, path `id` (the snapshot id), required query
 * `destinationId`, optional query `env` (an early enterprise-access hint; the handler's
 * doc comment makes clear the AUTHORITATIVE environment gate re-resolves the
 * snapshot's OWNING environment server-side regardless of what `env` says — HIGH #8 in
 * the handler's own audit trail). Runs `restic forget --prune` — IRREVERSIBLE, permanently
 * discards the snapshot and any data it alone referenced. Requires `backups:manage`
 * (every other tool in this file only needs `backups:view`). The endpoint's own
 * `@openapi summary` already states "destructive restic forget --prune" and
 * `deriveToolDescription()` surfaces that verbatim as this tool's MCP description — no
 * TOOL_DESCRIPTION_SUFFIXES override needed for the irreversibility warning itself (the
 * spec-derived text already carries it, and per description-suffixes.ts's own bar
 * "this is destructive" is not grounds for a suffix once the endpoint already says so).
 *
 * browse_backup_snapshot / dump_backup_snapshot_file / get_backup_snapshot_metadata all
 * share the path `id` (snapshot id) + required query `destinationId`. browse also takes
 * an optional `path` (server defaults to `'/'` when omitted — this tool passes `path`
 * through as-is and lets that default apply rather than hardcoding `'/'` client-side)
 * and an optional `env` (same early-hint-vs-authoritative-gate relationship as delete's
 * `env` above).
 *
 * dump_backup_snapshot_file — PREVIEW ONLY, deliberately incomplete vs. the full
 * endpoint contract (was a #202 follow-up; the binary variant below closes it, #247):
 *   - The real endpoint has THREE response shapes: an inline text/JSON preview (the
 *     default), a raw binary tar/byte stream when `download=1` is set (window.open-style
 *     navigation, can't be JSON-wrapped, needs `client.getRaw()` + base64 to model over
 *     MCP — see download_backup_snapshot_file below), and a 403 refusal of a raw
 *     `metadata.json` download specifically (to force that one path through the
 *     redacting metadata endpoint instead).
 *   - This tool's schema has NO `download` field at all, and the query object built
 *     below never includes that key — so it can only ever reach the inline-preview
 *     branch.
 *   - `path`/`type` select between a directory-listing preview (`type: 'directory'`)
 *     and a single-file preview (`type` omitted or anything else) — modeled as
 *     `z.enum(['directory']).optional()` since that literal is the only value the
 *     handler's `isDir = ... === 'directory'` check treats specially.
 *   - SECURITY (required by the task brief): dumping a file under `/volumes/*` returns
 *     the backed-up file's content verbatim — that's real application data, and can
 *     include actual secrets (passwords, API keys, private keys, credentialed config
 *     files) that were sitting inside a backed-up container's volume. This is called
 *     out via a TOOL_DESCRIPTION_SUFFIXES entry (description-suffixes.ts) rather than
 *     only in this file's own comments, since the suffix is what actually reaches an
 *     MCP caller at the tool-description level. `/metadata/metadata.json` is the one
 *     path the endpoint itself redacts before returning (never raw) — surfaced in the
 *     same suffix, pointing callers at get_backup_snapshot_metadata instead for that.
 *
 * download_backup_snapshot_file (#247, the binary-download follow-up to #202) — the
 * SAME endpoint (`GET .../dump`) as dump_backup_snapshot_file, called with `download`
 * hardcoded to `'1'` (never a caller-facing field, matching how dump_backup_snapshot_file
 * hardcodes its ABSENCE) and `client.getRaw()` instead of `client.get()`:
 *   - `type: 'directory'` streams the whole directory as a tar (`application/x-tar`
 *     server-side); omitted/any other value streams a single file's raw bytes
 *     (`application/octet-stream` server-side). `client.getRaw()` doesn't care which —
 *     it just returns the raw `Buffer` either way (verified against
 *     src/client/dockhand-client.ts's `getRaw()`: `Buffer.from(await
 *     response.arrayBuffer())`, no content-type branching) — mirrors
 *     download_container_file (src/tools/containers.ts), which frames its own
 *     `client.getRaw()` result the same way for a single-file download.
 *   - Response framing: `textResponse(`base64:${buffer.toString('base64')}`)` — same
 *     literal pattern as download_container_file, chosen there (not jsonResponse) because
 *     the payload is raw bytes, not JSON; a UTF-8 round-trip would corrupt any non-ASCII
 *     byte in a tar or binary file (the handler's own comment on the archive branch says
 *     the same: "a UTF-8 round-trip would corrupt any non-ASCII byte in the archive").
 *   - The server's own `/metadata/metadata.json` raw-download refusal (403, "cannot be
 *     downloaded raw; use the snapshot metadata endpoint") applies unchanged here — this
 *     tool does nothing client-side to special-case that path; the 403 surfaces as a
 *     normal `requestRaw()`-thrown Error, same as any other non-ok response.
 *   - SECURITY: same /volumes/* real-secrets exposure as dump_backup_snapshot_file, PLUS
 *     the returned content is now the actual raw bytes (base64-framed), not a redacted
 *     preview string — surfaced via its own TOOL_DESCRIPTION_SUFFIXES entry.
 *
 * get_backup_snapshot_metadata: no further query params beyond destinationId — the
 * response is already redacted server-side (stack secrets + container Config.Env/Labels
 * stripped by redactSnapshotLayout()) before it leaves the process, so this tool is safe
 * to log/print unlike dump_backup_snapshot_file/download_backup_snapshot_file.
 *
 * get_backup_instance_id: no path, no query at all.
 *
 * Doc gap noticed while reading the handlers (report, don't file — matches this repo's
 * existing convention in backup-destinations.ts's header comment): the
 * `@openapi query: allDestinations:boolean` annotation on the list handler documents the
 * TYPE as boolean, but the handler itself only ever reads it as a raw query string
 * compared against the literal `'true'` — `docs/dockhand-openapi.json`'s generated
 * parameter schema (`type: boolean`) doesn't reflect that any non-`'true'` string
 * (including the literal string `'false'`) is silently treated as `false` server-side.
 * Not a hard validate-mcp-tools.mjs finding (the param name/requiredness match), just an
 * annotation-vs-implementation nuance worth flagging upstream.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DockhandClient } from '../client/dockhand-client.js';
import { registerTool, jsonResponse, textResponse } from '../utils/tool-helper.js';
import { encodePath } from '../utils/encode-path.js';

export function registerBackupSnapshotTools(server: McpServer, client: DockhandClient): void {

  registerTool(server, 'list_backup_snapshots',
    {
      configId: z.number().optional().describe('Backup config id — list restic snapshots across all of its destinations by default (in practice mutually exclusive with destinationId; the backend requires at least one of the two)'),
      destinationId: z.number().optional().describe('Single backup destination id — list every snapshot in it, including ones from other Dockhand installs sharing/copied into the repo (in practice mutually exclusive with configId; the backend requires at least one of the two)'),
      allDestinations: z.boolean().optional().describe('With configId, search EVERY backup destination instead of just the config\'s current one (default: false — only the current destination). Ignored when configId is omitted.'),
    },
    async ({ configId, destinationId, allDestinations }) => {
      return jsonResponse(await client.get('/api/backup/snapshots', {
        configId,
        destinationId,
        allDestinations: allDestinations === undefined ? undefined : String(allDestinations),
      }));
    }
  );

  registerTool(server, 'diff_backup_snapshots',
    {
      destinationId: z.number().describe('Destination both snapshots live in (from list_backup_destinations)'),
      snapshotA: z.string().describe('The baseline snapshot id (from list_backup_snapshots)'),
      snapshotB: z.string().describe('The snapshot id to compare against the baseline (from list_backup_snapshots)'),
    },
    async ({ destinationId, snapshotA, snapshotB }) => {
      return jsonResponse(await client.get('/api/backup/snapshots/diff', { destinationId, snapshotA, snapshotB }));
    }
  );

  registerTool(server, 'delete_backup_snapshot',
    {
      snapshotId: z.string().describe('Restic snapshot id to forget (from list_backup_snapshots). IRREVERSIBLE: runs restic forget --prune, permanently discarding this snapshot and any repository data it alone referenced. There is no undo.'),
      destinationId: z.number().describe('Destination holding the snapshot (from list_backup_destinations)'),
      environmentId: z.number().optional().describe('Optional environment id for an early enterprise access check; the server always re-resolves the snapshot\'s OWNING environment itself (from its own tag) before deleting, regardless of this value'),
    },
    async ({ snapshotId, destinationId, environmentId }) => {
      return jsonResponse(await client.delete(`/api/backup/snapshots/${encodePath(snapshotId)}`, {
        destinationId,
        env: environmentId,
      }));
    }
  );

  registerTool(server, 'browse_backup_snapshot',
    {
      snapshotId: z.string().describe('The restic snapshot id to browse (from list_backup_snapshots)'),
      destinationId: z.number().describe('Destination the snapshot lives in (from list_backup_destinations)'),
      path: z.string().optional().describe('Directory path inside the snapshot to list entries of (default: "/" when omitted)'),
      environmentId: z.number().optional().describe('Optional environment id for an early enterprise access check; the server always re-resolves the snapshot\'s OWNING environment itself before returning entries'),
    },
    async ({ snapshotId, destinationId, path, environmentId }) => {
      return jsonResponse(await client.get(`/api/backup/snapshots/${encodePath(snapshotId)}/browse`, {
        destinationId,
        path,
        env: environmentId,
      }));
    }
  );

  registerTool(server, 'dump_backup_snapshot_file',
    {
      snapshotId: z.string().describe('The restic snapshot id to dump a file/directory listing from (from list_backup_snapshots)'),
      destinationId: z.number().describe('Destination the snapshot lives in (from list_backup_destinations)'),
      path: z.string().describe('Path inside the snapshot to read (must resolve under /volumes or /metadata)'),
      type: z.enum(['directory']).optional().describe('Set to "directory" for a directory-listing preview instead of a single-file preview; omit for a file preview'),
    },
    async ({ snapshotId, destinationId, path, type }) => {
      return jsonResponse(await client.get(`/api/backup/snapshots/${encodePath(snapshotId)}/dump`, {
        destinationId,
        path,
        type,
      }));
    }
  );

  registerTool(server, 'download_backup_snapshot_file',
    {
      snapshotId: z.string().describe('The restic snapshot id to download a file/directory from (from list_backup_snapshots)'),
      destinationId: z.number().describe('Destination the snapshot lives in (from list_backup_destinations)'),
      path: z.string().describe('Path inside the snapshot to download (must resolve under /volumes or /metadata; a raw /metadata/metadata.json download is refused with 403 — use get_backup_snapshot_metadata instead)'),
      type: z.enum(['directory']).optional().describe('Set to "directory" to download the whole directory as a tar; omit to download a single file\'s raw bytes'),
    },
    async ({ snapshotId, destinationId, path, type }) => {
      const buffer = await client.getRaw(`/api/backup/snapshots/${encodePath(snapshotId)}/dump`, {
        destinationId,
        path,
        type,
        download: '1',
      });
      return textResponse(`base64:${buffer.toString('base64')}`);
    }
  );

  registerTool(server, 'get_backup_snapshot_metadata',
    {
      snapshotId: z.string().describe('The restic snapshot id to read metadata for (from list_backup_snapshots)'),
      destinationId: z.number().describe('Destination the snapshot lives in (from list_backup_destinations)'),
    },
    async ({ snapshotId, destinationId }) => {
      return jsonResponse(await client.get(`/api/backup/snapshots/${encodePath(snapshotId)}/metadata`, { destinationId }));
    }
  );

  registerTool(server, 'get_backup_instance_id',
    {},
    async () => {
      return jsonResponse(await client.get('/api/backup/instance'));
    }
  );
}
