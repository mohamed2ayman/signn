import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  PlaybookPosition,
  PlaybookRuleType,
  PlaybookScope,
  PlaybookValueConfig,
} from '../../database/entities';
import { CreatePlaybookPositionDto } from './dto/create-playbook-position.dto';
import { UpdatePlaybookPositionDto } from './dto/update-playbook-position.dto';
import { validateValueConfig } from './dto/value-config.validator';

/**
 * 7.22 Slice 1 — CRUD for an org's standard positions.
 *
 * TENANCY: `playbook_positions.organization_id` is carried DIRECTLY, so this is
 * an ORG-scoped surface — the `ErpConnectionService` class, NOT the Option B
 * contract chokepoint (which resolves org via contract → project → org).
 * EVERY read and write here carries `organization_id = :orgId`, where orgId
 * comes from the JWT via `@OrganizationId()` and is NEVER client-supplied.
 *
 * A cross-org id is a 404, never a 403 — an org must not be able to probe
 * whether another org's position id exists (the `loadOwned` precedent in
 * ErpConnectionService).
 *
 * SLICE-1 BOUNDARY: nothing here is consumed by compliance, the AI pipeline, or
 * the frontend yet. The scope-precedence RESOLVER (which position wins for a
 * given contract) is Slice 2 and deliberately does not exist here — this
 * service only stores and returns rows.
 */
@Injectable()
export class PlaybookService {
  private readonly logger = new Logger(PlaybookService.name);

  constructor(
    @InjectRepository(PlaybookPosition)
    private readonly repo: Repository<PlaybookPosition>,
  ) {}

  async create(
    orgId: string,
    userId: string | null,
    dto: CreatePlaybookPositionDto,
  ): Promise<PlaybookPosition> {
    const scope = dto.scope ?? PlaybookScope.ORG;
    const projectId = dto.project_id ?? null;
    const contractId = dto.contract_id ?? null;

    this.assertScopeCoherence(scope, projectId, contractId);
    // The DTO already checked the pair on create; this is the same authority
    // re-applied so a direct (non-HTTP) caller cannot bypass the ValidationPipe.
    this.assertValueConfig(dto.rule_type, dto.value_config);

    // Fields are mapped EXPLICITLY, never spread from the DTO — a spread would
    // let a client-supplied `organization_id` / `id` / `created_by` through, and
    // a field added to the DTO alone would silently never persist (lesson #231).
    const row = this.repo.create({
      organization_id: orgId,
      scope,
      project_id: projectId,
      contract_id: contractId,
      clause_type: dto.clause_type,
      is_custom_clause_type: dto.is_custom_clause_type ?? false,
      rule_type: dto.rule_type,
      value_config: dto.value_config as unknown as PlaybookValueConfig,
      note: dto.note ?? null,
      is_active: dto.is_active ?? true,
      created_by: userId,
    });

    const saved = await this.repo.save(row);
    this.logger.log(
      `Playbook position created org=${orgId} clause_type=${saved.clause_type} rule_type=${saved.rule_type} id=${saved.id}`,
    );
    return saved;
  }

  /** Every position owned by the caller's org. Newest first. */
  async list(orgId: string): Promise<PlaybookPosition[]> {
    return this.repo.find({
      where: { organization_id: orgId },
      order: { created_at: 'DESC' },
    });
  }

  async getOne(orgId: string, id: string): Promise<PlaybookPosition> {
    return this.loadOwned(orgId, id);
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdatePlaybookPositionDto,
  ): Promise<PlaybookPosition> {
    const row = await this.loadOwned(orgId, id);

    // MERGE FIRST, validate the merged result. A PATCH may change any one of
    // scope / project_id / contract_id — or either half of the
    // rule_type ↔ value_config pair — independently, so only the merged row is
    // meaningful. `undefined` means "not sent"; explicit `null` clears.
    const scope = dto.scope ?? row.scope;
    const projectId =
      dto.project_id !== undefined ? dto.project_id : row.project_id;
    const contractId =
      dto.contract_id !== undefined ? dto.contract_id : row.contract_id;
    const ruleType = dto.rule_type ?? row.rule_type;
    const valueConfig =
      dto.value_config !== undefined
        ? (dto.value_config as unknown as PlaybookValueConfig)
        : row.value_config;

    // Re-validate only what the caller actually touched. A stored row is
    // already known-good (it passed this same authority on write, and the DB
    // CHECK guarantees scope coherence), so revalidating an untouched pair
    // could only ever fail a row the caller never asked to change.
    if (
      dto.scope !== undefined ||
      dto.project_id !== undefined ||
      dto.contract_id !== undefined
    ) {
      this.assertScopeCoherence(scope, projectId, contractId);
    }
    if (dto.rule_type !== undefined || dto.value_config !== undefined) {
      this.assertValueConfig(ruleType, valueConfig);
    }

    row.scope = scope;
    row.project_id = projectId;
    row.contract_id = contractId;
    row.rule_type = ruleType;
    row.value_config = valueConfig;
    if (dto.clause_type !== undefined) row.clause_type = dto.clause_type;
    if (dto.is_custom_clause_type !== undefined) {
      row.is_custom_clause_type = dto.is_custom_clause_type;
    }
    if (dto.note !== undefined) row.note = dto.note;
    if (dto.is_active !== undefined) row.is_active = dto.is_active;

    return this.repo.save(row);
  }

  async remove(orgId: string, id: string): Promise<void> {
    // loadOwned first so a cross-org delete 404s instead of silently no-op'ing
    // (a bare `delete({id, organization_id})` reports 0 rows either way).
    const row = await this.loadOwned(orgId, id);
    await this.repo.delete({ id: row.id, organization_id: orgId });
    this.logger.log(`Playbook position deleted org=${orgId} id=${id}`);
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * THE org wall. A row belonging to another org is indistinguishable from a
   * row that does not exist — 404, never 403, so an id cannot be probed.
   */
  private async loadOwned(
    orgId: string,
    id: string,
  ): Promise<PlaybookPosition> {
    const row = await this.repo.findOne({
      where: { id, organization_id: orgId },
    });
    if (!row) {
      throw new NotFoundException('Playbook position not found.');
    }
    return row;
  }

  /**
   * The SINGLE authority on scope ↔ narrowing-column agreement (the DTO
   * deliberately does not duplicate it — see CreatePlaybookPositionDto).
   * Mirrors `playbook_positions_scope_coherence_check` exactly; without this a
   * violation would reach Postgres and surface as a 500 rather than a 400.
   */
  private assertScopeCoherence(
    scope: PlaybookScope,
    projectId: string | null,
    contractId: string | null,
  ): void {
    if (scope === PlaybookScope.ORG) {
      if (projectId !== null || contractId !== null) {
        throw new BadRequestException(
          'An ORG-scoped position must not carry project_id or contract_id.',
        );
      }
      return;
    }

    if (scope === PlaybookScope.PROJECT) {
      if (projectId === null) {
        throw new BadRequestException(
          'A PROJECT-scoped position requires project_id.',
        );
      }
      if (contractId !== null) {
        throw new BadRequestException(
          'A PROJECT-scoped position must not carry contract_id.',
        );
      }
      return;
    }

    // CONTRACT — project_id is optional (the parent project may be
    // denormalized in for the Slice-2 resolver).
    if (contractId === null) {
      throw new BadRequestException(
        'A CONTRACT-scoped position requires contract_id.',
      );
    }
  }

  /** Applies the shared rule_type ↔ value_config authority as a 400. */
  private assertValueConfig(ruleType: PlaybookRuleType, config: unknown): void {
    const error = validateValueConfig(ruleType, config);
    if (error) {
      throw new BadRequestException(error);
    }
  }
}
