/**
 * Carries the correlation identifiers through the call without threading them
 * through every signature.
 *
 * The alternative — adding a context parameter to DockhandClient.get/post/put/delete
 * and to every tool callback — would touch every tool in the tree and would still be
 * forgotten in the next one. AsyncLocalStorage keeps the plumbing in one file.
 *
 * The store is mutable per run so that a tool can add its own identifiers to the
 * request-level context that already exists, without the caller having to know which
 * fields a deeper layer will want.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from './logger.js';
import type { Logger } from 'pino';

export interface LogContext {
  /** MCP session, from the mcp-session-id header. Spans many requests. */
  sid?: string;
  /** One HTTP request to this server. */
  req?: string;
  /** One tool invocation. Usually one per request, but a JSON-RPC batch can carry several. */
  call?: string;
  /** Name of the tool being invoked. */
  tool?: string;
  /** OpenAPI path template of the Dockhand endpoint — never a concrete path. */
  route?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/**
 * Isolation is a module invariant, not a call-site convention: the given `context` is
 * copied into a private store, and that copy — never the caller's own object — is what
 * ends up in AsyncLocalStorage and gets handed to the callback. A caller can mutate its
 * original object after the run has started, or reuse one object literal across two
 * runs, without either reaching the store (tests/log-context.test.ts, describe block
 * "isolation from the caller").
 *
 * The callback receives the store as its argument for exactly one reason: a later
 * extendLogContext() (e.g. backfilling a session id once the MCP handshake produces
 * one) needs to be visible to whoever opened the context, and the store is a private
 * copy that only this function and extendLogContext() ever see through
 * AsyncLocalStorage — the caller has no other way to reach it. The access-log
 * middleware relies on this: it learns the session id only after the handshake has
 * run, and writes its line later still, from a res.on('finish') listener that has no
 * reliable context of its own, so it holds the `store` argument across the callback and
 * reads it back at emit time. Holding the object is deterministic; reaching back into
 * AsyncLocalStorage from an event listener would work by accident at best.
 */
export function runWithLogContext<T>(context: LogContext, fn: (store: LogContext) => T): T {
  const store = { ...context };
  return storage.run(store, () => fn(store));
}

export function extendLogContext(patch: Partial<LogContext>): void {
  const store = storage.getStore();
  if (!store) return;
  Object.assign(store, patch);
}

export function currentLogContext(): LogContext {
  return { ...(storage.getStore() ?? {}) };
}

/** The logger, bound to whatever context the current call is running in. */
export function log(): Logger {
  const context = storage.getStore();
  if (!context) return logger;
  return logger.child(context);
}
