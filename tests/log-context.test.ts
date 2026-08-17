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
});
