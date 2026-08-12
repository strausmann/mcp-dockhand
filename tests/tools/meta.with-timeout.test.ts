/**
 * withTimeout() (src/tools/meta.ts) — generic promise-vs-timeout race extracted for
 * Fix round 1 (Finding 1 of the Task 9 review): bounds each per-environment
 * `POST /api/environments/{id}/test` probe in `self_check`'s `listEnvironments` wiring
 * so one hung environment cannot make `self_check` itself hang. Uses small real
 * timeouts (no fake-timer infrastructure exists elsewhere in this suite) — kept short
 * enough that the whole file runs in well under a second.
 */
import { describe, it, expect } from 'vitest';
import { withTimeout } from '../../src/tools/meta.js';

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function delayReject(error: Error, ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(error), ms));
}

describe('withTimeout', () => {
  it('resolves with the wrapped promise\'s value when it settles well before the timeout', async () => {
    await expect(withTimeout(delay('ok', 5), 200)).resolves.toBe('ok');
  });

  it('resolves synchronously-fulfilled promises (already-settled input)', async () => {
    await expect(withTimeout(Promise.resolve(42), 200)).resolves.toBe(42);
  });

  it('rejects with the wrapped promise\'s own error when it rejects before the timeout', async () => {
    await expect(withTimeout(delayReject(new Error('boom'), 5), 200)).rejects.toThrow('boom');
  });

  it('rejects with a timeout error when the wrapped promise never settles in time', async () => {
    // Never resolves/rejects within the test's lifetime — withTimeout must still win.
    const neverSettles = new Promise<string>(() => {});
    await expect(withTimeout(neverSettles, 10)).rejects.toThrow(/Timed out after 10ms/);
  });

  it('rejects with a timeout error when the wrapped promise settles AFTER the timeout', async () => {
    await expect(withTimeout(delay('too-late', 100), 10)).rejects.toThrow(/Timed out/);
  });
});
