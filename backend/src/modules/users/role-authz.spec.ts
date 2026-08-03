import { UserRole } from '../../database/entities';
import { canAssignRole } from './role-authz';

/**
 * Rank-ceiling guard test — pins the STRICT `<` in canAssignRole.
 *
 * canAssignRole(actor, target) = ROLE_RANK[target] < ROLE_RANK[actor]: a caller
 * may confer only a role STRICTLY BELOW its own — never its own rank or above.
 * OWNER_ADMIN (rank 70) therefore cannot assign OWNER_ADMIN (70 < 70 = false).
 * This is the structural wall; the service maps a false return to a 403
 * (ForbiddenException) in inviteUser / updateUserRole.
 *
 * Three assertions triangulate the boundary so the pin does not over-assert:
 *   (a) peer-admin DENIED, (b) below-rank ALLOWED, (c) higher-rank actor ALLOWED.
 */
describe('canAssignRole — rank ceiling (OWNER_ADMIN assignment wall)', () => {
  it('OWNER_ADMIN CANNOT assign OWNER_ADMIN (peer-admin denied)', () => {
    // pins the strict < in canAssignRole — if this is ever loosened to <=,
    // OWNER_ADMIN could assign OWNER_ADMIN; this test catches that.
    expect(canAssignRole(UserRole.OWNER_ADMIN, UserRole.OWNER_ADMIN)).toBe(false);
  });

  it('OWNER_ADMIN CAN assign a role below its rank (legit downward assignment)', () => {
    // rank 60 < 70 — proves the wall does not over-assert / break legit flows.
    expect(canAssignRole(UserRole.OWNER_ADMIN, UserRole.OWNER_CREATOR)).toBe(true);
  });

  it("SYSTEM_ADMIN CAN assign OWNER_ADMIN (pin is 'OWNER_ADMIN can't self-assign,' not 'nobody can')", () => {
    // rank 70 < 100 — a strictly-higher actor may still confer OWNER_ADMIN at the
    // rank layer. (Note: not reachable via the team endpoints, which are
    // @Roles(OWNER_ADMIN)-exact; this pins the function, not an exposed route.)
    expect(canAssignRole(UserRole.SYSTEM_ADMIN, UserRole.OWNER_ADMIN)).toBe(true);
  });
});
