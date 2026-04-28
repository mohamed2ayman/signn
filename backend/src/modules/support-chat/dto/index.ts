import {
  IsString,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsIn,
  Length,
} from 'class-validator';

export class StartChatDto {
  @IsString()
  @MaxLength(500)
  topic: string;
}

export class SendChatMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  body?: string;
}

export class TransferChatDto {
  @IsUUID()
  to_ops_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CloseChatDto {
  @IsString()
  @IsIn(['resolved', 'transferred_to_ticket', 'user_left'])
  reason: 'resolved' | 'transferred_to_ticket' | 'user_left';
}

export class CsatDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class AddNoteDto {
  @IsString()
  @Length(1, 5000)
  body: string;
}

export class CreateCannedResponseDto {
  @IsString()
  @Length(2, 64)
  shortcut: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @Length(1, 5000)
  body: string;
}

export class UpdateCannedResponseDto {
  @IsOptional()
  @IsString()
  @Length(2, 64)
  shortcut?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 5000)
  body?: string;
}

export class SetAvailabilityDto {
  @IsString()
  @IsIn(['ONLINE', 'AWAY', 'OFFLINE'])
  status: 'ONLINE' | 'AWAY' | 'OFFLINE';
}

export class ConvertToTicketDto {
  @IsOptional()
  @IsString()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: 'low' | 'medium' | 'high' | 'urgent';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;
}
