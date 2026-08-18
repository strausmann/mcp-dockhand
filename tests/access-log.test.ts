/**
 * The format is not a matter of taste: it is what crowdsecurity/nginx-logs parses.
 * The expected string below is the exact line that was verified against the live
 * LAPI with `cscli explain` — docker-logs -> nginx-logs -> geoip -> the 401
 * bruteforce scenario. If a change here breaks that shape, CrowdSec stops seeing
 * this server without anything failing loudly.
 */
import { describe, it, expect } from 'vitest';
import { formatAccessLine } from '../src/utils/access-log.js';

const AT = new Date(Date.UTC(2026, 7, 17, 20, 44, 1));

/**
 * Splits a line the way the consumer does.
 *
 * The expectations in this file are derived from crowdsecurity/nginx-logs, NOT from
 * grok's `QUOTEDSTRING`. nginx-logs reads each quoted field with `%{NOTDQUOTE}`,
 * defined as `[^"]*` — it has no escape sequence of any kind, so a `"` character is a
 * field boundary and nothing else, and a `\"` is a backslash followed by the end of
 * the field. An earlier version of this file asserted against `QUOTEDSTRING` and its
 * `\\.`-style escapes; that parser is not the one reading these lines, and a value
 * written for it makes the line fail to parse entirely (confirmed against the live
 * LAPI). What we emit instead is nginx's own convention: `"` -> `\x22`, `\` -> `\x5C`,
 * and each C0 control character, DEL and byte >= 0x80 -> `\xNN`, uppercase hex.
 *
 * Because no field content may contain a raw quote, splitting on `"` is exactly how
 * the parser sees the line: an extra piece means we emitted a boundary we did not mean.
 */
function quotedFields(line: string): { request: string; referer: string; userAgent: string } {
  const pieces = line.split('"');
  expect(pieces).toHaveLength(7);
  return { request: pieces[1], referer: pieces[3], userAgent: pieces[5] };
}

function lineWith(overrides: Partial<Parameters<typeof formatAccessLine>[0]>): string {
  return formatAccessLine({
    ip: '203.0.113.9', time: AT, method: 'GET', path: '/health', httpVersion: '1.1',
    status: 200, bytes: 2, ...overrides,
  });
}

describe('formatAccessLine', () => {
  it('produces the exact combined format verified against CrowdSec', () => {
    expect(
      formatAccessLine({
        ip: '203.0.113.9',
        time: AT,
        method: 'POST',
        path: '/mcp',
        httpVersion: '1.1',
        status: 401,
        bytes: 27,
        userAgent: 'curl/8.5',
      }),
    ).toBe('203.0.113.9 - - [17/Aug/2026:20:44:01 +0000] "POST /mcp HTTP/1.1" 401 27 "-" "curl/8.5"');
  });

  it('appends the correlation identifiers when present', () => {
    const line = formatAccessLine({
      ip: '203.0.113.9',
      time: AT,
      method: 'POST',
      path: '/mcp',
      httpVersion: '1.1',
      status: 200,
      bytes: 412,
      userAgent: 'claude-connector/1.0',
      req: '7c1e94a2-3f8b-4d21-9e5c-1a2b3c4d5e6f',
      sid: 'b3f0a1de-77c4-4f0a-8b9d-2e1f0a9c8b77',
    });

    expect(line).toContain('"claude-connector/1.0" req=7c1e94a2-3f8b-4d21-9e5c-1a2b3c4d5e6f sid=b3f0a1de-77c4-4f0a-8b9d-2e1f0a9c8b77');
  });

  it('writes a dash for a missing session', () => {
    const line = formatAccessLine({
      ip: '203.0.113.9', time: AT, method: 'POST', path: '/mcp', httpVersion: '1.1',
      status: 200, bytes: 1, req: 'r-1',
    });

    expect(line).toContain('req=r-1 sid=-');
  });

  // `sid` is the one field an outsider controls in full (the mcp-session-id header)
  // and the one written without quotes. Nothing bounds it but this rule, so each of
  // these was a way to write chosen text into the tail of a line CrowdSec reads.
  describe('rejects a session identifier that is not one', () => {
    function sessionField(sid: string): string {
      const line = formatAccessLine({
        ip: '203.0.113.9', time: AT, method: 'POST', path: '/mcp', httpVersion: '1.1',
        status: 200, bytes: 1, req: '7c1e94a2-3f8b-4d21-9e5c-1a2b3c4d5e6f', sid,
      });
      return line.slice(line.indexOf(' sid=') + ' sid='.length);
    }

    it('rejects a quote, which would otherwise unbalance the quoted fields before it', () => {
      expect(sessionField('a"b')).toBe('-');
    });

    it('rejects a space, the separator every field in the line is delimited by', () => {
      expect(sessionField('a b')).toBe('-');
    });

    it('rejects a value longer than any identifier, so a large header cannot inflate the line', () => {
      expect(sessionField('a'.repeat(65))).toBe('-');
      // The boundary itself stays usable -- this is a cap, not a UUID-only rule.
      expect(sessionField('a'.repeat(64))).toBe('a'.repeat(64));
    });

    it('rejects the full forged suffix, which is what the three rules above are for', () => {
      // Exactly the header value that was demonstrated to append a plausible second
      // req=/sid= pair to the end of an otherwise well-formed line.
      const line = formatAccessLine({
        ip: '203.0.113.9', time: AT, method: 'POST', path: '/mcp', httpVersion: '1.1',
        status: 200, bytes: 0, req: '7c1e94a2-3f8b-4d21-9e5c-1a2b3c4d5e6f',
        sid: 'x" 200 0 "-" "-" req=FORGED sid=deadbeef',
      });

      expect(line).not.toContain('FORGED');
      expect(line.endsWith(' req=7c1e94a2-3f8b-4d21-9e5c-1a2b3c4d5e6f sid=-')).toBe(true);
    });

    it('keeps a real session identifier untouched', () => {
      expect(sessionField('b3f0a1de-77c4-4f0a-8b9d-2e1f0a9c8b77')).toBe(
        'b3f0a1de-77c4-4f0a-8b9d-2e1f0a9c8b77',
      );
    });
  });

  it('never carries a query string', () => {
    // A logged query is a logged value. Our own endpoints take no parameters, so
    // dropping it costs nothing and removes a leak path that would otherwise be one
    // careless caller away.
    const line = formatAccessLine({
      ip: '203.0.113.9', time: AT, method: 'POST', path: '/mcp?secret=hunter2',
      httpVersion: '1.1', status: 200, bytes: 1,
    });

    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('secret');
    expect(line).toContain('"POST /mcp HTTP/1.1"');
  });

  it('cannot be used to forge a second log line', () => {
    // A user agent is attacker-controlled. A newline in it would end the line and
    // start one of the attacker's choosing, in a stream a security tool reads.
    const line = lineWith({
      userAgent: 'evil\n1.2.3.4 - - [17/Aug/2026:20:44:01 +0000] "GET / HTTP/1.1" 200 0 "-" "forged"',
    });

    expect(line.split('\n')).toHaveLength(1);
    // The newline survives as its encoding rather than being replaced, and every quote
    // in the forged remainder is encoded too — so the whole payload stays inside the
    // one user-agent field the parser sees, instead of ending it early.
    expect(quotedFields(line).userAgent).toContain('evil\\x0A1.2.3.4');
    expect(quotedFields(line).userAgent.endsWith('\\x22forged\\x22')).toBe(true);
  });

  /**
   * Each case here is a value that, written the way this file used to write it, made
   * the line unparseable for crowdsecurity/nginx-logs — which means no event, no
   * bucket and no decision for the request that carried it.
   */
  describe('encodes a quoted field the way nginx does, because NOTDQUOTE has no escapes', () => {
    it('encodes a quote in the user agent instead of emitting a raw or backslashed one', () => {
      const line = lineWith({ userAgent: 'a"b' });

      expect(quotedFields(line).userAgent).toBe('a\\x22b');
      // The old form. `\"` is not an escape to this parser — it is a backslash and
      // then the end of the field, one character early.
      expect(line).not.toContain('\\"');
    });

    it('encodes a quote in the referer, the field the finding was demonstrated on', () => {
      const line = lineWith({ referer: 'ev"il' });

      expect(quotedFields(line).referer).toBe('ev\\x22il');
    });

    it('encodes a lone quote, the one-character header that removed a caller from CrowdSec', () => {
      const line = lineWith({ referer: '"' });

      expect(quotedFields(line).referer).toBe('\\x22');
    });

    it('encodes a backslash, so it can never pair with anything to look like an escape', () => {
      const line = lineWith({ referer: 'back\\slash' });

      expect(quotedFields(line).referer).toBe('back\\x5Cslash');
    });

    it('encodes a control character rather than replacing it, which is lossless and still safe', () => {
      const line = lineWith({
        userAgent: `a${String.fromCharCode(0x01)}b${String.fromCharCode(0x7f)}c`,
      });

      expect(quotedFields(line).userAgent).toBe('a\\x01b\\x7Fc');
    });

    it('encodes a byte above 0x7f, which nginx escapes and a log reader should not have to guess at', () => {
      // Node decodes header bytes as latin-1, so this code unit IS the wire byte.
      const line = lineWith({ userAgent: `caf${String.fromCharCode(0xe9)}` });

      expect(quotedFields(line).userAgent).toBe('caf\\xE9');
    });

    it('leaves ordinary printable text exactly as it arrived', () => {
      const line = lineWith({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) 'quoted' ~ok~" });

      expect(quotedFields(line).userAgent).toBe("Mozilla/5.0 (X11; Linux x86_64) 'quoted' ~ok~");
    });
  });

  it('makes the request method match %{WORD}, which cannot reach past a hyphen', () => {
    // M-SEARCH is the only method in Node's http.METHODS containing a character that
    // `\b\w+\b` cannot match. Whether that costs anything depends on the hub version: a
    // compiled grok harness failed to parse such a line at all, while the hub on our own
    // LAPI parses it. This keeps the line parseable either way rather than relying on
    // the consumer being the lenient one. Replaced rather than encoded: `M\x2DSEARCH`
    // fails just the same, because %{WORD} still cannot reach the space that follows.
    //
    // It does NOT make the 401 bruteforce scenario fire — that filters on
    // `evt.Parsed.verb == 'POST'`, so every non-POST verb escapes it whatever we write.
    const line = lineWith({ method: 'M-SEARCH', path: '/mcp', status: 401 });

    expect(quotedFields(line).request).toBe('M_SEARCH /mcp HTTP/1.1');
  });

  it('strips a newline from the ip field, which nginx never quotes', () => {
    // The ip field is interpolated unquoted (nginx doesn't quote it either, and
    // CrowdSec's grok expects it bare) — so it gets the strip, not the encoding: a
    // `\x0A` there would be text inside a field the parser expects to hold an address.
    // Unquoted also means an attacker's injected text still lands, verbatim, inside
    // the single resulting line — that's expected and is not what this test is about;
    // the only real defense is against a second line.
    const line = formatAccessLine({
      ip: '203.0.113.9\n1.2.3.4 - - [17/Aug/2026:20:44:01 +0000] "GET / HTTP/1.1" 200 0 "-" "forged"',
      time: AT, method: 'GET', path: '/health', httpVersion: '1.1', status: 200, bytes: 2,
    });

    expect(line.split('\n')).toHaveLength(1);
  });

  it('never prints NaN for status or bytes', () => {
    const line = lineWith({ status: Number.NaN, bytes: Number.NaN });

    expect(line).not.toContain('NaN');
  });
});
