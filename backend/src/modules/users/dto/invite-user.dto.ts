import { IsEmail, IsEnum, IsOptional, IsArray, IsUUID, IsString } from 'class-validator';
import { UserRole } from '../../../database/entities';

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsOptional()
  @IsString()
  job_title?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  project_ids?: string[];
}
