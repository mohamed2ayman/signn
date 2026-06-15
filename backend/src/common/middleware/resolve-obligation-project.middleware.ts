import { Injectable, NestMiddleware } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract, Obligation } from '../../database/entities';

/**
 * Resolves `req.params.project_id` before PermissionLevelGuard fires.
 *
 * PermissionLevelGuard reads `params.project_id` to look up the user's
 * ProjectMember row. Obligation routes don't naturally carry a
 * `project_id` param, so without this middleware the guard falls through
 * with `return true` (no project found → no check). Worse, for
 * `/obligations/:id` the guard would read `:id` (an obligation UUID) as
 * the potential projectId, query for a non-existent ProjectMember row,
 * and throw ForbiddenException for everyone except admins.
 *
 * Resolution strategy (evaluated in order; stops on first hit):
 *   1. Already set — skip.
 *   2. `:projectId` param (projects/:projectId/*) — use directly.
 *   3. `:contractId` param (contracts/:contractId/*) — load Contract,
 *      take contract.project_id.
 *   4. `:id` param that looks like a UUID (obligations/:id) — load
 *      Obligation, take obligation.project_id (denormalized field).
 *   5. No match — leave params unchanged; guard will fall through.
 *
 * This middleware is best-effort: a DB error or missing record never
 * blocks the request. The guard is responsible for the final auth
 * decision.
 */
@Injectable()
export class ResolveObligationProjectMiddleware implements NestMiddleware {
  private static readonly UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(
    @InjectRepository(Obligation) // lint-exempt: system/no-orgId by design
    private readonly obligationRepo: Repository<Obligation>,
    @InjectRepository(Contract) // lint-exempt: system/no-orgId by design
    private readonly contractRepo: Repository<Contract>,
  ) {}

  async use(req: any, _res: any, next: () => void): Promise<void> {
    try {
      const params: Record<string, string> = req.params ?? {};

      // Case 0: already resolved — nothing to do.
      if (params.project_id) return next();

      // Case 1: /projects/:projectId/* — projectId IS the project id.
      if (params.projectId) {
        params.project_id = params.projectId;
        return next();
      }

      // Case 2: /contracts/:contractId/* — look up the contract.
      if (params.contractId) {
        const contract = await this.contractRepo.findOne({ // lint-exempt: system/no-orgId by design
          where: { id: params.contractId },
          select: ['id', 'project_id'],
        });
        if (contract?.project_id) {
          params.project_id = contract.project_id;
        }
        return next();
      }

      // Case 3: /obligations/:id — look up the obligation's denormalized
      // project_id.  Only fire for UUID-shaped segments so we don't hit
      // the DB for static path segments like 'upcoming' or 'overdue'.
      if (params.id && ResolveObligationProjectMiddleware.UUID_RE.test(params.id)) {
        const ob = await this.obligationRepo.findOne({ // lint-exempt: system/no-orgId by design
          where: { id: params.id },
          select: ['id', 'project_id'],
        });
        if (ob?.project_id) {
          params.project_id = ob.project_id;
        }
      }
    } catch {
      // Best-effort — never block the request on a lookup failure.
    }

    next();
  }
}
