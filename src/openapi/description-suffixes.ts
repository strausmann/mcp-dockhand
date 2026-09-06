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
 * every MCP client already gates writes. What qualifies so far is exactly one thing:
 * arguments that carry credentials, because those land in the tool-call arguments and from
 * there in transcripts and logs, which is invisible at the call site and irreversible after.
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
  '`download=1` tar/byte-stream flag (a separate, not-yet-wrapped follow-up). SECURITY: ' +
  'dumping a path under /volumes/* returns that backed-up file\'s content completely ' +
  'unredacted — backed-up application data can contain real secrets (passwords, API keys, ' +
  'private keys, credentialed config files) that will appear verbatim in the response. Do ' +
  'not log or print the dumped content. The one path this endpoint DOES redact is ' +
  '/metadata/metadata.json (returned as a parsed, redacted layout, never the raw file) — for ' +
  'a snapshot\'s full metadata layout, prefer get_backup_snapshot_metadata instead.';

export const TOOL_DESCRIPTION_SUFFIXES: Readonly<Record<string, string>> = {
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
  dump_backup_snapshot_file: BACKUP_SNAPSHOT_DUMP_MAY_EXPOSE_VOLUME_SECRETS,
};
