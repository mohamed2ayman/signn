import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Phase 7.28 — POST /erp/connections body.
 *
 * `vendor` is validated against the connector registry in the service (no DB
 * enum — adding an adapter must not need a migration). `credentials` is an
 * arbitrary vendor-specific object; the service JSON-serializes + encrypts it
 * via CryptoService before persisting and NEVER returns it. organization_id is
 * taken from the JWT, never the body.
 */
export class CreateConnectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  vendor: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  base_url?: string;

  /** Vendor-specific credential object (e.g. { apiKey } / { username, password }). */
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
