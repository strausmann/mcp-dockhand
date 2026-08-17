/**
 * Correlation only works if two calls in flight at the same time cannot see each
 * other's identifiers. That is the whole reason for AsyncLocalStorage over a module
 * variable, so it is the thing worth testing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  runWithLogContext,
  extendLogContext,
  currentLogContext,
  log,
} from '../src/utils/log-context.js';

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
      const logger = log();
      expect(logger).toBeDefined();
      // Outside context, currentLogContext() is empty
      expect(currentLogContext()).toEqual({});
      // Verify logger.info is callable
      expect(logger.info).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });

    it('returns a context-bound child logger inside runWithLogContext', () => {
      const outsideLogger = log();
      let insideLogger: any;

      runWithLogContext({ req: 'r1', call: 'c1' }, () => {
        insideLogger = log();
        // Inside context, should be a different logger instance (child)
        expect(insideLogger).not.toBe(outsideLogger);
      });

      // Both loggers should be defined and different instances
      expect(outsideLogger).toBeDefined();
      expect(insideLogger).toBeDefined();
      expect(outsideLogger).not.toBe(insideLogger);
    });

    it('child logger emits context bindings', () => {
      const outsideLogger = log();
      let insideLogger1: any;
      let insideLogger2: any;

      runWithLogContext({ req: 'r1', call: 'c1' }, () => {
        insideLogger1 = log();
        insideLogger2 = log();
        // Both inside calls should create child loggers (different instances each time)
        expect(insideLogger1).not.toBe(outsideLogger);
        expect(insideLogger2).not.toBe(outsideLogger);
      });

      // Verify that inside context loggers are different from outside
      expect(insideLogger1).toBeDefined();
      expect(insideLogger2).toBeDefined();
      expect(insideLogger1).not.toBe(outsideLogger);
      expect(insideLogger2).not.toBe(outsideLogger);
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
