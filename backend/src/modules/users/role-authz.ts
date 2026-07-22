import { UserRole } from '../../database/entities';

/**
 * Role authorization primitives for the team-management endpoints
 * (`POST /users/invite`, `PUT /users/:id/role`, `DELETE /users/:id`).
 *
 * Built from the REAL 10-value `UserRole` enum (user.entity.ts) — NOT the
 * stale CLAUDE.md prose hierarchy, which names PROJECT_MANAGER / REVIEWER /
 * CONTRACTOR_USER (none of which exist in the enum).
 *
 * Mirrors the `LEVEL_RANK` shape in `permission-level.guard.ts` (a numeric
 * rank map + comparison), applied to `UserRole`.
 */

/**
 * Numeric rank per role — HIGHER = more privileged. Used by the service-side
 * ceiling: a caller can only confer a role ranked at OR below their own
 * (`canAssignRole`). This is the STRUCTURAL root of the escalation fix; the
 * DTO allow-list (`ASSIGNABLE_ORG_ROLES`) is defense-in-depth on top.
 *
 * Total order (platform > owner-org > contractor-org > guest):
 *   SYSTEM_ADMIN > OPERATIONS > OWNER_ADMIN > OWNER_CREATOR > OWNER_REVIEWER
 *   > CONTRACTOR_ADMIN > CONTRACTOR_CREATOR > CONTRACTOR_REVIEWER
 *   > CONTRACTOR_TENDERING > GUEST
 */
export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.SYSTEM_ADMIN]: 100,
  [UserRole.OPERATIONS]: 90,
  [UserRole.OWNER_ADMIN]: 70,
  [UserRole.OWNER_CREATOR]: 60,
  [UserRole.OWNER_REVIEWER]: 50,
  [UserRole.CONTRACTOR_ADMIN]: 40,
  [UserRole.CONTRACTOR_CREATOR]: 30,
  [UserRole.CONTRACTOR_REVIEWER]: 25,
  [UserRole.CONTRACTOR_TENDERING]: 20,
  [UserRole.GUEST]: 10,
};

/**
 * The ONLY roles a team-admin may assign via `PUT /users/:id/role` or invite
 * via `POST /users/invite`. Deliberately an ALLOW-LIST (not an exclusion) so a
 * future enum value does not silently become assignable.
 *
 * EXCLUDED and why (all provisioned by independent, non-team paths):
 *   • SYSTEM_ADMIN — seed only (admin-users.seed.ts, direct DB write).
 *   • OPERATIONS  — the SYSTEM_ADMIN-gated `createOperationsUser` (own DTO,
 *                   role hardcoded server-side).
 *   • GUEST       — the guest-portal establish-identity flow only (a GUEST row
 *                   is meaningless without its guest_contract_access binding).
 */
export const ASSIGNABLE_ORG_ROLES: UserRole[] = [
  UserRole.OWNER_ADMIN,
  UserRole.OWNER_CREATOR,
  UserRole.OWNER_REVIEWER,
  UserRole.CONTRACTOR_ADMIN,
  UserRole.CONTRACTOR_CREATOR,
  UserRole.CONTRACTOR_REVIEWER,
  UserRole.CONTRACTOR_TENDERING,
];

/**
 * Roles that ADMINISTER an organization — used by the last-admin
 * (org-decapitation) guard on `deactivateUser`. An org must retain at least
 * one ACTIVE admin-tier user, or no one can manage its team.
 *
 * The two `*_ADMIN` org-tier roles: OWNER_ADMIN (managing party) and
 * CONTRACTOR_ADMIN (contractor firm). The CREATOR / REVIEWER / TENDERING
 * roles are contributor tiers with no team-management authority, so an org
 * left with only those IS effectively decapitated.
 */
export const ORG_ADMIN_ROLES: UserRole[] = [
  UserRole.OWNER_ADMIN,
  UserRole.CONTRACTOR_ADMIN,
];

/**
 * A caller may confer `targetRole` iff its rank is STRICTLY BELOW the caller's
 * own — a caller can never confer their OWN rank or above. "You can only confer
 * LESS power than you hold."
 *
 * Product decision (Ayman + Youssef): a company admin must NOT create a peer
 * admin — org-admin roles (OWNER_ADMIN / CONTRACTOR_ADMIN) are platform-
 * conferred only, for now. Platform roles (SYSTEM_ADMIN / OPERATIONS) are
 * already excluded by the DTO allow-list; the strict `<` additionally blocks
 * peer-admin creation, so an OWNER_ADMIN can no longer assign/invite
 * OWNER_ADMIN (nor a CONTRACTOR_ADMIN their own tier).
 */
export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return ROLE_RANK[targetRole] < ROLE_RANK[actorRole];
}
