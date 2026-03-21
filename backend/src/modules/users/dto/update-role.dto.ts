import { IsEnum } from 'class-validator';
import { UserRole } from '../../../database/entities';

export class UpdateRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}
