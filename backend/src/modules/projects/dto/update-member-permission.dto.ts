import { IsEnum } from 'class-validator';
import { PermissionLevel } from '../../../database/entities';

export class UpdateMemberPermissionDto {
  @IsEnum(PermissionLevel)
  permission_level: PermissionLevel;
}
