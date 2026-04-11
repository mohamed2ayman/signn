import {
  IsUUID,
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  IsArray,
} from 'class-validator';
import { ClaimType, ClaimStatus, ClaimResponseType } from '../../../database/entities/claim.entity';

export class CreateClaimDto {
  @IsUUID()
  contract_id: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsEnum(ClaimType)
  claim_type: ClaimType;

  @IsDateString()
  event_date: string;

  @IsOptional()
  @IsNumber()
  claimed_amount?: number;

  @IsOptional()
  @IsNumber()
  claimed_time_extension_days?: number;

  @IsOptional()
  @IsArray()
  contract_clause_references?: Record<string, unknown>[];
}

export class UpdateClaimStatusDto {
  @IsEnum(ClaimStatus)
  status: ClaimStatus;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateClaimResponseDto {
  @IsEnum(ClaimResponseType)
  response_type: ClaimResponseType;

  @IsString()
  response_content: string;

  @IsOptional()
  @IsNumber()
  counter_amount?: number;

  @IsOptional()
  @IsNumber()
  counter_time_days?: number;

  @IsOptional()
  @IsString()
  justification?: string;
}

export class UploadClaimDocumentDto {
  @IsString()
  file_url: string;

  @IsString()
  file_name: string;

  @IsOptional()
  @IsString()
  document_type?: string;
}
