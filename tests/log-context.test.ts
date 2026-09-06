/**
 * Correlation only works if two calls in flight at the same time cannot see each
 * other's identifiers. That is the whole reason for AsyncLocalStorage over a module
 * variable, so it is the thing worth testing.
 */
import { describe, it, expect } from 'vitest';
import {
  runWithLogContext,
  extendLogContext,
  currentLogContext,
  log,
} from '../src/utils/log-context.js';
import type { LogContext } from '../src/utils/log-context.js';
import { logger } from '../src/utils/logger.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('log context', () => {
  it('is empty outside any request', () => {
    expect(currentLogContext()).toEqual({});
  });

  it('exposes what was put in', () => {
    runWithLogContext({ req: 'r1', sid: 's1' }, () => {
      expect(currentLogContext()).toEqual({ req: 'r1', sid: 's1' });
    });
  });

  it('extends without losing what was already there', () => {
    runWithLogContext({ req: 'r1' }, () => {
      extendLogContext({ call: 'c1', tool: 'list_stacks' });
      expect(currentLogContext()).toEqual({ req: 'r1', call: 'c1', tool: 'list_stacks' });
    });
  });

  it('keeps two concurrent calls apart across await points', async () => {
    const seen: string[] = [];

    const one = runWithLogContext({ req: 'r1' }, async () => {
      await tick();
      extendLogContext({ call: 'c1' });
      await tick();
      seen.push(`${currentLogContext().req}/${currentLogContext().call}`);
    });

    const two = runWithLogContext({ req: 'r2' }, async () => {
      extendLogContext({ call: 'c2' });
      await tick();
      seen.push(`${currentLogContext().req}/${currentLogContext().call}`);
    });

    await Promise.all([one, two]);

    expect(seen.sort()).toEqual(['r1/c1', 'r2/c2']);
  });

  // The access-log middleware needs to see a backfill (extendLogContext, called once
  // the MCP handshake produces a session id) after the run has started. It gets that
  // by holding the STORE the callback receives — never the caller's own literal, which
  // the module never mutates. This is the module's half of the contract; the
  // middleware's half (holding `store`, not the literal it passed in) is exercised
  // end-to-end by tests/founding-session-correlation.test.ts.
  it('hands the callback the live store, and a backfill through it is visible there', () => {
    const context = { req: 'r1' };
    let capturedStore: LogContext | undefined;

    runWithLogContext(context, (store) => {
      capturedStore = store;
      extendLogContext({ sid: 's-created-later' });
    });

    expect(capturedStore).toEqual({ req: 'r1', sid: 's-created-later' });
    // The caller's own literal is never touched — only the copy the module made from it.
    expect(context).toEqual({ req: 'r1' });
  });

  // Isolation is a module invariant, not a call-site convention: a caller mutating the
  // object it passed in, or reusing one object literal across two runs, must never
  // reach the store. Both of the following were possible with `storage.run(context, fn)`
  // (the store WAS the caller's object) and are the reason this function now makes its
  // own copy and hands that copy to the callback instead.
  describe('isolation from the caller (module invariant)', () => {
    it('does not let a mutation of the original object after the run has started reach the store', async () => {
      const original: LogContext = { req: 'r1' };
      const seenReq: (string | undefined)[] = [];

      const running = runWithLogContext(original, async () => {
        // Yield once so the mutation below runs while this call is in flight —
        // i.e. genuinely "after the run has started", not before it.
        await tick();
        seenReq.push(currentLogContext().req);
      });

      // External mutation of the ORIGINAL object, after runWithLogContext has already
      // captured its copy.
      original.req = 'mutated-from-outside';

      await running;

      expect(seenReq).toEqual(['r1']);
    });

    it('does not let one object literal reused across two runs cross-contaminate', () => {
      const shared: LogContext = { req: 'r1' };
      let seenInB: LogContext | undefined;

      // Run A extends the store it was handed.
      runWithLogContext(shared, () => {
        extendLogContext({ call: 'from-A' });
      });

      // Run B reuses the SAME object literal. It must start clean, not inherit A's
      // extension merely because both runs began from the same reference.
      runWithLogContext(shared, () => {
        seenInB = currentLogContext();
      });

      expect(seenInB).toEqual({ req: 'r1' });
    });
  });

  it('does not leak a nested extension back into the outer context', () => {
    runWithLogContext({ req: 'outer' }, () => {
      runWithLogContext({ req: 'inner' }, () => {
        extendLogContext({ call: 'nested' });
      });
      expect(currentLogContext()).toEqual({ req: 'outer' });
    });
  });

  describe('log()', () => {
    it('returns the base logger outside any context', () => {
      const returnedLogger = log();
      expect(returnedLogger).toBe(logger);
      expect(currentLogContext()).toEqual({});
    });

    it('binds context fields to the child logger', () => {
      let boundLogger!: ReturnType<typeof log>;

      runWithLogContext({ req: 'r1', sid: 's1', call: 'c1' }, () => {
        boundLogger = log();
      });

      // Outside context, log() returns the base logger
      const unboundLogger = log();
      expect(unboundLogger).toBe(logger);

      // Inside context, log() returns a child logger with bindings
      expect(boundLogger).not.toBe(logger);

      // Pino stores bindings in the child logger
      const bindings = boundLogger.bindings?.();
      expect(bindings).toBeDefined();
      expect(bindings?.req).toBe('r1');
      expect(bindings?.sid).toBe('s1');
      expect(bindings?.call).toBe('c1');
    });

    it('binds extended context fields to the child logger', () => {
      let boundLogger!: ReturnType<typeof log>;

      runWithLogContext({ req: 'r1' }, () => {
        extendLogContext({ call: 'c1', tool: 'list_stacks' });
        boundLogger = log();
      });

      // Pino stores bindings in the child logger
      const bindings = boundLogger.bindings?.();
      expect(bindings?.req).toBe('r1');
      expect(bindings?.call).toBe('c1');
      expect(bindings?.tool).toBe('list_stacks');
    });
  });

  describe('extendLogContext()', () => {
    it('does not throw when called outside any context', () => {
      expect(() => {
        extendLogContext({ call: 'c1' });
      }).not.toThrow();
    });

    it('leaves currentLogContext empty when called outside any context', () => {
      extendLogContext({ call: 'c1', tool: 'list_stacks' });
      expect(currentLogContext()).toEqual({});
    });
  });
});
