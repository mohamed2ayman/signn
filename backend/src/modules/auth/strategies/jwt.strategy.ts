import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';

import { User } from '../../../database/entities';
import { TokenBlacklistService } from '../../../common/services/token-blacklist.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  organization_id: string;
  /** Phase 4.2 — random UUID stamped on every access token. */
  jti?: string;
  exp?: number;
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly tokenBlacklist: TokenBlacklistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Phase 4.2 — Redis access-token blacklist check.
    //
    // jti is missing on tokens issued BEFORE the Phase 4.2 deploy. Treat
    // that as a 7-day grace window: log a warning but allow the request.
    // After the grace window passes (all pre-4.2 tokens have expired) we
    // can promote this to a hard 401.
    if (payload.jti) {
      const blacklisted = await this.tokenBlacklist.isBlacklisted(payload.jti);
      if (blacklisted) {
        throw new UnauthorizedException('Token has been revoked');
      }
    } else {
      this.logger.warn(
        `[jwt.validate] Access token without jti claim for user ${payload.sub} — pre-Phase-4.2 token, accepted under grace window.`,
      );
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      job_title: user.job_title,
      organization_id: user.organization_id,
      // Phase 7.18 bucket 1a — surfaces account_type so the contract-access
      // authority can branch on it. Defaults to MANAGING (entity default)
      // for all existing users.
      account_type: user.account_type,
    };
  }
}
