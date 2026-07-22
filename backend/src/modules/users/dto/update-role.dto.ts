import { IsIn } from 'class-validator';
import { UserRole } from '../../../database/entities';
import { ASSIGNABLE_ORG_ROLES } from '../role-authz';

export class UpdateRoleDto {
  // Allow-list of org-tier roles only — SYSTEM_ADMIN / OPERATIONS / GUEST are
  // provisioned by independent paths (seed / create-operations / guest portal)
  // and are NOT assignable here. See role-authz.ts. The service-side rank
  // ceiling (canAssignRole) enforces the caller-relative constraint on top.
  @IsIn(ASSIGNABLE_ORG_ROLES)
  role: UserRole;
}
