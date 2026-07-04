import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Guest chat Slice 1 — the guest's question. Mirrors the host chat
 * SendMessageDto bounds (Phase 3.2: every free-text field carries
 * @MaxLength; @Transform null-guards the optional-transform rule).
 */
export class SendGuestChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  message: string;
}
