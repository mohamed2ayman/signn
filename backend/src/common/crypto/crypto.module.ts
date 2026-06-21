import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CryptoService } from '../utils/crypto';

/**
 * Shared module exposing the AES-256-GCM CryptoService (PR #73) to any consumer
 * that needs encryption-at-rest.
 *
 * CryptoService reads its key (`ERP_CREDENTIAL_ENC_KEY`) lazily via ConfigService,
 * so ConfigModule is imported here (harmless even though it is global). Consumers:
 *   - IntegrationsModule — ERP credential storage (Phase 7.28)
 *   - AuthModule — MFA TOTP secret at rest (Phase 7.35)
 *
 * Centralising the provider here avoids two independent CryptoService instances
 * drifting apart and keeps the encryption seam in one place.
 */
@Module({
  imports: [ConfigModule],
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
