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

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run({ ...context }, fn);
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
