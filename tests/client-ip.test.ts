/**
 * Behind Pangolin every request arrives from the proxy, so without this the access
 * log names the proxy for every client — and a CrowdSec decision on that address
 * would lock out everyone at once.
 *
 * The headers are only trustworthy when the peer is. Honouring them unconditionally
 * would hand any direct caller a way to get an arbitrary third party banned.
 */
import { describe, it, expect } from 'vitest';
import { parseTrustedProxies, resolveClientIp } from '../src/utils/client-ip.js';

const NONE = parseTrustedProxies(undefined);
const PROXY = parseTrustedProxies('10.0.0.0/8, 100.64.0.0/10');

describe('parseTrustedProxies', () => {
  it('treats an unset value as trusting nobody', () => {
    expect(NONE.isEmpty).toBe(true);
  });

  it('accepts a bare address as a single host', () => {
    const trusted = parseTrustedProxies('192.0.2.7');
    expect(trusted.isEmpty).toBe(false);
    expect(trusted.contains('192.0.2.7')).toBe(true);
    expect(trusted.contains('192.0.2.8')).toBe(false);
  });

  it('ignores an unparsable entry instead of throwing', () => {
    // Starting is more important than a perfect list; the warning tells the operator.
    const trusted = parseTrustedProxies('10.0.0.0/8, not-an-address');
    expect(trusted.contains('10.1.2.3')).toBe(true);
    expect(trusted.warnings).toHaveLength(1);
    expect(trusted.warnings[0]).toMatch(/not-an-address/);
  });

  it('rejects a trailing-slash entry instead of matching every address', () => {
    // Number('') === 0, not NaN — without a digit check this becomes a /0 that
    // trusts the entire internet, silently turning "trust nobody" into "trust everybody".
    const trusted = parseTrustedProxies('10.0.0.0/');
    expect(trusted.isEmpty).toBe(true);
    expect(trusted.contains('8.8.8.8')).toBe(false);
    expect(trusted.contains('255.255.255.255')).toBe(false);
    expect(trusted.warnings).toHaveLength(1);
    expect(trusted.warnings[0]).toMatch(/10\.0\.0\.0\//);
  });

  it('rejects a hex-looking prefix instead of silently truncating it', () => {
    // Number('0x10') === 16 — a non-decimal spelling must not be accepted as a prefix.
    const trusted = parseTrustedProxies('10.0.0.0/0x10');
    expect(trusted.isEmpty).toBe(true);
    expect(trusted.warnings).toHaveLength(1);
  });

  it('rejects a prefix outside the address family range', () => {
    const trusted = parseTrustedProxies('10.0.0.0/33');
    expect(trusted.isEmpty).toBe(true);
    expect(trusted.warnings).toHaveLength(1);
  });

  it('rejects an entry with extra slash components instead of trusting the parsed subnet', () => {
    // 10.0.0.0/8/garbage must not resolve to /8 — a dropped third component would trust a
    // 16.7M-address subnet the operator never wrote. Codex #209.
    const trusted = parseTrustedProxies('10.0.0.0/8/garbage');
    expect(trusted.isEmpty).toBe(true);
    expect(trusted.contains('10.1.2.3')).toBe(false);
    expect(trusted.warnings).toHaveLength(1);
    expect(trusted.warnings[0]).toMatch(/10\.0\.0\.0\/8\/garbage/);
  });

  it('accepts an explicit /0 as a deliberate trust-everything subnet', () => {
    // /0 is a legitimate, deliberate choice — only the malformed spelling (a missing
    // or non-digit prefix) is rejected, not the value zero itself.
    const trusted = parseTrustedProxies('0.0.0.0/0');
    expect(trusted.isEmpty).toBe(false);
    expect(trusted.warnings).toHaveLength(0);
    expect(trusted.contains('8.8.8.8')).toBe(true);
  });
});

describe('resolveClientIp', () => {
  it('uses the peer when no proxy is trusted', () => {
    expect(
      resolveClientIp({
        peer: '203.0.113.9',
        forwardedFor: '198.51.100.1',
        realIp: '198.51.100.2',
        trusted: NONE,
      }),
    ).toBe('203.0.113.9');
  });

  it('ignores headers from an untrusted peer', () => {
    // The spoofing case. A direct caller must not be able to name someone else.
    expect(
      resolveClientIp({
        peer: '203.0.113.9',
        forwardedFor: '8.8.8.8',
        realIp: '8.8.4.4',
        trusted: PROXY,
      }),
    ).toBe('203.0.113.9');
  });

  it('takes the rightmost untrusted entry of X-Forwarded-For', () => {
    expect(
      resolveClientIp({
        peer: '10.0.0.5',
        forwardedFor: '203.0.113.9, 10.0.0.9',
        realIp: undefined,
        trusted: PROXY,
      }),
    ).toBe('203.0.113.9');
  });

  it('falls back to X-Real-IP when there is no X-Forwarded-For', () => {
    expect(
      resolveClientIp({
        peer: '10.0.0.5',
        forwardedFor: undefined,
        realIp: '203.0.113.9',
        trusted: PROXY,
      }),
    ).toBe('203.0.113.9');
  });

  it('prefers X-Forwarded-For over X-Real-IP when both are present', () => {
    expect(
      resolveClientIp({
        peer: '10.0.0.5',
        forwardedFor: '203.0.113.9',
        realIp: '198.51.100.1',
        trusted: PROXY,
      }),
    ).toBe('203.0.113.9');
  });

  it('keeps the proxy address when the whole chain is trusted', () => {
    expect(
      resolveClientIp({
        peer: '10.0.0.5',
        forwardedFor: '10.0.0.7, 10.0.0.9',
        realIp: undefined,
        trusted: PROXY,
      }),
    ).toBe('10.0.0.7');
  });

  it('normalises an IPv4-mapped IPv6 peer', () => {
    // Node hands out ::ffff:10.0.0.5 on a dual-stack listener; without this the
    // address never matches an IPv4 subnet and the headers are silently ignored.
    expect(
      resolveClientIp({
        peer: '::ffff:10.0.0.5',
        forwardedFor: '203.0.113.9',
        realIp: undefined,
        trusted: PROXY,
      }),
    ).toBe('203.0.113.9');
  });

  it('reports a dash when there is no peer at all', () => {
    expect(
      resolveClientIp({ peer: undefined, forwardedFor: undefined, realIp: undefined, trusted: NONE }),
    ).toBe('-');
  });

  it('falls back to the peer when X-Forwarded-For is unparsable', () => {
    // Some proxies emit the literal "unknown". It must never be logged as if it were
    // the client — that would corrupt the exact field CrowdSec parses bans from.
    expect(
      resolveClientIp({
        peer: '10.0.0.5',
        forwardedFor: 'unknown',
        realIp: undefined,
        trusted: PROXY,
      }),
    ).toBe('10.0.0.5');
  });

  it('skips a malformed entry and keeps walking left for a valid one', () => {
    expect(
      resolveClientIp({
        peer: '10.0.0.5',
        forwardedFor: '203.0.113.9, 1.2.3.4:5678',
        realIp: undefined,
        trusted: PROXY,
      }),
    ).toBe('203.0.113.9');
  });

  it('falls back to the peer when X-Real-IP is unparsable', () => {
    expect(
      resolveClientIp({
        peer: '10.0.0.5',
        forwardedFor: undefined,
        realIp: 'unknown',
        trusted: PROXY,
      }),
    ).toBe('10.0.0.5');
  });
});
