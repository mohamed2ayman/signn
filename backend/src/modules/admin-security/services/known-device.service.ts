import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { KnownDevice } from '../../../database/entities';
import { ipNetworkPrefix } from '../utils/cidr.util';

export interface DeviceFingerprintInput {
  user_id: string;
  ip: string | null;
  country_code: string | null;
  browser: string | null;
  os: string | null;
}

export interface DeviceLookupResult {
  device: KnownDevice;
  /** True if this device row was just created (i.e. it's a new device). */
  isNew: boolean;
}

/**
 * Tracks known (user, device-fingerprint) pairs so the login flow can
 * suppress "new device" emails for repeat logins from a recognized
 * combination of browser+OS+country+ip-prefix.
 *
 * The fingerprint is intentionally coarse (no IP-precise matching) so a
 * legitimate user on a typical home/office NAT keeps "known" status
 * across reboots and DHCP rotations.
 */
@Injectable()
export class KnownDeviceService {
  constructor(
    @InjectRepository(KnownDevice)
    private readonly repo: Repository<KnownDevice>,
  ) {}

  static computeFingerprint(input: DeviceFingerprintInput): string {
    const canon = [
      input.browser ?? '',
      input.os ?? '',
      input.country_code ?? '',
      ipNetworkPrefix(input.ip ?? ''),
    ].join('|');
    return crypto.createHash('sha256').update(canon).digest('hex');
  }

  async upsert(input: DeviceFingerprintInput): Promise<DeviceLookupResult> {
    const fingerprint = KnownDeviceService.computeFingerprint(input);
    const existing = await this.repo.findOne({
      where: { user_id: input.user_id, fingerprint },
    });
    if (existing) {
      await this.repo.update(existing.id, {
        last_seen_at: new Date(),
        ip_address: input.ip ?? existing.ip_address,
      });
      return { device: { ...existing, last_seen_at: new Date() }, isNew: false };
    }

    const created = await this.repo.save(
      this.repo.create({
        user_id: input.user_id,
        fingerprint,
        ip_address: input.ip ?? null,
        country_code: input.country_code ?? null,
        browser: input.browser ?? null,
        os: input.os ?? null,
      }),
    );
    return { device: created, isNew: true };
  }

  async deleteAllForUser(userId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('user_id = :userId', { userId })
      .execute();
    return result.affected ?? 0;
  }
}
