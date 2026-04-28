import { IsString, IsOptional, MaxLength, IsIn } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MaxLength(50)
  @IsIn([
    'billing',
    'technical',
    'account',
    'feature_request',
    'other',
    // Tickets created by ops via the "Convert to Ticket" action on a closed
    // Live Chat carry this category so the admin queue can filter for them.
    'live_chat',
  ])
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
