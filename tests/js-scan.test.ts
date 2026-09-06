import { describe, it, expect } from 'vitest';
import { splitTernary, findMatchingClose } from '../scripts/lib/js-scan.mjs';

describe('splitTernary', () => {
  it('splits a simple ternary into condition/whenTrue/whenFalse', () => {
    expect(splitTernary('environmentId ? { env: environmentId } : undefined')).toEqual({
      condition: 'environmentId',
      whenTrue: '{ env: environmentId }',
      whenFalse: 'undefined',
    });
  });

  it('returns null when there is no top-level ternary', () => {
    expect(splitTernary('{ env: environmentId }')).toBeNull();
    expect(splitTernary('undefined')).toBeNull();
    expect(splitTernary('someVariable')).toBeNull();
  });

  it('does not confuse optional chaining (?.) with a ternary', () => {
    expect(splitTernary('foo?.bar')).toBeNull();
  });

  it('does not confuse nullish coalescing (??) with a ternary', () => {
    expect(splitTernary('foo ?? {}')).toBeNull();
  });

  it('ignores ? and : nested inside parens/braces/brackets when finding the top-level split', () => {
    // The object literal's own `:` (key: value) must not be mistaken for the ternary's.
    expect(splitTernary('x ? { a: 1, b: fn(2, 3) } : { c: [1, 2] }')).toEqual({
      condition: 'x',
      whenTrue: '{ a: 1, b: fn(2, 3) }',
      whenFalse: '{ c: [1, 2] }',
    });
  });

  it('resolves nested ternaries in the whenTrue branch (ternaryDepth tracking)', () => {
    const result = splitTernary('a ? (b ? 1 : 2) : 3');
    expect(result).toEqual({ condition: 'a', whenTrue: '(b ? 1 : 2)', whenFalse: '3' });
  });

  it('resolves a bare (unparenthesized) nested ternary in whenTrue', () => {
    // `a ? b ? 1 : 2 : 3` parses (right-associatively) as `a ? (b ? 1 : 2) : 3`.
    const result = splitTernary('a ? b ? 1 : 2 : 3');
    expect(result).toEqual({ condition: 'a', whenTrue: 'b ? 1 : 2', whenFalse: '3' });
  });

  it('ignores ternary-like characters inside strings and template literals', () => {
    expect(splitTernary(`x ? 'a : b' : "c ? d"`)).toEqual({
      condition: 'x',
      whenTrue: "'a : b'",
      whenFalse: '"c ? d"',
    });
  });

  it('returns null for an unbalanced/incomplete ternary (no matching colon)', () => {
    expect(splitTernary('x ? { a: 1 }')).toBeNull();
  });
});

describe('findMatchingClose', () => {
  it('finds the matching close for a simple brace pair', () => {
    const text = '{ a: 1 }';
    expect(findMatchingClose(text, 0)).toBe(text.length - 1);
  });

  it('ignores braces inside a string literal', () => {
    const text = `{ a: '{' }`;
    expect(findMatchingClose(text, 0)).toBe(text.length - 1);
  });

  /**
   * Regression (#202, cluster C — src/routes/api/backup/snapshots/[id]/dump/+server.ts,
   * Finsys/dockhand v1.0.46): this exact regex literal appears in the real dump handler
   * as `name.replace(/["\\\x00-\x1f]/g, '_')` (sanitizeFilename). The scanner has no
   * regex-literal awareness — it only recognizes `//` and `/* *\/` as starting a
   * comment, so a bare `/` is just an ordinary character to it. The regex's character
   * class `["\\\x00-\x1f]` contains exactly ONE `"`, which the scanner misreads as
   * opening a STRING literal and hands to skipString() — which then scans forward
   * looking for the next unescaped `"` to close it, silently swallowing everything in
   * between (including any real `{`/`}` in that span) without counting it. In the real
   * file this ate through the rest of the handler body and its closing `}`, so
   * findMatchingClose() returned -1 for the whole function — extractHandlerBlocks()
   * (route-handlers.mjs) then found ZERO handler blocks in the file, and the generated
   * docs/dockhand-api-schema.json ended up with NO queryParamsByMethod entry at all for
   * `/api/backup/snapshots/{id}/dump` — even though the handler unambiguously reads
   * destinationId/path/type via `url.searchParams.get(...)`. validate-mcp-tools.mjs then
   * flagged every one of dump_backup_snapshot_file's (correct) query params as
   * QUERY_PARAM_UNKNOWN, a hard-gating false positive against a tool that was right.
   */
  it('does not let a quote character inside a regex literal be mistaken for a string open (#202 dump handler regression)', () => {
    const text = "{ const f = (name) => name.replace(/[\"\\\\\\x00-\\x1f]/g, '_'); return f; }";
    expect(findMatchingClose(text, 0)).toBe(text.length - 1);
  });

  it('skips a regex literal even when it is the very first token after the open brace', () => {
    const text = '{ /a"b/.test(x) }';
    expect(findMatchingClose(text, 0)).toBe(text.length - 1);
  });

  it('still treats a lone slash as division, not a regex, after an identifier', () => {
    // `a / b` is division; must not be treated as an (unterminated) regex literal that
    // swallows the rest of the string looking for a closing `/`.
    const text = '{ const x = a / b; return x; }';
    expect(findMatchingClose(text, 0)).toBe(text.length - 1);
  });

  it('returns -1 when the input is genuinely unbalanced', () => {
    expect(findMatchingClose('{ a: 1 ', 0)).toBe(-1);
  });

  /**
   * Regression (#202, Fix 3a): canRegexStartAt() only looked at the CHARACTER right
   * before the `/` (skipping whitespace) — an alphanumeric char meant "division". That
   * misreads a regex right after a keyword OPERAND like `return`, since `return` itself
   * ends in an alphanumeric char. Without the keyword allowlist, `/` here is (wrongly)
   * treated as division, so it is never handed to skipRegex() — the `"` inside the
   * character class is then read as an ordinary string-open by the outer scanner,
   * which swallows everything after it (including the real `{`/`}` below) looking for
   * a second `"` that never comes, and findMatchingClose() returns -1.
   */
  it('does not desync on a keyword-operand regex containing a quote and a brace (#202 Fix 3a)', () => {
    const text = '{ function f() { return /["\\{]/g; } const g = () => { return 1; }; }';
    expect(findMatchingClose(text, 0)).toBe(text.length - 1);
  });

  /**
   * Regression (#202, Fix 3b): skipTemplate()'s `${...}` interpolation loop tracked
   * `{`/`}` depth to find the end of the interpolation, but had no regex-literal
   * awareness — a `{` inside a regex character class (e.g. `/[{]/g`, a real pattern for
   * matching a literal opening brace) was counted as an extra nesting level of the
   * interpolation depth counter, desyncing it from the actual code structure: the real
   * closing `}` of the interpolation then only brings the (inflated) depth back to 1
   * instead of 0, so the loop keeps scanning past it, misreads the template's own
   * closing backtick as the start of a NESTED template literal (there is no matching
   * closing backtick left for that nested read to find), and consumes the rest of the
   * text — including the enclosing block's real closing `}` — without ever seeing it.
   *
   * NOTE: `/[}]/g` (a closing-brace character class) does NOT reproduce this — by
   * coincidence its single false depth-decrement still lands the outer scan on the
   * one real closing backtick afterwards, so it stays green even against the
   * pre-Fix-3b code. Verified empirically (reverted skipTemplate's regex handling,
   * ran both fixtures): `/[{]/g` goes red (-1 instead of the real end), `/[}]/g`
   * does not. Use the open-brace-in-class form for the regression to have teeth.
   */
  it('does not desync on a regex-containing template interpolation (#202 Fix 3b)', () => {
    const text = "{ const y = `${x.replace(/[{]/g,'_')}`; return y; }";
    expect(findMatchingClose(text, 0)).toBe(text.length - 1);
  });

  /*
   * Codex #246 P2: a `/` after a POSTFIX `++`/`--` is division, but the char immediately
   * before it is `+`/`-` (not an identifier/`)`/`]`), so canRegexStartAt() classified it as
   * a regex start and skipRegex() then swallowed the rest of the line — including the real
   * closing `}`. Gegenversuch: reverting the postfix guard makes both of these return -1
   * (verified: `count++ / total` and `count-- / total` both desync pre-fix). A single `+`/`-`
   * must stay a regex start (`a + /re/.source` is valid), so the guard checks only the
   * doubled form.
   */
  it('does not desync on division after a postfix ++ (#246 Codex P2)', () => {
    const text = '{ const x = count++ / total; return x; }';
    expect(findMatchingClose(text, 0)).toBe(text.length - 1);
  });

  it('does not desync on division after a postfix -- (#246 Codex P2)', () => {
    const text = '{ const x = count-- / total; return x; }';
    expect(findMatchingClose(text, 0)).toBe(text.length - 1);
  });

  it('still treats a regex after a single + as a regex, not division (#246 Codex P2 boundary)', () => {
    // A lone `+` is a binary/unary operator that can precede a regex operand; the guard
    // must NOT misfire here. The regex contains a `}` in its class, which would desync
    // depth-counting if it were mistaken for division.
    const text = "{ const x = a + /[}]/.source; return x; }";
    expect(findMatchingClose(text, 0)).toBe(text.length - 1);
  });
});
