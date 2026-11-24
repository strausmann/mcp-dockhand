/**
 * Operator-safety notes APPENDED to a tool's description — deliberately separate from
 * `TOOL_DESCRIPTION_OVERRIDES` (description-overrides.ts), which REPLACES the derived text.
 *
 * Why a third mechanism rather than more overrides: the spec-derived description answers
 * "what does this endpoint do", and it should keep answering that — it is generated from
 * Dockhand's own annotations and stays correct as they evolve. What it cannot express is a
 * caller-side operating rule of OUR making. Replacing the derived text to bolt one on would
 * throw away the accurate half to add the missing half, and would silently go stale the
 * moment upstream reworded the operation (exactly what happened to two summaries in 1.0.42).
 * Appending keeps both.
 *
 * The bar for an entry here is deliberately high. A suffix is warranted only when calling
 * the tool the obvious way has a consequence a caller cannot see from the endpoint's own
 * description. "This is destructive" does not qualify — `delete_stack` says so itself, and
 * every MCP client already gates writes. What qualifies falls into three categories:
 *
 *   1. Arguments that carry credentials — they land in the tool-call arguments and from
 *      there in transcripts and logs, invisible at the call site and irreversible after.
 *   2. A response that returns secrets where the endpoint's own summary reads as safe
 *      (e.g. BACKUP_DESTINATION_RETURNS_DECRYPTED_CREDS, BACKUP_SNAPSHOT_DUMP_MAY_EXPOSE_VOLUME_SECRETS).
 *   3. A destructive branch hidden inside one enum value of a generically-named tool, which
 *      the summary doesn't single out (e.g. BACKUP_DESTINATION_TASK_DESTRUCTIVE's prune/repair
 *      action, RESTORE_IN_PLACE_DESTRUCTIVE).
 */

/**
 * The provider `config` object holds the credentials Dockhand uses to reach the secret
 * manager — a Vault token, an Infisical machine identity, a Doppler service token, a
 * 1Password Connect token. Dockhand itself is careful with them: summaries never include the
 * decrypted config, and the detail endpoint strips it before responding. The REQUEST,
 * however, carries it in the clear, so anything passed through these tools is written into
 * the tool-call arguments.
 */
const CONFIG_CARRIES_CREDENTIALS =
  'SECURITY: the `config` object holds this provider\'s credentials (Vault token, Infisical ' +
  'machine identity, Doppler service token, 1Password Connect token). Unlike the responses — ' +
  'which Dockhand redacts — arguments you pass here are recorded in the tool call itself, and ' +
  'therefore in transcripts and logs. Before calling this, ask the operator explicitly whether ' +
  'to proceed and whether they would rather do it in the Dockhand UI. If they say go ahead, go ' +
  'ahead — this is a supported administrative operation, not a forbidden one.';

/**
 * `get_stack_env_raw` returns the .env file verbatim. For stacks that keep credentials there
 * — which is the norm for internal and adopted stacks — that means the response carries them
 * in the clear, unlike `get_stack_env`, which masks anything stored as a secret. The endpoint
 * description says "raw", not "contains secrets", and the difference is invisible until the
 * values are already in the transcript.
 */
const RETURNS_THE_FILE_VERBATIM =
  'SECURITY: this returns the .env file exactly as it is on disk, including any credentials ' +
  'it contains — nothing is masked. Prefer get_stack_env, which masks stored secrets, unless ' +
  'you specifically need the file itself. If you only need to know WHICH keys exist, say so ' +
  'and read the key names rather than printing the response.';

/**
 * `exec_container` does not execute anything the caller can name, and its result cannot be
 * read back over REST. Verified against the 1.0.42 handler: the exec instance is created with
 * `cmd: [shell]` — the shell and nothing else, there is no command parameter — and the
 * response is an exec id plus Docker connection coordinates so a browser terminal can attach
 * to the daemon directly. The stream never passes through Dockhand's HTTP API, and no other
 * upstream endpoint runs a command and returns its output (`createExec` has exactly two
 * call sites there).
 *
 * The endpoint's own summary does say "return its ID plus the Docker connection info for a
 * terminal WebSocket", but a tool named exec_container invites the attempt anyway — so the
 * dead end is stated outright, along with what to reach for instead. Reported as #195 by a
 * user who went looking for the output and found none.
 */
const EXEC_RETURNS_NO_OUTPUT =
  'IMPORTANT: this does NOT run a command and cannot return output. It only opens an ' +
  'interactive shell session for a client that can attach a terminal — there is no command ' +
  'parameter, and the stream does not travel over the REST API, so no follow-up call can ' +
  'retrieve results. Do not retry expecting output. For what a container already produced use ' +
  'get_container_logs; for state on disk use list_container_files and ' +
  'get_container_file_content; for running processes use get_container_top.';

/**
 * `create_backup_destination`, `update_backup_destination` and
 * `test_backup_destination_inline` (Finsys/dockhand v1.0.46,
 * src/routes/api/backup/destinations/{+server.ts,[id]/+server.ts,test/+server.ts}) all
 * accept the restic repository `password` and cloud-credential `envVars` (AWS/Azure/GCS
 * keys) directly in the request body — the same "arguments carry credentials" situation
 * as CONFIG_CARRIES_CREDENTIALS above, just for a different resource.
 */
const BACKUP_DESTINATION_BODY_CREDENTIALS =
  'SECURITY: `password` and `envVars` here are restic repository and cloud-storage ' +
  'credentials. Unlike the responses — which strip the password and only echo envVars ' +
  'back to a caller who just supplied them — arguments you pass here are recorded in the ' +
  'tool call itself, and therefore in transcripts and logs. Before calling this, ask the ' +
  'operator explicitly whether to proceed and whether they would rather do it in the ' +
  'Dockhand UI. If they say go ahead, go ahead — this is a supported administrative ' +
  'operation, not a forbidden one.';

/**
 * `rotate_backup_destination_key` (src/routes/api/backup/destinations/[id]/rotate-key/
 * +server.ts) takes `currentPassword`/`newPassword` in the body — same credentials-in-
 * arguments situation as BACKUP_DESTINATION_BODY_CREDENTIALS, called out separately
 * because the field names differ and a reader scanning for "password"/"envVars" would
 * otherwise miss it.
 */
const BACKUP_DESTINATION_ROTATE_PASSWORDS =
  'SECURITY: `currentPassword` and `newPassword` are restic repository passwords. Unlike ' +
  'the response — which never echoes either value — arguments you pass here are recorded ' +
  'in the tool call itself, and therefore in transcripts and logs. Before calling this, ' +
  'ask the operator explicitly whether to proceed and whether they would rather do it in ' +
  'the Dockhand UI. If they say go ahead, go ahead — this is a supported administrative ' +
  'operation, not a forbidden one.';

/**
 * `get_backup_destination` (src/routes/api/backup/destinations/[id]/+server.ts) returns
 * `envVars` DECRYPTED — in the clear — to any caller who can manage backups, precisely so
 * the Dockhand edit form can pre-fill cloud-credential fields. The LIST endpoint
 * (list_backup_destinations) never includes envVars at all; only this single-destination
 * GET does, and the endpoint's own summary phrases that as a feature ("decrypted
 * cloud-credential env vars are only included for callers who can manage backups"), not a
 * warning — indistinguishable, on a skim, from "safe to print".
 */
const BACKUP_DESTINATION_RETURNS_DECRYPTED_CREDS =
  'SECURITY: the response includes `envVars` DECRYPTED — cloud-storage credentials in the ' +
  'clear (AWS/Azure/GCS keys etc.), if any are set on this destination. list_backup_destinations ' +
  'never returns them; only this single-destination call does. Do not print or log the ' +
  'response verbatim — if you only need to know whether credentials are configured, check ' +
  'for the presence of the envVars keys rather than their values.';

/**
 * `run_backup_destination_task` (src/routes/api/backup/destinations/[id]/task/+server.ts)
 * takes a `task` enum where three of six values are destructive against the destination's
 * restic repository: `prune` permanently discards unreferenced data, `repair-index` and
 * `repair-snapshots` rewrite repository metadata. Unlike `delete_stack` (whose NAME already
 * says what it does, the reason "this is destructive" alone does not otherwise qualify for
 * a suffix per the module doc-comment above), a generically-named `run_backup_destination_task`
 * call hides the destructive branch inside one enum value among six — the tool name gives no
 * hint, and the endpoint's own summary lists all six task names without singling any out. The
 * repository is also shared across every backup config/environment that uses this destination,
 * so the blast radius is not scoped to whichever caller ran it.
 */
const BACKUP_DESTINATION_TASK_DESTRUCTIVE =
  'WARNING: task="prune" permanently discards unreferenced data, and task="repair-index"/' +
  '"repair-snapshots" rewrite the repository\'s metadata — all three act on the destination\'s ' +
  'single shared restic repository, affecting every backup config/environment that uses it, ' +
  'not just the caller. "unlock", "check" and "stats" are read-only/non-destructive. Before ' +
  'running prune or a repair task, ask the operator explicitly whether to proceed.';

/**
 * `run_backup_restore` (src/routes/api/backup/restore/+server.ts, src/tools/backup-restore.ts)
 * takes a `mode` enum where one of two values, `mode:"in-place"`, OVERWRITES the live
 * containers/volumes of the target — irreversibly. Same rationale as
 * BACKUP_DESTINATION_TASK_DESTRUCTIVE just above: a generically-named tool hides the
 * destructive branch inside one enum value, and the endpoint's OpenAPI `summary` field
 * (the only part deriveToolDescription() surfaces — see derive-description.ts) says only
 * "Restore a backup snapshot in-place or to a new location, streaming progress as a
 * Server-Sent Events job", never singling out which of the two modes is destructive. The
 * actual warning sentence ("An in-place restore is destructive and requires
 * confirmOverwrite:true") lives in the operation's `description` prose instead, which
 * deriveToolDescription() deliberately never surfaces (only curated cross-refs extracted
 * from it) — so without this suffix the derived text would carry no warning at all.
 */
const RESTORE_IN_PLACE_DESTRUCTIVE =
  'WARNING: mode="in-place" OVERWRITES the live containers/volumes of the target and is ' +
  'IRREVERSIBLE — the server rejects it without confirmOverwrite:true. mode="new-location" ' +
  '(the default when mode is omitted) restores into a separate path/volume and touches ' +
  'nothing live; it does not need confirmOverwrite. Before calling this with ' +
  'mode="in-place", ask the operator explicitly whether to proceed.';

/**
 * `dump_backup_snapshot_file` (src/routes/api/backup/snapshots/[id]/dump/+server.ts,
 * inline-preview-only wrapper, src/tools/backup-snapshots.ts) reads a file's content
 * straight out of a restic snapshot. Anything under `/volumes/*` is the backed-up
 * application's own data, byte-for-byte — the endpoint applies NO redaction there,
 * unlike `/metadata/metadata.json`, which the same handler always returns through a
 * redacting layout parser instead of raw. A caller who only holds `backups:view` (a
 * read-only-sounding permission) can therefore pull real secrets — passwords, API keys,
 * private keys, credentialed config files — out of any backed-up volume this way.
 */
const BACKUP_SNAPSHOT_DUMP_MAY_EXPOSE_VOLUME_SECRETS =
  'This tool returns only the inline/redacted preview — it never sets the endpoint\'s raw ' +
  '`download=1` tar/byte-stream flag. For the raw binary tar/byte-stream variant of this ' +
  'same endpoint, use download_backup_snapshot_file instead. SECURITY: dumping a path under ' +
  '/volumes/* returns that backed-up file\'s content completely unredacted — backed-up ' +
  'application data can contain real secrets (passwords, API keys, private keys, ' +
  'credentialed config files) that will appear verbatim in the response. Do not log or ' +
  'print the dumped content. The one path this endpoint DOES redact is ' +
  '/metadata/metadata.json (returned as a parsed, redacted layout, never the raw file) — for ' +
  'a snapshot\'s full metadata layout, prefer get_backup_snapshot_metadata instead.';

/**
 * `download_backup_snapshot_file` (same endpoint as dump_backup_snapshot_file above, but
 * with `download=1` set — src/tools/backup-snapshots.ts, #247) returns the RAW binary
 * tar/byte stream (base64-framed), not a redacted or inline preview. Everything the
 * suffix above warns about for /volumes/* applies here too, plus the content is now the
 * actual unredacted bytes rather than a text preview.
 */
const BACKUP_SNAPSHOT_DOWNLOAD_RETURNS_RAW_BYTES =
  'Returns the raw file/directory content as base64-encoded bytes (prefixed "base64:"), ' +
  'not a preview. SECURITY: a path under /volumes/* is the backed-up application\'s own ' +
  'data, byte-for-byte and completely unredacted — it can contain real secrets (passwords, ' +
  'API keys, private keys, credentialed config files). Do not log or print the returned ' +
  'content. A raw /metadata/metadata.json download is refused by the server with 403 (it ' +
  'would bypass redaction) — use get_backup_snapshot_metadata for that path instead. For a ' +
  'redacted/inline text preview instead of raw bytes, use dump_backup_snapshot_file.';

const DEPLOY_LOG_MAY_CONTAIN_SECRETS =
  ' SECURITY: a deploy log is the raw captured output of `docker compose` and the stack\'s own ' +
  'startup, so it can contain secrets that were printed to stdout/stderr and therefore survived ' +
  'Dockhand redaction (environment dumps, connection strings, tokens echoed by an entrypoint). ' +
  'The returned text lands in the tool call itself, and therefore in transcripts and logs. Treat ' +
  'it as potentially secret-bearing and do not quote it wholesale.';

/**
 * Endpoints that read only the session cookie (`validateSession(cookies)`) or refuse
 * bearer auth on purpose (auth/tokens POST, auth/tokens/[id] DELETE), Finsys/dockhand
 * v1.0.54. With DOCKHAND_API_TOKEN they fail or answer as if nobody were signed in,
 * which the endpoint's own summary gives no hint of.
 */
const SESSION_COOKIE_ONLY =
  'Needs the username/password session: with DOCKHAND_API_TOKEN this endpoint does not ' +
  'see the token and fails (401/403) or answers as if no user were signed in.';

/**
 * settings/navigation (Finsys/dockhand v1.0.54): the global scope (the default) goes
 * through the bearer-aware authorize(); only the per-user part reads validateSession().
 */
const NAVIGATION_USER_SCOPE_SESSION_ONLY =
  'With DOCKHAND_API_TOKEN only the global scope (the default) works: per-user preferences ' +
  'need the username/password session, so a read returns `user: null` and an update with ' +
  'scope "user" fails with 401.';

/**
 * GET /api/jobs/{id} (Finsys/dockhand v1.0.54, src/lib/server/jobs.ts): `lines` is the
 * job's raw output, the same `docker compose` output as a deploy log, and the whole array
 * comes back on every poll. The store is an in-memory Map: a finished job is swept 10
 * minutes after its last update, and a Dockhand restart drops all of them, so a 404 is
 * expected rather than an error.
 */
const JOB_LINES_CUMULATIVE_AND_SECRET_BEARING =
  'Every poll returns ALL lines produced so far, not just new ones, so poll sparingly and only ' +
  'read past what you already saw; `result` stays null until the job finishes. A finished job ' +
  'is deleted 10 minutes after its last update, and a Dockhand restart drops every job: a 404 ' +
  'then means "gone", not "failed" — check the resource itself (e.g. list_stacks) instead.' +
  DEPLOY_LOG_MAY_CONTAIN_SECRETS;

/**
 * DELETE /api/jobs/{id} only sets `cancelRequested` (jobs.ts cancelJob); an operation has to
 * poll it to stop. In v1.0.54 the only one that does is vulnerabilities/scan-all, and the MCP
 * runs that synchronously, so no job the MCP hands out (deploys, restarts, batch updates)
 * actually stops.
 */
const JOB_CANCEL_IS_COOPERATIVE =
  'IMPORTANT: cancellation is cooperative. This only flags the job; it stops only if the ' +
  'operation checks the flag, and as of Dockhand 1.0.54 deploys, restarts and other stack ' +
  'operations never do. `cancelled: true` means the flag was set, NOT that the work stopped — ' +
  'follow up with get_job and check the resource before assuming nothing changed.';

const EXPORT_IMAGE_RETURNS_BASE64_TAR =
  ' Returns the image as a base64-encoded tar archive (prefixed "base64:"), NOT JSON — ' +
  'decode the part after "base64:" to bytes and write a .tar that `docker load` accepts. ' +
  'The archive is the full image (all layers); handle it as opaque binary, do not log or ' +
  'print it.';

const EXPORT_VOLUME_RETURNS_BASE64_TAR =
  ' Returns the volume contents as a base64-encoded tar archive (prefixed "base64:"), NOT ' +
  'JSON — decode the part after "base64:" to a .tar. SECURITY: this is the volume data ' +
  'byte-for-byte and completely unredacted; it can contain real secrets (passwords, keys, ' +
  'credentialed config). Do not log or print the returned content.';

/**
 * get_git_webhook (Issue #317): the name says "get", but GET /api/git/webhook/{id} is the
 * manual webhook TRIGGER for a git repository (Finsys/dockhand v1.0.59,
 * src/routes/api/git/webhook/[id]/+server.ts GET) — it deploys on a matching secret and
 * writes an audit row otherwise (deployFromRepository() in src/lib/server/git.ts deploys one
 * stack named after the repository). The spec-derived first line already says "trigger";
 * this suffix makes the consequence and the deprecation explicit.
 */
const GIT_REPOSITORY_WEBHOOK_IS_A_TRIGGER =
  'To READ whether a webhook and a secret are configured, use `get_git_repository` ' +
  '(`webhookEnabled`, `hasWebhookSecret`) — not this tool. Deprecated name: this does not read ' +
  'anything, it fires the repository webhook. On a matching `secret` (or with no secret ' +
  'configured and ALLOW_WEBHOOKS_WITHOUT_SECRET=true) it syncs the repository and deploys its ' +
  'compose file as a stack named after the repository; otherwise it is rejected (401) and an ' +
  'audit entry is written. Scheduled to be renamed in the next major release.';

/**
 * detach_git_stack (#340): the endpoint's summary ("Convert a git-managed stack to a local
 * stack") reads like a flag flip, but the handler (Finsys/dockhand v1.0.59,
 * src/routes/api/git/stacks/[id]/detach/+server.ts) deletes the git stack row, unregisters
 * its sync schedule and deletes its repository checkout — the auto-update, webhook and
 * repository link are gone and only attach_stack_to_git brings them back.
 */
const DETACH_DELETES_GIT_STACK =
  'Deletes the git stack record, its scheduled sync and its repository checkout (the clone under ' +
  'the git repos dir, not the deployed stack dir): auto-update, the webhook and its secret, the ' +
  'branch override and the repository compose/env paths are gone afterwards, and ' +
  'attach_stack_to_git does not restore them. The repository entry, the deployed compose file, ' +
  'the running containers and the stack\'s secret variables stay; the effective non-secret ' +
  'variables are written to the deployed .env when there are any. Needs a compose file from an ' +
  'earlier deploy on disk (409 otherwise).';

/**
 * attach_stack_to_git (#340, security audit run 9): the summary ("Convert an internal stack to
 * Git management") does not say that from then on the REPOSITORY's compose file is what gets
 * deployed (Finsys/dockhand v1.0.59, src/routes/api/stacks/[name]/attach/+server.ts flips the
 * stack source to git) — with deployNow right away, otherwise on the next auto-update, webhook
 * or deploy. A wrong repository or branch replaces the running stack.
 */
const ATTACH_REPLACES_COMPOSE_ON_NEXT_DEPLOY =
  'From then on the stack is deployed from the repository: with deployNow right away, otherwise ' +
  'on the next deploy, auto-update run or webhook, and that deploy replaces the running compose ' +
  'file with the repository\'s. Check repository, branch and composePath first. Only a local ' +
  '(internal) stack converts; use detach_git_stack to go back.';


export const TOOL_DESCRIPTION_SUFFIXES: Readonly<Record<string, string>> = {
  detach_git_stack: DETACH_DELETES_GIT_STACK,
  attach_stack_to_git: ATTACH_REPLACES_COMPOSE_ON_NEXT_DEPLOY,
  get_git_webhook: GIT_REPOSITORY_WEBHOOK_IS_A_TRIGGER,
  exec_container: EXEC_RETURNS_NO_OUTPUT,
  get_stack_env_raw: RETURNS_THE_FILE_VERBATIM,
  create_secret_provider: CONFIG_CARRIES_CREDENTIALS,
  update_secret_provider: CONFIG_CARRIES_CREDENTIALS,
  test_secret_provider: CONFIG_CARRIES_CREDENTIALS,
  test_secret_provider_config: CONFIG_CARRIES_CREDENTIALS,
  create_backup_destination: BACKUP_DESTINATION_BODY_CREDENTIALS,
  update_backup_destination: BACKUP_DESTINATION_BODY_CREDENTIALS,
  test_backup_destination_inline: BACKUP_DESTINATION_BODY_CREDENTIALS,
  rotate_backup_destination_key: BACKUP_DESTINATION_ROTATE_PASSWORDS,
  get_backup_destination: BACKUP_DESTINATION_RETURNS_DECRYPTED_CREDS,
  run_backup_destination_task: BACKUP_DESTINATION_TASK_DESTRUCTIVE,
  run_backup_restore: RESTORE_IN_PLACE_DESTRUCTIVE,
  dump_backup_snapshot_file: BACKUP_SNAPSHOT_DUMP_MAY_EXPOSE_VOLUME_SECRETS,
  download_backup_snapshot_file: BACKUP_SNAPSHOT_DOWNLOAD_RETURNS_RAW_BYTES,
  get_stack_deploy_log: DEPLOY_LOG_MAY_CONTAIN_SECRETS,
  get_auth_session: SESSION_COOKIE_ONLY,
  get_profile: SESSION_COOKIE_ONLY,
  update_profile: SESSION_COOKIE_ONLY,
  get_profile_preferences: SESSION_COOKIE_ONLY,
  update_profile_preferences: SESSION_COOKIE_ONLY,
  add_user_role: SESSION_COOKIE_ONLY,
  remove_user_role: SESSION_COOKIE_ONLY,
  clear_user_roles: SESSION_COOKIE_ONLY,
  enable_user_mfa: SESSION_COOKIE_ONLY,
  disable_user_mfa: SESSION_COOKIE_ONLY,
  test_oidc_provider: SESSION_COOKIE_ONLY,
  create_auth_token: SESSION_COOKIE_ONLY,
  revoke_auth_token: SESSION_COOKIE_ONLY,
  get_navigation_settings: NAVIGATION_USER_SCOPE_SESSION_ONLY,
  update_navigation_settings: NAVIGATION_USER_SCOPE_SESSION_ONLY,
  get_job: JOB_LINES_CUMULATIVE_AND_SECRET_BEARING,
  cancel_job: JOB_CANCEL_IS_COOPERATIVE,
  export_image: EXPORT_IMAGE_RETURNS_BASE64_TAR,
  export_volume: EXPORT_VOLUME_RETURNS_BASE64_TAR,
};
