import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import * as crypto from 'crypto';
import {
  DeviceType,
  SuspiciousReason,
  User,
  UserSession,
} from '../../../database/entities';

export interface CreateSessionInput {
  user_id: string;
  rawJwt: string;
  ip_address?: string | null;
  user_agent?: string | null;
  browser?: string | null;
  os?: string | null;
  device_type?: DeviceType;
  location?: string | null;
  country_code?: string | null;
  is_suspicious?: boolean;
  suspicious_reason?: SuspiciousReason | null;
  expires_at: Date;
}

/**
 * Manages UserSession rows — replaces the single-token model that
 * previously lived on `users.refresh_token_hash`.
 *
 * Token storage: SHA-256 hex of the raw refresh JWT. Cheap to hash, fast
 * to look up by index, never stores the JWT itself.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectRepository(UserSession)
    private readonly sessionRepo: Repository<UserSession>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** SHA-256 of the raw JWT. Stored hex. */
  static hashToken(rawJwt: string): string {
    return crypto.createHash('sha256').update(rawJwt).digest('hex');
  }

  async create(input: CreateSessionInput): Promise<UserSession> {
    const session = this.sessionRepo.create({
      user_id: input.user_id,
      token_hash: SessionService.hashToken(input.rawJwt),
      ip_address: input.ip_address ?? null,
      user_agent: input.user_agent ?? null,
      browser: input.browser ?? null,
      os: input.os ?? null,
      device_type: input.device_type ?? DeviceType.UNKNOWN,
      location: input.location ?? null,
      country_code: input.country_code ?? null,
      is_suspicious: input.is_suspicious ?? false,
      suspicious_reason: input.suspicious_reason ?? null,
      last_active_at: new Date(),
      expires_at: input.expires_at,
    });
    return this.sessionRepo.save(session);
  }

  async findByTokenHash(rawJwt: string): Promise<UserSession | null> {
    const hash = SessionService.hashToken(rawJwt);
    return this.sessionRepo.findOne({
      where: { token_hash: hash, revoked_at: undefined as any },
    });
  }

  /** Returns active (non-revoked, non-expired) sessions for a user, newest first. */
  async listActive(userId: string): Promise<UserSession[]> {
    const now = new Date();
    return this.sessionRepo
      .createQueryBuilder('s')
      .where('s.user_id = :userId', { userId })
      .andWhere('s.revoked_at IS NULL')
      .andWhere('s.expires_at > :now', { now })
      .orderBy('s.last_active_at', 'DESC')
      .getMany();
  }

  async listAll(userId: string, limit = 50): Promise<UserSession[]> {
    return this.sessionRepo.find({
      where: { user_id: userId },
      order: { last_active_at: 'DESC' },
      take: limit,
    });
  }

  async touch(sessionId: string): Promise<void> {
    await this.sessionRepo.update(sessionId, { last_active_at: new Date() });
  }

  async revokeOne(sessionId: string): Promise<UserSession> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (!session.revoked_at) {
      await this.sessionRepo.update(sessionId, { revoked_at: new Date() });
    }
    return this.sessionRepo.findOne({ where: { id: sessionId } }) as Promise<UserSession>;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.sessionRepo
      .createQueryBuilder()
      .update()
      .set({ revoked_at: new Date() })
      .where('user_id = :userId AND revoked_at IS NULL', { userId })
      .execute();
    return result.affected ?? 0;
  }

  /** Revoke any session whose token_hash matches the given raw JWT. */
  async revokeByToken(rawJwt: string): Promise<void> {
    const hash = SessionService.hashToken(rawJwt);
    await this.sessionRepo
      .createQueryBuilder()
      .update()
      .set({ revoked_at: new Date() })
      .where('token_hash = :hash AND revoked_at IS NULL', { hash })
      .execute();
  }

  /**
   * Active suspicious-session count across the platform — feeds the
   * security score and admin dashboard banner.
   */
  async countActiveSuspicious(): Promise<number> {
    const now = new Date();
    return this.sessionRepo
      .createQueryBuilder('s')
      .where('s.is_suspicious = true')
      .andWhere('s.revoked_at IS NULL')
      .andWhere('s.expires_at > :now', { now })
      .getCount();
  }

  /** Recent active suspicious sessions (admin banner). */
  async listActiveSuspicious(limit = 10): Promise<UserSession[]> {
    const now = new Date();
    return this.sessionRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.user', 'u')
      .where('s.is_suspicious = true')
      .andWhere('s.revoked_at IS NULL')
      .andWhere('s.expires_at > :now', { now })
      .orderBy('s.created_at', 'DESC')
      .take(limit)
      .getMany();
  }

  /** Garbage-collect expired sessions. Called occasionally; not required for correctness. */
  async pruneExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.sessionRepo
      .createQueryBuilder()
      .delete()
      .where('expires_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }
}
