import { IsEmail, IsIn, IsOptional, IsArray, IsUUID, IsString } from 'class-validator';
import { UserRole } from '../../../database/entities';
import { ASSIGNABLE_ORG_ROLES } from '../role-authz';

export class InviteUserDto {
  @IsEmail()
  email: string;

  // Allow-list of org-tier roles only (excludes SYSTEM_ADMIN / OPERATIONS /
  // GUEST). Invite is the third escalation vector — an OWNER_ADMIN could
  // otherwise invite a SYSTEM_ADMIN into their own org and acceptInvitation
  // preserves that role. See role-authz.ts.
  @IsIn(ASSIGNABLE_ORG_ROLES)
  role: UserRole;

  @IsOptional()
  @IsString()
  job_title?: string;

  @IsOptional()
  @IsString()
  default_permission_level?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  project_ids?: string[];
}
