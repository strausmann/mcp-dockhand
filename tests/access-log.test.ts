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
 * Mirrors the grok QUOTEDSTRING rule `"(?:\\.|[^"\\])*"`: the only escape the parser
 * understands is "backslash followed by any one character", consumed as a pair. This
 * decodes a quoted field starting at `start` (the opening quote) exactly the way
 * nginx-logs would, so a test can assert that what comes out the other end of
 * CrowdSec's parser is the original, unmangled value — not just that our own escaping
 * looks plausible.
 */
function decodeQuotedField(text: string, start: number): string {
  let i = start + 1;
  let out = '';
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      out += text[i + 1];
      i += 2;
      continue;
    }
    if (text[i] === '"') return out;
    out += text[i];
    i += 1;
  }
  throw new Error('unterminated quoted field in test fixture');
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
    const line = formatAccessLine({
      ip: '203.0.113.9', time: AT, method: 'GET', path: '/health', httpVersion: '1.1',
      status: 200, bytes: 2,
      userAgent: 'evil\n1.2.3.4 - - [17/Aug/2026:20:44:01 +0000] "GET / HTTP/1.1" 200 0 "-" "forged"',
    });

    expect(line.split('\n')).toHaveLength(1);
    expect(line).not.toContain('forged"');
  });

  it('escapes a quote in the user agent rather than closing the field early', () => {
    const line = formatAccessLine({
      ip: '203.0.113.9', time: AT, method: 'GET', path: '/health', httpVersion: '1.1',
      status: 200, bytes: 2, userAgent: 'we"ird',
    });

    expect(line.endsWith('"we\\"ird"')).toBe(true);
  });

  it('escapes a pre-existing backslash before escaping a quote, so grok cannot desync the field', () => {
    // A naive "escape the quote" pass leaves an existing backslash alone. Grok's
    // QUOTEDSTRING then reads that backslash paired with the escaped quote's own
    // backslash as ONE escaped-backslash sequence, and treats the quote that follows
    // as the field's real, unescaped close — ending the field one character early.
    // Decoding with the same rule the parser uses is the only check that catches that.
    const ua = 'trailing backslash then quote: \\"';
    const line = formatAccessLine({
      ip: '203.0.113.9', time: AT, method: 'GET', path: '/health', httpVersion: '1.1',
      status: 200, bytes: 2, userAgent: ua,
    });

    const boundary = line.lastIndexOf('"-" "');
    expect(boundary).toBeGreaterThan(-1);
    const uaFieldStart = boundary + '"-" "'.length - 1;
    expect(decodeQuotedField(line, uaFieldStart)).toBe(ua);
  });

  it('strips a newline from the ip field, which nginx never quotes', () => {
    // The ip field is interpolated unquoted (nginx doesn't quote it either, and
    // CrowdSec's grok expects it bare) — but a newline in it is still the one thing
    // cheap enough to defend against here, rather than trusting a caller's guarantee
    // that it never hands one back. Unquoted also means an attacker's injected text
    // still lands, verbatim, inside the single resulting line — that's expected and
    // is not what this test is about; the only real defense is against a second line.
    const line = formatAccessLine({
      ip: '203.0.113.9\n1.2.3.4 - - [17/Aug/2026:20:44:01 +0000] "GET / HTTP/1.1" 200 0 "-" "forged"',
      time: AT, method: 'GET', path: '/health', httpVersion: '1.1', status: 200, bytes: 2,
    });

    expect(line.split('\n')).toHaveLength(1);
  });

  it('never prints NaN for status or bytes', () => {
    const line = formatAccessLine({
      ip: '203.0.113.9', time: AT, method: 'GET', path: '/health', httpVersion: '1.1',
      status: Number.NaN, bytes: Number.NaN,
    });

    expect(line).not.toContain('NaN');
  });
});
