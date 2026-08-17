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
});
