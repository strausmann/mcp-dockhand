/**
 * The logger is the one place LOG_LEVEL becomes real. Issue #116 shipped a README
 * row for it while nothing in the code ever read the variable.
 */
import { describe, it, expect } from 'vitest';
import { resolveLogLevel } from '../src/utils/logger.js';

describe('resolveLogLevel', () => {
  it('accepts the four supported levels', () => {
    for (const level of ['error', 'warn', 'info', 'debug'] as const) {
      expect(resolveLogLevel(level)).toEqual({ level });
    }
  });

  it('defaults to info when unset', () => {
    expect(resolveLogLevel(undefined)).toEqual({ level: 'info' });
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(resolveLogLevel('  DEBUG ')).toEqual({ level: 'debug' });
  });

  it('falls back to info with a warning instead of exiting', () => {
    // A typo in a compose file must never stop the server from starting.
    const result = resolveLogLevel('lound');
    expect(result.level).toBe('info');
    expect(result.warning).toMatch(/lound/);
    expect(result.warning).toMatch(/error, warn, info, debug/);
  });

  it('rejects silent', () => {
    // Deliberate: the #116 fix depends on the login failure line ALWAYS being
    // emitted. A silent level would make that guarantee defeasible again.
    const result = resolveLogLevel('silent');
    expect(result.level).toBe('info');
    expect(result.warning).toMatch(/silent/);
  });
});
