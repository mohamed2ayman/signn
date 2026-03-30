import { IsString, IsEnum } from 'class-validator';
import { PermissionLevel } from '../../../database/entities';

export class UpdatePermissionDefaultDto {
  @IsString()
  job_title: string;

  @IsEnum(PermissionLevel)
  permission_level: PermissionLevel;
}
