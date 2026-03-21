import { IsUUID, IsOptional, IsString } from 'class-validator';

export class AddMemberDto {
  @IsUUID()
  user_id: string;

  @IsOptional()
  @IsString()
  role?: string;
}
