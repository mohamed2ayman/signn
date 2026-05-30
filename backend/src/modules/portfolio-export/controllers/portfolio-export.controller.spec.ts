import { PortfolioExportController } from './portfolio-export.controller';
import { PortfolioExportService } from '../services/portfolio-export.service';
import { CreatePortfolioExportDto } from '../dto/create-portfolio-export.dto';
import { AnalyticsPeriod } from '../../admin-analytics/dto';
import { User, UserRole } from '../../../database/entities';

/**
 * Phase 7.17 Prompt 2c Bucket 3 — POST /portfolio-exports unit tests.
 *
 * Direct instantiation (no Nest TestingModule) — the controller's
 * @ThrottleOnly decorator composes @UseGuards(ThrottlerGuard), and the
 * test injector would need the full ThrottlerModule wiring (Redis, etc.)
 * to instantiate the guard. Since this spec only asserts method
 * behaviour (the guards run at the global guard layer and are
 * integration-tested elsewhere), direct instantiation sidesteps the
 * DI dance entirely.
 *
 * Scope:
 *   - 202 happy path with org_id / user_id / email pulled from JWT
 *   - org_id / user_id / email NEVER read from request body
 *   - period defaults to P90 when omitted
 *   - project_id passes through as null when omitted
 *   - decorator metadata (@Roles, @ThrottleOnly bucket) present — so
 *     a refactor that drops a decorator is caught here, not at runtime
 */

const USER_ID = '22222222-2222-2222-2222-222222222222';
const ORG_ID = '33333333-3333-3333-3333-333333333333';
const PROJECT_ID = '44444444-4444-4444-4444-444444444444';

function makeUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = USER_ID;
  user.organization_id = ORG_ID;
  user.email = 'owner@example.com';
  user.role = UserRole.OWNER_ADMIN;
  return Object.assign(user, overrides);
}

function makeController(createJob: jest.Mock): {
  controller: PortfolioExportController;
  createJob: jest.Mock;
} {
  const service = { createJob } as unknown as PortfolioExportService;
  return { controller: new PortfolioExportController(service), createJob };
}

describe('PortfolioExportController (POST /portfolio-exports)', () => {
  describe('happy path', () => {
    it('queues a job using JWT-derived user fields and returns { job_id, email }', async () => {
      const { controller, createJob } = makeController(
        jest.fn().mockResolvedValue({ jobId: 'job-1' }),
      );

      const dto: CreatePortfolioExportDto = {
        period: AnalyticsPeriod.P30,
        project_id: PROJECT_ID,
      };

      const result = await controller.create(makeUser(), dto);

      expect(createJob).toHaveBeenCalledTimes(1);
      expect(createJob).toHaveBeenCalledWith({
        userId: USER_ID,
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        period: AnalyticsPeriod.P30,
        email: 'owner@example.com',
      });
      expect(result).toEqual({ job_id: 'job-1', email: 'owner@example.com' });
    });

    it('defaults period to P90 when omitted', async () => {
      const { controller, createJob } = makeController(
        jest.fn().mockResolvedValue({ jobId: 'job-2' }),
      );

      await controller.create(makeUser(), {});

      expect(createJob).toHaveBeenCalledWith(
        expect.objectContaining({ period: AnalyticsPeriod.P90 }),
      );
    });

    it('passes projectId as null when omitted (no project filter)', async () => {
      const { controller, createJob } = makeController(
        jest.fn().mockResolvedValue({ jobId: 'job-3' }),
      );

      await controller.create(makeUser(), { period: AnalyticsPeriod.P90 });

      expect(createJob).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: null }),
      );
    });
  });

  describe('JWT-derived scoping (security floor)', () => {
    it('uses user.id / user.organization_id / user.email — never a body field', async () => {
      const { controller, createJob } = makeController(
        jest.fn().mockResolvedValue({ jobId: 'job-4' }),
      );

      // Even if a client smuggles scoping fields in via the body — the
      // DTO doesn't declare them (so ValidationPipe with whitelist:true
      // strips them in production) — the controller MUST read scoping
      // from the JWT, not from the body. This test passes spurious
      // fields directly and asserts they NEVER reach the service.
      const bodyWithSpuriousFields = {
        period: AnalyticsPeriod.P90,
        user_id: 'attacker-controlled-user-id',
        organization_id: 'attacker-controlled-org-id',
        email: 'attacker@example.com',
      } as any;

      await controller.create(makeUser(), bodyWithSpuriousFields);

      const passed = createJob.mock.calls[0][0];
      expect(passed.userId).toBe(USER_ID);
      expect(passed.orgId).toBe(ORG_ID);
      expect(passed.email).toBe('owner@example.com');
      // None of the attacker-controlled values reached the service.
      expect(passed.userId).not.toBe('attacker-controlled-user-id');
      expect(passed.orgId).not.toBe('attacker-controlled-org-id');
      expect(passed.email).not.toBe('attacker@example.com');
    });
  });

  describe('decorator metadata (refactor protection)', () => {
    it('keeps @Roles(OWNER_ADMIN) on the create method', () => {
      const roles = Reflect.getMetadata(
        'roles',
        PortfolioExportController.prototype.create,
      );
      expect(roles).toBeDefined();
      expect(roles).toContain(UserRole.OWNER_ADMIN);
    });

    it('keeps a throttle bucket pointing at "portfolio_export"', () => {
      // ThrottleOnly composes @Throttle + @SkipThrottle + @UseGuards.
      // Each version of @nestjs/throttler stashes its metadata under
      // slightly different keys. Read every metadata key on the method
      // and assert at least one stringifies to include our bucket name.
      // This catches "decorator dropped during refactor" without
      // depending on a specific throttler-version metadata key.
      const keys = Reflect.getMetadataKeys(
        PortfolioExportController.prototype.create,
      );
      const all = keys.map((k: any) => [
        String(k),
        Reflect.getMetadata(k, PortfolioExportController.prototype.create),
      ]);
      const stringified = JSON.stringify(all);
      expect(stringified).toContain('portfolio_export');
    });
  });
});
