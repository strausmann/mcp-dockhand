/**
 * Resolves the address to attribute a request to.
 *
 * Behind a reverse proxy every request arrives from the proxy. Logging that address
 * is not merely unhelpful — a CrowdSec decision taken on it bans the proxy, and with
 * it everyone behind it. So the forwarding headers have to be read.
 *
 * But only from a peer that is allowed to set them. Trusting them unconditionally
 * would turn this server into a way for any direct caller to get an arbitrary third
 * party banned. TRUSTED_PROXIES is what makes the difference, which is also why an
 * unset value means "trust nobody" rather than "trust everybody".
 *
 * Uses node:net BlockList for subnet matching — correct IPv4/IPv6 handling without a
 * dependency.
 */

import { BlockList, isIPv4, isIPv6 } from 'node:net';

export interface TrustedProxies {
  isEmpty: boolean;
  contains(address: string): boolean;
  warnings: string[];
}

/** Node reports IPv4 peers as ::ffff:a.b.c.d on a dual-stack listener. */
function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

function isValidAddress(address: string): boolean {
  return isIPv4(address) || isIPv6(address);
}

/** Only a bare, in-range decimal prefix is accepted — never trust Number()'s leniency. */
const DECIMAL_PREFIX = /^\d+$/;

export function parseTrustedProxies(raw: string | undefined): TrustedProxies {
  const warnings: string[] = [];
  const list = new BlockList();
  let count = 0;

  for (const entry of (raw ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    // Exactly one or zero slashes. `10.0.0.0/8/garbage` would otherwise destructure to
    // `10.0.0.0` + `8` and silently drop the rest, trusting a /8 the operator never wrote.
    // This setting decides which peers may set client-IP headers, so a malformed entry
    // must fail closed with the warning, not resolve to a parsed subnet.
    const parts = entry.split('/');
    if (parts.length > 2) {
      warnings.push(`TRUSTED_PROXIES entry "${entry}" is not a valid address or subnet — ignored.`);
      continue;
    }
    const [address, prefix] = parts;
    const normalized = normalizeAddress(address);
    const family = isIPv4(normalized) ? 'ipv4' : isIPv6(normalized) ? 'ipv6' : undefined;

    if (!family) {
      warnings.push(`TRUSTED_PROXIES entry "${entry}" is not a valid address or subnet — ignored.`);
      continue;
    }

    try {
      if (prefix === undefined) {
        list.addAddress(normalized, family);
      } else {
        // Number('') === 0 and Number('0x10') === 16 — a naive Number(prefix) would
        // silently accept a truncated CIDR as "/0" (trust everyone) or a hex spelling
        // as a valid prefix. Only a bare decimal string is a legitimate prefix; /0
        // itself stays legitimate when it is written that way deliberately.
        if (!DECIMAL_PREFIX.test(prefix)) {
          throw new Error(`invalid prefix "${prefix}"`);
        }
        const prefixLength = Number(prefix);
        const maxPrefix = family === 'ipv4' ? 32 : 128;
        if (prefixLength > maxPrefix) {
          throw new Error(`prefix ${prefixLength} exceeds ${maxPrefix} for ${family}`);
        }
        list.addSubnet(normalized, prefixLength, family);
      }
      count += 1;
    } catch {
      warnings.push(`TRUSTED_PROXIES entry "${entry}" is not a valid address or subnet — ignored.`);
    }
  }

  return {
    isEmpty: count === 0,
    warnings,
    contains(address: string): boolean {
      if (count === 0) return false;
      const normalized = normalizeAddress(address);
      const family = isIPv4(normalized) ? 'ipv4' : isIPv6(normalized) ? 'ipv6' : undefined;
      if (!family) return false;
      return list.check(normalized, family);
    },
  };
}

export interface ClientIpInput {
  peer: string | undefined;
  forwardedFor: string | undefined;
  realIp: string | undefined;
  trusted: TrustedProxies;
}

export function resolveClientIp({ peer, forwardedFor, realIp, trusted }: ClientIpInput): string {
  const direct = peer ? normalizeAddress(peer) : '-';
  if (direct === '-' || !trusted.contains(direct)) return direct;

  if (forwardedFor) {
    const chain = forwardedFor.split(',').map(normalizeAddress).filter(Boolean);
    // Walk right to left: the rightmost entry this proxy added is the closest hop.
    // The first VALID address that is not itself a trusted proxy is the client. A
    // malformed entry (a proxy's literal "unknown", a stray "host:port") must be
    // skipped rather than returned — it would corrupt the field CrowdSec bans from.
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const candidate = chain[i];
      if (isValidAddress(candidate) && !trusted.contains(candidate)) return candidate;
    }
    // Every hop was either trusted or malformed. Report the outermost VALID one
    // rather than inventing an address; if none is valid, fall back to the peer.
    return chain.find(isValidAddress) ?? direct;
  }

  if (realIp) {
    const normalizedRealIp = normalizeAddress(realIp);
    return isValidAddress(normalizedRealIp) ? normalizedRealIp : direct;
  }

  return direct;
}
