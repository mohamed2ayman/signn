import * as ipaddr from 'ipaddr.js';

/**
 * Returns true if `ip` matches any entry in `entries`. Entries can be
 * either a single IP (e.g. "203.0.113.7") or a CIDR block ("10.0.0.0/8").
 *
 * Invalid entries are silently skipped so a single bad row in the
 * allow/blocklist can't lock the whole platform out.
 */
export function ipMatchesAny(ip: string, entries: string[]): boolean {
  if (!ip || !entries || entries.length === 0) return false;

  const cleanIp = stripIpv6Prefix(ip);
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(cleanIp);
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry) continue;
    try {
      if (entry.includes('/')) {
        const [rangeStr, prefixStr] = entry.split('/');
        const range = ipaddr.parse(rangeStr);
        const prefix = parseInt(prefixStr, 10);
        if (range.kind() !== parsed.kind()) continue;
        if (
          (parsed as ipaddr.IPv4).match(
            range as ipaddr.IPv4,
            prefix,
          )
        ) {
          return true;
        }
      } else {
        const single = ipaddr.parse(entry);
        if (single.kind() === parsed.kind() && single.toString() === parsed.toString()) {
          return true;
        }
      }
    } catch {
      // ignore malformed entry
    }
  }
  return false;
}

function stripIpv6Prefix(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * Build a /24 IPv4 prefix or /64 IPv6 prefix string for KnownDevice
 * fingerprinting — two IPs in the same network produce the same
 * fingerprint so users on a typical home/office NAT see "known device"
 * across legitimate IP rotations.
 */
export function ipNetworkPrefix(ip: string | null | undefined): string {
  if (!ip) return '';
  const clean = stripIpv6Prefix(ip);
  try {
    const parsed = ipaddr.parse(clean);
    if (parsed.kind() === 'ipv4') {
      const parts = clean.split('.');
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
    // IPv6 — first 4 hextets
    const parts = (parsed as ipaddr.IPv6).toNormalizedString().split(':');
    return `${parts.slice(0, 4).join(':')}::/64`;
  } catch {
    return clean;
  }
}
