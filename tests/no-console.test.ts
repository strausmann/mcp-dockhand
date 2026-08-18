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
  /**
   * Set only for a rule whose pattern has no legitimate call site left anywhere in
   * src/ (its `allowed` entry is a reserved permission, not a live usage) -- see the
   * comment on the console.* rule below for why this one case can't be covered by
   * the "pattern is live" guard.
   */
  noLiveSite?: boolean;
}

const RULES: Rule[] = [
  {
    // logger.ts may not use itself before it exists, so its own bootstrap is the one
    // place a direct console call is legitimate. Keep this list at one entry.
    //
    // There is currently no live console.* call anywhere in src/, including in
    // logger.ts itself -- the allowlist entry is a reserved permission for the one
    // place a bootstrap call would be legitimate if logger.ts ever needed one before
    // the logger exists, not a call site that exists today. That means this rule's
    // pattern can never be asserted "live" the way the two rules below can: there is
    // nothing to point the "pattern is live" guard at without writing a fake
    // console.error() into src/ just to satisfy a test, which would defeat the rule
    // it is decorating. So this one rule is deliberately excluded from that guard
    // (`noLiveSite: true`) rather than faked -- a dead regex here still gets caught
    // the moment someone deliberately adds a legitimate bootstrap call and the
    // allowlist grows to match it, at which point this rule stops being exempt.
    what: 'console.* call outside the logger bootstrap',
    pattern: /\bconsole\.\w+\s*\(/,
    allowed: new Set(['utils/logger.ts']),
    noLiveSite: true,
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
    // console rule above, one level deeper. So the allowlist is the call sites
    // themselves: a further one is a decision, not an accident, and has to be made
    // here first.
    //
    // auth/session.ts is the second and was added that way: the login is the one
    // request that cannot go through the client (the client is built on it), so it was
    // the one request with no debug line — see the comment on loggedLoginFetch. It
    // qualifies on the same terms as the first: every field it logs is a constant, a
    // status code, a duration or an exception name. Nothing derived from a URL, a
    // body or a credential is passed to the logger there.
    //
    // tools/meta.ts is the third, on the same terms: self_check and validate_config
    // probe /api/health and /api/auth with a bare fetch that cannot go through the
    // client either, so those diagnostic exchanges had no debug line. loggedProbe()
    // there logs only a constant route, method, status, duration and exception name —
    // never the URL, the login body or the credentials (asserted in
    // tests/tools/meta.probe-debug-logging.test.ts).
    what: '.debug() call outside the three audited call sites',
    pattern: /\.debug\s*\(/,
    allowed: new Set(['client/dockhand-client.ts', 'auth/session.ts', 'tools/meta.ts']),
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

/**
 * A regex typo (e.g. a stray character in `.debug(` turning it into something that
 * matches nothing) would leave `offendersFor()` returning `[]` forever -- the rule
 * reads as satisfied when it is actually just never checking anything. This asserts
 * the pattern matches at least one line SOMEWHERE in src/, including the allowlisted
 * files -- that is precisely where the one legitimate call site lives, so a live
 * pattern must match there if nowhere else. Unlike offendersFor(), this does not
 * filter by allowlist; it deliberately does still skip comment lines (same rule as
 * offendersFor) so that a pattern is only "live" against real code, not a doc comment
 * that happens to mention it in prose.
 */
function patternIsLive(files: string[], pattern: RegExp): boolean {
  return files.some((file) =>
    readFileSync(file, 'utf-8')
      .split('\n')
      .some((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return false;
        return pattern.test(line);
      }),
  );
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

    if (!rule.noLiveSite) {
      it(`pattern for "${rule.what}" still matches its legitimate call site (guards against a dead regex)`, () => {
        expect(patternIsLive(files, rule.pattern)).toBe(true);
      });
    }
  }
});
