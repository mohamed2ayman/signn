import { IsString, IsOptional, MaxLength, IsIn } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MaxLength(50)
  @IsIn(['billing', 'technical', 'account', 'feature_request', 'other'])
  category: string;

  @IsString()
  @MaxLength(50)
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority: string;

  @IsString()
  @MaxLength(500)
  subject: string;

  @IsString()
  description: string;
}

export class AddReplyDto {
  @IsString()
  content: string;

  @IsOptional()
  is_internal_note?: boolean;
}

export class UpdateTicketStatusDto {
  @IsString()
  @IsIn(['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'])
  status: string;
}
