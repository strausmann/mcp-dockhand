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

export const TOOL_DESCRIPTION_SUFFIXES: Readonly<Record<string, string>> = {
  create_secret_provider: CONFIG_CARRIES_CREDENTIALS,
  update_secret_provider: CONFIG_CARRIES_CREDENTIALS,
  test_secret_provider: CONFIG_CARRIES_CREDENTIALS,
  test_secret_provider_config: CONFIG_CARRIES_CREDENTIALS,
};
