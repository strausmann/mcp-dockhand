/**
 * Issue #212: this file pins the pino default-serializer trap that let three call
 * sites (DockhandClient, SessionManager, meta.ts's loggedProbe) silently log
 * `"err":{"type":"Object", ...}` instead of the exception name.
 *
 * pino applies its `err` serializer (pino.stdSerializers.err) to the `err` key by
 * default, with no opt-in required (see src/utils/logger.ts — no `serializers` option
 * is configured, yet the mangling still happens). That serializer treats ANY object
 * carrying a `message` key as error-like and overwrites `type` with the object's
 * *constructor* name, not the value that was put there. A plain object's constructor
 * is `Object`, so `err: { type: 'ToolError', message: 'x' }` reaches the log as
 * `"err":{"type":"Object","message":"x","stack":""}` — the label never arrives.
 *
 * The flat shape (`errType` as a sibling field, never nested under `err`) sidesteps
 * the serializer entirely: pino only special-cases the `err` key.
 *
 * These two tests run through the REAL logger singleton (src/utils/logger.ts), not a
 * hand-rolled pino instance, so a future change to the logger's options (e.g. adding
 * a custom `err` serializer) is covered by the same assertions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { logger } from '../src/utils/logger.js';

// Same capture pattern as tests/tool-error-logging.test.ts: the logger writes via
// pino.destination({ fd: 2, sync: true }) (SonicBoom), which calls
// fs.writeSync(fd, ...) directly — never console.error/process.stderr.write. Default
// import, not `import * as fs`: the namespace form is a frozen ES module object and
// vi.spyOn cannot redefine a property on it.
function captureLoggerOutput(): { written: string[]; restore: () => void } {
  const written: string[] = [];
  const spy = vi.spyOn(fs, 'writeSync').mockImplementation((fd: unknown, buffer: unknown) => {
    if (fd === 2) {
      const text = String(buffer);
      written.push(text);
      return Buffer.byteLength(text);
    }
    return 0;
  });
  return { written, restore: () => spy.mockRestore() };
}

describe('error field shape (Issue #212)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a flat errType survives verbatim in the emitted line', () => {
    const { written, restore } = captureLoggerOutput();
    logger.warn({ component: 'test', errType: 'ToolError' }, 'flat case');
    restore();

    const line = JSON.parse(written[0]!) as Record<string, unknown>;
    expect(line['errType']).toBe('ToolError');
    // Confirms this is really the flat-field escape hatch, not a coincidence: no
    // `err` key was created at all.
    expect(line['err']).toBeUndefined();
  });

  it('a nested err: { type, message } is mangled by pino default serializer — this is the trap the flat shape avoids', () => {
    const { written, restore } = captureLoggerOutput();
    // The exact shape the three fixed call sites used to emit. `message` is what
    // triggers pino's default `err` serializer; a nested `err: { type }` alone
    // (no `message`) does NOT trigger it, which is why this bug went unnoticed until
    // a call site gained a message field.
    logger.warn({ component: 'test', err: { type: 'ToolError', message: 'x' } }, 'nested case');
    restore();

    const line = JSON.parse(written[0]!) as Record<string, unknown>;
    const err = line['err'] as Record<string, unknown>;
    // Empirically verified against the installed pino (9.14.0): the serializer
    // overwrites `type` with the value's constructor name. A plain object literal's
    // constructor is `Object`, not `ToolError` — the label is gone, not merely
    // renamed. If this ever fails because pino changed what it emits here, that is
    // real news: update the assertion to the new value and keep the `!== 'ToolError'`
    // guarantee below either way.
    expect(err['type']).toBe('Object');
    expect(err['type']).not.toBe('ToolError');
  });
});
