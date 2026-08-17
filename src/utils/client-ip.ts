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

export function parseTrustedProxies(raw: string | undefined): TrustedProxies {
  const warnings: string[] = [];
  const list = new BlockList();
  let count = 0;

  for (const entry of (raw ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    const [address, prefix] = entry.split('/');
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
        list.addSubnet(normalized, Number(prefix), family);
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
    // The first one that is not itself a trusted proxy is the client.
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      if (!trusted.contains(chain[i])) return chain[i];
    }
    // Every hop was trusted — report the outermost rather than inventing one.
    return chain[0] ?? direct;
  }

  if (realIp) return normalizeAddress(realIp);

  return direct;
}
