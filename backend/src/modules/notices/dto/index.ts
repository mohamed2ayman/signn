import {
  IsUUID,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsDateString,
  IsArray,
} from 'class-validator';
import { NoticeType, NoticeStatus, NoticeResponseType } from '../../../database/entities/notice.entity';

export class CreateNoticeDto {
  @IsUUID()
  contract_id: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsEnum(NoticeType)
  notice_type: NoticeType;

  @IsDateString()
  event_date: string;

  @IsOptional()
  @IsBoolean()
  response_required?: boolean;

  @IsOptional()
  @IsDateString()
  response_deadline?: string;

  @IsOptional()
  @IsArray()
  contract_clause_references?: Record<string, unknown>[];
}

export class UpdateNoticeStatusDto {
  @IsEnum(NoticeStatus)
  status: NoticeStatus;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateNoticeResponseDto {
  @IsEnum(NoticeResponseType)
  response_type: NoticeResponseType;

  @IsString()
  response_content: string;
}

export class UploadNoticeDocumentDto {
  @IsString()
  file_url: string;

  @IsString()
  file_name: string;

  @IsOptional()
  @IsString()
  document_type?: string;
}
