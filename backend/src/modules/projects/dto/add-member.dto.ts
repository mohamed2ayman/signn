import { IsUUID, IsOptional, IsString, IsEnum } from 'class-validator';
import { PermissionLevel } from '../../../database/entities';

export class AddMemberDto {
  @IsUUID()
  user_id: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsEnum(PermissionLevel)
  permission_level?: PermissionLevel;
}
