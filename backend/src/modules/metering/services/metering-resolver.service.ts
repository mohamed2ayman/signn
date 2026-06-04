import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Contract } from '../../../database/entities';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { MeterDefinition } from '../entities/meter-definition.entity';
import { PlanAllowance } from '../entities/plan-allowance.entity';
import { SubjectAllowance } from '../entities/subject-allowance.entity';
import { MeterKey, MeterWindowType } from '../enums/meter-key.enum';

/**
 * Phase 7.18 — Metering Primitive.
 *
 * Three resolvers — subject, limit, window key.
 *
 *   resolveMeteringSubject(caller, contractId)
 *     walks contract → project → project.organization_id UNIFORMLY for all
 *     three Bucket-1 caller shapes (managing user, guest user row, viewer
 *     credential). NEVER trusts a guest's User.organization_id for
 *     attribution. For a managing user, the JWT organization_id is used
 *     ONLY as a defense-in-depth cross-check.
 *
 *   resolveLimit(orgId, meterKey)
 *     subject_allowance ?? plan_allowance (via the EXISTING
 *     SubscriptionsService.getOrgSubscription) ?? meter_definition.default_limit.
 *
 *   computeWindowKey(meterDef, { contractId, now })
 *     derived from window_type. Compliance is per_contract → window is the
 *     contract id. Other window types decided at wiring time in Part 2.
 *
 * Audit §6.4: an org with no active subscription returns null from
 * getOrgSubscription → resolution falls through to meter_definition.default_limit.
 * The engine MUST function on a DB with zero subscription_plans rows — the
 * fall-through here is the mechanism.
 */

export interface MeteringCaller {
  /**
   * The acting principal's id.
   *
   * Managing user / guest user → `req.user.id`.
   * Viewer credential → null (no user_id); attribution is the invitation_id
   * carried separately on the credential.
   */
  user_id?: string | null;

  /**
   * The acting principal's JWT organization_id, if any.
   *
   * Managing user → JWT claim.
   * Guest user row → JWT claim (but NEVER trusted for subject — see below).
   * Viewer credential → undefined.
   *
   * Used ONLY for a defense-in-depth cross-check when account_type='MANAGING'
   * AND user_id is set. NEVER for subject derivation.
   */
  jwt_organization_id?: string | null;

  /** Distinguishes managing-user vs guest vs viewer for the cross-check. */
  account_type?: 'MANAGING' | 'GUEST' | 'FREE' | 'VIEWER' | null;
}

@Injectable()
export class MeteringResolver {
  private readonly logger = new Logger(MeteringResolver.name);

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(MeterDefinition)
    private readonly meterDefRepo: Repository<MeterDefinition>,
    @InjectRepository(PlanAllowance)
    private readonly planAllowanceRepo: Repository<PlanAllowance>,
    @InjectRepository(SubjectAllowance)
    private readonly subjectAllowanceRepo: Repository<SubjectAllowance>,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * Walk contract → project → project.organization_id.
   *
   * Single query with the project relation joined; throws NotFound if either
   * the contract or its project's org is missing (the contract entity has
   * project_id NOT NULL and project has organization_id NOT NULL, but a
   * NotFound on the contract is a normal 404 path).
   *
   * For managing users with a JWT org claim, performs a DEFENSE-IN-DEPTH
   * cross-check. On mismatch, logs + throws — does NOT silently proceed.
   * This catches a cross-tenant contract read attempt that slipped past an
   * upstream guard (the same regression PR #42 fixed on the contract entity
   * level).
   */
  async resolveMeteringSubject(
    caller: MeteringCaller,
    contractId: string,
  ): Promise<string> {
    const contract = await this.contractRepo.findOne({
      where: { id: contractId },
      relations: ['project'],
    });

    if (!contract || !contract.project || !contract.project.organization_id) {
      throw new NotFoundException(`Contract ${contractId} not found`);
    }

    const derivedOrg = contract.project.organization_id;

    // Defense-in-depth cross-check — managing users only. Guest user rows
    // can legitimately carry a different organization_id than the contract's
    // owning org (their User.organization_id is whatever the establishIdentity
    // path wrote, and the contract's owning org may differ — audit §6.7 open
    // question still). Viewer credentials carry no org. So we only enforce
    // the check for the managing-user shape, where a mismatch is a security
    // signal worth refusing on.
    if (
      caller.account_type === 'MANAGING' &&
      caller.jwt_organization_id &&
      caller.jwt_organization_id !== derivedOrg
    ) {
      this.logger.error(
        `[metering.resolveSubject] Cross-tenant signal: caller user=${caller.user_id} ` +
          `JWT org=${caller.jwt_organization_id} but contract ${contractId} ` +
          `belongs to org=${derivedOrg}. Refusing.`,
      );
      throw new ForbiddenException(
        'Meter subject cross-check failed — caller does not match contract org',
      );
    }

    return derivedOrg;
  }

  /**
   * Allowance resolution. Precedence:
   *   1. subject_allowances[subject_ref, meter_key].limit
   *   2. plan_allowances[plan_id, meter_key].limit (plan_id from active sub)
   *   3. meter_definitions[meter_key].default_limit
   *
   * `meter_definitions[meter_key]` MUST exist for any active meter — its
   * absence is the engine's "this meter is not configured" signal, which
   * raises 500. Add a row in ops to activate a meter.
   */
  async resolveLimit(orgId: string, meterKey: MeterKey): Promise<number> {
    // Precedence step 1 — subject override.
    const subjectRow = await this.subjectAllowanceRepo.findOne({
      where: { subject_ref: orgId, meter_key: meterKey },
    });
    if (subjectRow) {
      return subjectRow.limit;
    }

    // Precedence step 2 — plan allowance, via the EXISTING resolver.
    // getOrgSubscription returns null if no ACTIVE subscription exists; we
    // fall through to step 3 in that case (audit §6.4: this is the
    // documented "no subscription" path).
    const sub = await this.subscriptionsService.getOrgSubscription(orgId);
    if (sub && sub.plan_id) {
      const planRow = await this.planAllowanceRepo.findOne({
        where: { plan_id: sub.plan_id, meter_key: meterKey },
      });
      if (planRow) {
        return planRow.limit;
      }
    }

    // Precedence step 3 — definition default.
    const def = await this.meterDefRepo.findOne({
      where: { meter_key: meterKey },
    });
    if (!def) {
      // Refuse loudly — a reserve() against a meter without a definition is
      // a wiring bug, not a configuration choice. Ops adds the row to
      // activate.
      throw new InternalServerErrorException(
        `Meter ${meterKey} has no meter_definition row — it is not activated`,
      );
    }
    return def.default_limit;
  }

  /**
   * Window key derivation.
   *
   *   PER_CONTRACT     → contract id (compliance is this — one window per
   *                      contract, lifetime within that contract's life).
   *   LIFETIME         → constant 'lifetime' (one window forever per org).
   *   CALENDAR_PERIOD  → ISO month string, e.g. '2026-06' (UTC). Calendar
   *                      months chosen as the v1 default; other periods can
   *                      be added when a meter genuinely needs them.
   *   ROLLING          → unsupported in Part 1. Rolling windows need a
   *                      time-bucket spec (length + alignment) the schema
   *                      doesn't yet carry. Wiring a rolling meter in
   *                      Part 2 will extend meter_definitions.
   *
   * Throws on unsupported combinations rather than silently picking a
   * default — a meter wired with a window_type this method doesn't handle
   * is a configuration error worth refusing.
   */
  async computeWindowKey(
    meterKey: MeterKey,
    ctx: { contractId?: string | null; now?: Date },
  ): Promise<string> {
    const def = await this.meterDefRepo.findOne({
      where: { meter_key: meterKey },
    });
    if (!def) {
      throw new InternalServerErrorException(
        `Meter ${meterKey} has no meter_definition row`,
      );
    }

    const now = ctx.now ?? new Date();

    switch (def.window_type) {
      case MeterWindowType.PER_CONTRACT: {
        if (!ctx.contractId) {
          throw new InternalServerErrorException(
            `Meter ${meterKey} is per_contract but reserve() did not carry a contractId`,
          );
        }
        return ctx.contractId;
      }
      case MeterWindowType.LIFETIME:
        return 'lifetime';
      case MeterWindowType.CALENDAR_PERIOD: {
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
      }
      case MeterWindowType.ROLLING:
        throw new InternalServerErrorException(
          `Meter ${meterKey} window_type=rolling is not supported in Part 1 ` +
            `(needs a bucket-length spec on meter_definitions; defer to Part 2)`,
        );
      default: {
        // Exhaustiveness — enum extended without updating this switch.
        const _exhaustive: never = def.window_type;
        throw new InternalServerErrorException(
          `Unknown meter window_type: ${String(_exhaustive)}`,
        );
      }
    }
  }
}
