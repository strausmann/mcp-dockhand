/**
 * console.error was the only output channel this server had — 30-odd call sites, all
 * at the same effective level. Once they are gone, the way they come back is one new
 * line in one new file, which no diff-scoped review would flag as a problem.
 *
 * So the rules get a test rather than a convention. Each one is the same shape: a
 * pattern that must not appear in src/ outside a named allowlist, checked line by
 * line with comment lines skipped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname;

interface Rule {
  /** Completes "has no ..." in the test name. */
  what: string;
  pattern: RegExp;
  /** Paths relative to src/. Keep each list as short as its comment claims. */
  allowed: Set<string>;
}

const RULES: Rule[] = [
  {
    // logger.ts may not use itself before it exists, so its own bootstrap is the one
    // place a direct console call is legitimate. Keep this list at one entry.
    what: 'console.* call outside the logger bootstrap',
    pattern: /\bconsole\.\w+\s*\(/,
    allowed: new Set(['utils/logger.ts']),
  },
  {
    // The debug level is the one that carries detail, and this server's guarantee is
    // that it still never carries a VALUE: no stack name, no container id, no secret
    // from trigger_git_webhook's query string. That guarantee is structural — exactly
    // one call site exists, in the single place this process talks to the network, and
    // it logs the endpoint template from the call context rather than the URL.
    //
    // Nothing else enforced it. A `log().debug({ args: JSON.stringify(args) })` added
    // to any tool file ships every tool argument to `docker logs` at LOG_LEVEL=debug,
    // and the whole suite stays green — the same silent-regression shape as the
    // console rule above, one level deeper. So the allowlist is the call site itself:
    // a second one is a decision, not an accident, and has to be made here first.
    what: '.debug() call outside the Dockhand client',
    pattern: /\.debug\s*\(/,
    allowed: new Set(['client/dockhand-client.ts']),
  },
  {
    // With console.* gone, this is the realistic way a direct write comes back: it is
    // what console.log is underneath, so it bypasses the logger just as completely
    // while looking deliberate enough to survive a review. The access-log middleware
    // is the one legitimate writer — stdout is its channel by design (see
    // src/utils/logger.ts on why the two streams are split).
    what: 'direct process.stdout/stderr write outside the access log',
    pattern: /process\.(stdout|stderr)\.write\s*\(/,
    allowed: new Set(['utils/access-log-middleware.ts']),
  },
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

function offendersFor(files: string[], rule: Rule): string[] {
  const offenders: string[] = [];

  for (const file of files) {
    const rel = relative(SRC, file);
    if (rule.allowed.has(rel)) continue;

    readFileSync(file, 'utf-8')
      .split('\n')
      .forEach((line, index) => {
        // Skip comment lines: several files legitimately DISCUSS console.error in
        // their doc comments (src/utils/redact.ts explains which surfaces an error
        // message reaches). Matching those would force prose changes to satisfy a
        // code rule.
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
        if (rule.pattern.test(line)) {
          offenders.push(`${rel}:${index + 1}`);
        }
      });
  }

  return offenders;
}

describe('logging discipline', () => {
  const files = tsFiles(SRC);

  it('finds the source tree (guards against the scan matching nothing)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  for (const rule of RULES) {
    it(`has no ${rule.what}`, () => {
      expect(offendersFor(files, rule)).toEqual([]);
    });
  }
});
