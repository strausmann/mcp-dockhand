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

  // The access-log middleware holds the object it opened the context with and reads it
  // back when the response finishes, because that is the only deterministic way for it
  // to learn a session id that did not exist when the request arrived. That works only
  // if the store IS the given object rather than a copy of it — with a copy the
  // backfill lands somewhere the caller can never see, and the access line silently
  // keeps saying sid=-.
  it('makes a backfill visible to whoever opened the context', () => {
    const context = { req: 'r1' };

    runWithLogContext(context, () => {
      extendLogContext({ sid: 's-created-later' });
    });

    expect(context).toEqual({ req: 'r1', sid: 's-created-later' });
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
      let boundLogger;

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
      let boundLogger;

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
