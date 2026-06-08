import { IsOptional, IsString, IsEnum, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { LegalDocumentStatus } from '../../../database/entities';
import { ALLOWED_JURISDICTIONS } from './create-legal-document.dto';

export class ListLegalDocumentsDto {
  @IsOptional()
  @IsIn(ALLOWED_JURISDICTIONS)
  jurisdiction?: string;

  @IsOptional()
  @IsEnum(LegalDocumentStatus)
  status?: LegalDocumentStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
