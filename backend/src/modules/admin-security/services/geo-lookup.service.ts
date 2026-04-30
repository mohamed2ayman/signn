import { Injectable, Logger } from '@nestjs/common';
import * as geoip from 'geoip-lite';

export interface GeoLookupResult {
  country_code: string | null;
  country: string | null;
  city: string | null;
  /** Pretty-printed "City, Country" or just country, or null. */
  pretty: string | null;
}

/**
 * Thin wrapper around `geoip-lite` so the rest of the codebase can mock
 * it in tests. The MaxMind dataset ships with the npm package — no
 * external API calls.
 */
@Injectable()
export class GeoLookupService {
  private readonly logger = new Logger(GeoLookupService.name);

  lookup(ip: string | null | undefined): GeoLookupResult {
    if (!ip) {
      return { country_code: null, country: null, city: null, pretty: null };
    }

    // Strip IPv6-mapped IPv4 prefix (e.g. "::ffff:127.0.0.1") and zone IDs.
    const clean = this.normalizeIp(ip);

    // Localhost / private nets — geoip-lite returns null for these, which
    // is what we want, but we set an explicit pretty label for ops UIs.
    if (this.isPrivate(clean)) {
      return {
        country_code: null,
        country: null,
        city: null,
        pretty: 'Local network',
      };
    }

    try {
      const hit = geoip.lookup(clean);
      if (!hit) {
        return { country_code: null, country: null, city: null, pretty: null };
      }
      const country = hit.country || null;
      const city = hit.city || null;
      const pretty = city && country ? `${city}, ${country}` : country;
      return {
        country_code: country,
        country,
        city,
        pretty: pretty ?? null,
      };
    } catch (err) {
      this.logger.warn(`geoip lookup failed for ${clean}: ${(err as Error).message}`);
      return { country_code: null, country: null, city: null, pretty: null };
    }
  }

  private normalizeIp(ip: string): string {
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    const zoneIdx = ip.indexOf('%');
    return zoneIdx === -1 ? ip : ip.slice(0, zoneIdx);
  }

  private isPrivate(ip: string): boolean {
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    return false;
  }
}
