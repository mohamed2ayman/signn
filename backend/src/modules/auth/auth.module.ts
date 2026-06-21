import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  User,
  Organization,
  SubscriptionPlan,
  OrganizationSubscription,
} from '../../database/entities';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminSecurityModule } from '../admin-security/admin-security.module';
import { CryptoModule } from '../../common/crypto/crypto.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Organization,
      SubscriptionPlan,
      OrganizationSubscription,
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          // Default — AuthService.generateTokens() overrides this per call
          // with env-driven values (JWT_ACCESS_EXPIRES_IN / JWT_REFRESH_EXPIRES_IN).
          expiresIn: configService.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m',
        },
      }),
    }),
    UsersModule,
    NotificationsModule,
    AdminSecurityModule,
    CryptoModule, // exports CryptoService (encrypt MFA TOTP secret at rest, Phase 7.35)
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
