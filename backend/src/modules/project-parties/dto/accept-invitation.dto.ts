import { IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

export class AcceptPartyInvitationDto {
  @IsUUID()
  invitation_token: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  contact_person: string;

  @IsString()
  @MaxLength(20)
  phone?: string;
}
