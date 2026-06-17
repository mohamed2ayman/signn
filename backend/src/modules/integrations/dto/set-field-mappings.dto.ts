import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** One ERP-native → SIGN-neutral field mapping pair. */
export class FieldMappingItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  source_field: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  target_field: string;
}

/**
 * Phase 7.28 — PUT /erp/connections/:id/mappings body.
 *
 * Full replacement of the connection's mapping set (the service deletes the
 * existing rows and inserts these). Customer-configurable DATA — never code.
 */
export class SetFieldMappingsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FieldMappingItemDto)
  mappings: FieldMappingItemDto[];
}
