import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DataSource } from 'typeorm';

import { UsersService } from './users.service';
import { User, UserRole, Organization } from '../../database/entities';
import { EmailService } from '../notifications/email.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { InviteUserDto } from './dto/invite-user.dto';

/**
 * users-privesc leak battery — the fix/users-privesc security spine.
 *
 * Each test FAILS against pre-fix code (unscoped findOne, bare @IsEnum, no
 * self/last-admin/rank guards) and PASSES now. Service guards are asserted by
 * exception CLASS, which is exactly NestJS's exception→HTTP-status mapping:
 *   NotFoundException → 404 (tenancy wall, no existence leak),
 *   ForbiddenException → 403 (self / rank / last-admin).
 * DTO allow-list is asserted directly with class-validator (→ 400 at the pipe).
 */
describe('Users privilege-escalation — leak battery', () => {
  let service: UsersService;
  let userRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let orgRepo: { findOne: jest.Mock };
  // The org-decapitation guard locks the org's active admin rows FOR UPDATE
  // inside a transaction; lockQb.getMany returns that (mocked) active-admin set.
  let lockQb: {
    setLock: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    getMany: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  const ORG_A = 'org-aaaaaaaa';
  const ORG_B = 'org-bbbbbbbb';
  const ADMIN_A = { id: 'admin-a', role: UserRole.OWNER_ADMIN }; // the caller

  const userRow = (over: Partial<User>): User =>
    ({
      id: 'u',
      email: 'u@example.com',
      role: UserRole.OWNER_CREATOR,
      organization_id: ORG_A,
      is_active: true,
      ...over,
    }) as User;

  beforeEach(async () => {
    lockQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    userRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'new-user', ...x })),
      createQueryBuilder: jest.fn(() => lockQb),
    };
    orgRepo = { findOne: jest.fn().mockResolvedValue({ id: ORG_A, name: 'Org A' }) };
    const email = { sendInvitation: jest.fn().mockResolvedValue(undefined) };
    // The transactional manager resolves User to the SAME userRepo mock, so the
    // locked admin read (createQueryBuilder→lockQb) and the write (update) are
    // both observable on userRepo. A real FOR UPDATE lock — and thus the
    // mutual-demote race guarantee — is exercised by the DB, not this mock.
    const txnManager = { getRepository: jest.fn().mockReturnValue(userRepo) };
    dataSource = { transaction: jest.fn(async (cb: any) => cb(txnManager)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Organization), useValue: orgRepo },
        { provide: EmailService, useValue: email },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  // ─── LAYER 2: DTO allow-list (the 400 at the validation pipe) ──────────────
  describe('Layer 2 — DTO allow-list (@IsIn org-tier only)', () => {
    const roleErrors = async (Dto: any, role: string, extra = {}) => {
      const errs = await validate(plainToInstance(Dto, { role, ...extra }));
      return errs.filter((e) => e.property === 'role');
    };

    it('HEADLINE: UpdateRoleDto REJECTS SYSTEM_ADMIN (self-promote → 400)', async () => {
      const errs = await roleErrors(UpdateRoleDto, 'SYSTEM_ADMIN');
      expect(errs).toHaveLength(1);
      expect(errs[0].constraints).toHaveProperty('isIn');
    });

    it('UpdateRoleDto REJECTS OPERATIONS and GUEST', async () => {
      expect(await roleErrors(UpdateRoleDto, 'OPERATIONS')).toHaveLength(1);
      expect(await roleErrors(UpdateRoleDto, 'GUEST')).toHaveLength(1);
    });

    it('UpdateRoleDto ACCEPTS org-tier roles', async () => {
      for (const r of ['OWNER_ADMIN', 'OWNER_CREATOR', 'OWNER_REVIEWER', 'CONTRACTOR_ADMIN']) {
        expect(await roleErrors(UpdateRoleDto, r)).toHaveLength(0);
      }
    });

    it('InviteUserDto REJECTS SYSTEM_ADMIN / OPERATIONS (invite vector → 400)', async () => {
      const e = { email: 'x@y.com' };
      expect(await roleErrors(InviteUserDto, 'SYSTEM_ADMIN', e)).toHaveLength(1);
      expect(await roleErrors(InviteUserDto, 'OPERATIONS', e)).toHaveLength(1);
    });

    it('InviteUserDto ACCEPTS an org-tier role', async () => {
      expect(await roleErrors(InviteUserDto, 'OWNER_CREATOR', { email: 'x@y.com' })).toHaveLength(0);
    });
  });

  // ─── LAYER 1: cross-tenant org wall (404, never the email) ─────────────────
  describe('Layer 1 — cross-tenant org wall', () => {
    it('cross-org re-role → 404 (org-scoped query, no email, no mutation)', async () => {
      userRepo.findOne.mockResolvedValue(null); // no row matches {id, organization_id: ORG_A}
      await expect(
        service.updateUserRole('target-in-org-b', { role: UserRole.OWNER_CREATOR }, ORG_A, ADMIN_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      // the lookup IS org-scoped (this is what closes the cross-tenant hole)
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'target-in-org-b', organization_id: ORG_A },
      });
      expect(userRepo.update).not.toHaveBeenCalled(); // no write, no {email} return
    });

    it('cross-org deactivate → 404 (no mutation)', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.deactivateUser('target-in-org-b', ORG_A, ADMIN_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('null actor-org → 404 without even hitting the DB (no null-org match)', async () => {
      await expect(
        service.updateUserRole('t', { role: UserRole.OWNER_CREATOR }, null, ADMIN_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ─── LAYER 2: service rank ceiling (403) ───────────────────────────────────
  describe('Layer 2 — service rank ceiling', () => {
    it('re-role above own rank → 403 (OWNER_CREATOR cannot confer OWNER_ADMIN)', async () => {
      userRepo.findOne.mockResolvedValue(userRow({ id: 'target', organization_id: ORG_A }));
      await expect(
        service.updateUserRole('target', { role: UserRole.OWNER_ADMIN }, ORG_A, {
          id: 'creator',
          role: UserRole.OWNER_CREATOR,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('invite above own rank → 403, before any DB call', async () => {
      await expect(
        service.inviteUser(
          ORG_A,
          { email: 'x@y.com', role: UserRole.OWNER_ADMIN } as InviteUserDto,
          'Inviter',
          { id: 'creator', role: UserRole.OWNER_CREATOR },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });

    it('service ceiling also blocks inviting a platform role (defense-in-depth)', async () => {
      await expect(
        service.inviteUser(
          ORG_A,
          { email: 'x@y.com', role: UserRole.SYSTEM_ADMIN } as InviteUserDto,
          'Inviter',
          ADMIN_A,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // Strict ceiling (< own rank): a caller can NEVER confer their OWN rank —
    // no peer-admin creation (product decision: org-admin roles are
    // platform-conferred only, for now).
    it('re-role to OWN rank (peer-admin) → 403 (OWNER_ADMIN cannot confer OWNER_ADMIN)', async () => {
      userRepo.findOne.mockResolvedValue(
        userRow({ id: 'member', organization_id: ORG_A, role: UserRole.OWNER_CREATOR }),
      );
      await expect(
        service.updateUserRole('member', { role: UserRole.OWNER_ADMIN }, ORG_A, ADMIN_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('invite at OWN rank (peer-admin) → 403 (OWNER_ADMIN cannot invite OWNER_ADMIN)', async () => {
      await expect(
        service.inviteUser(
          ORG_A,
          { email: 'x@y.com', role: UserRole.OWNER_ADMIN } as InviteUserDto,
          'Inviter',
          ADMIN_A,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ─── LAYER 3: self guards (403) ────────────────────────────────────────────
  describe('Layer 3 — self guards', () => {
    it('self-role-change → 403', async () => {
      userRepo.findOne.mockResolvedValue(
        userRow({ id: ADMIN_A.id, organization_id: ORG_A, role: UserRole.OWNER_ADMIN }),
      );
      await expect(
        service.updateUserRole(ADMIN_A.id, { role: UserRole.OWNER_CREATOR }, ORG_A, ADMIN_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('self-deactivate → 403', async () => {
      userRepo.findOne.mockResolvedValue(
        userRow({ id: ADMIN_A.id, organization_id: ORG_A, role: UserRole.OWNER_ADMIN }),
      );
      await expect(service.deactivateUser(ADMIN_A.id, ORG_A, ADMIN_A)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });

  // ─── LAYER 3: org-decapitation (last-admin) guard — ATOMIC on BOTH paths ────
  // The guard locks the org's active admin rows FOR UPDATE inside a transaction
  // (setLock 'pessimistic_write'), so a concurrent mutual-demote serialises and
  // the second op re-reads the reduced set and is rejected. The mocks assert
  // the lock+txn are invoked (structural proof); the true race is enforced by
  // the DB FOR UPDATE, not by this unit test.
  describe('Layer 3 — org-decapitation guard (atomic, both paths)', () => {
    it('DEACTIVATE the last active admin → 403, under a pessimistic-lock txn', async () => {
      userRepo.findOne.mockResolvedValue(
        userRow({ id: 'other-admin', organization_id: ORG_A, role: UserRole.OWNER_ADMIN }),
      );
      lockQb.getMany.mockResolvedValue([{ id: 'other-admin' } as User]); // sole admin
      await expect(
        service.deactivateUser('other-admin', ORG_A, ADMIN_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(lockQb.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('RE-ROLE the last active admin DOWN to a contributor role → 403 (the newly-covered path)', async () => {
      userRepo.findOne.mockResolvedValue(
        userRow({ id: 'other-admin', organization_id: ORG_A, role: UserRole.OWNER_ADMIN }),
      );
      lockQb.getMany.mockResolvedValue([{ id: 'other-admin' } as User]); // sole admin
      await expect(
        service.updateUserRole('other-admin', { role: UserRole.OWNER_CREATOR }, ORG_A, ADMIN_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(lockQb.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('RE-ROLE the last admin to ANOTHER admin role (no admin lost) → allowed, guard short-circuits', async () => {
      userRepo.findOne.mockResolvedValue(
        userRow({ id: 'other-admin', organization_id: ORG_A, role: UserRole.OWNER_ADMIN }),
      );
      lockQb.getMany.mockResolvedValue([{ id: 'other-admin' } as User]); // sole admin
      await service.updateUserRole(
        'other-admin',
        { role: UserRole.CONTRACTOR_ADMIN },
        ORG_A,
        ADMIN_A,
      );
      expect(userRepo.update).toHaveBeenCalledWith('other-admin', {
        role: UserRole.CONTRACTOR_ADMIN,
      });
      expect(lockQb.getMany).not.toHaveBeenCalled(); // targetWillBeAdmin → no lock read
    });
  });

  // ─── REGRESSION: legit flows still work ────────────────────────────────────
  describe('Regression — legit flows unaffected', () => {
    it('OWNER_ADMIN assigns an allowed lower org-role same-org → works', async () => {
      userRepo.findOne.mockResolvedValue(
        userRow({ id: 'member', organization_id: ORG_A, role: UserRole.OWNER_REVIEWER }),
      );
      const res = await service.updateUserRole('member', { role: UserRole.OWNER_CREATOR }, ORG_A, ADMIN_A);
      expect(userRepo.update).toHaveBeenCalledWith('member', { role: UserRole.OWNER_CREATOR });
      expect(res).toEqual({ id: 'member', email: 'u@example.com', role: UserRole.OWNER_CREATOR });
    });

    it('deactivate a NON-last admin (2 admins) → works', async () => {
      userRepo.findOne.mockResolvedValue(
        userRow({ id: 'other-admin', organization_id: ORG_A, role: UserRole.OWNER_ADMIN }),
      );
      // two active admins locked: the target + the caller → one remains after
      lockQb.getMany.mockResolvedValue([
        { id: 'other-admin' } as User,
        { id: 'admin-a' } as User,
      ]);
      const res = await service.deactivateUser('other-admin', ORG_A, ADMIN_A);
      expect(userRepo.update).toHaveBeenCalledWith('other-admin', { is_active: false });
      expect(res.is_active).toBe(false);
    });

    it('re-role a NON-last admin DOWN (2 admins) → works', async () => {
      userRepo.findOne.mockResolvedValue(
        userRow({ id: 'other-admin', organization_id: ORG_A, role: UserRole.OWNER_ADMIN }),
      );
      lockQb.getMany.mockResolvedValue([
        { id: 'other-admin' } as User,
        { id: 'admin-a' } as User,
      ]);
      await service.updateUserRole(
        'other-admin',
        { role: UserRole.OWNER_CREATOR },
        ORG_A,
        ADMIN_A,
      );
      expect(userRepo.update).toHaveBeenCalledWith('other-admin', {
        role: UserRole.OWNER_CREATOR,
      });
    });

    it('deactivate a non-admin member → works (no last-admin lock read)', async () => {
      userRepo.findOne.mockResolvedValue(
        userRow({ id: 'member', organization_id: ORG_A, role: UserRole.OWNER_CREATOR }),
      );
      const res = await service.deactivateUser('member', ORG_A, ADMIN_A);
      expect(lockQb.getMany).not.toHaveBeenCalled(); // target not admin-tier → guard no-op
      expect(res.is_active).toBe(false);
    });

    it('legit invite of an allowed org-role → works', async () => {
      userRepo.findOne.mockResolvedValue(null); // email free
      const res = await service.inviteUser(
        ORG_A,
        { email: 'new@y.com', role: UserRole.OWNER_CREATOR } as InviteUserDto,
        'Inviter',
        ADMIN_A,
      );
      expect(res).toMatchObject({ role: UserRole.OWNER_CREATOR, invitation_sent: true });
    });

    it('createOperationsUser platform-role path is UNAFFECTED (own DTO, role hardcoded)', async () => {
      userRepo.findOne.mockResolvedValue(null); // email free
      const res: any = await service.createOperationsUser(
        {
          firstName: 'Ops',
          lastName: 'Person',
          email: 'ops@sign.com',
          temporaryPassword: 'Temp@Passw0rd!',
        } as any,
        'SIGN Admin',
      );
      expect(res.role).toBe(UserRole.OPERATIONS); // still provisions OPERATIONS
    });
  });
});
