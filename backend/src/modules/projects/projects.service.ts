import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Project,
  ProjectMember,
  Contract,
  ProjectParty,
  RiskAnalysis,
  User,
} from '../../database/entities';
import { PartyRolesService } from '../contract-parties/party-roles.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberPermissionDto } from './dto/update-member-permission.dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly projectMemberRepository: Repository<ProjectMember>,
    @InjectRepository(Contract) // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(ProjectParty)
    private readonly projectPartyRepository: Repository<ProjectParty>,
    @InjectRepository(RiskAnalysis) // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
    private readonly riskAnalysisRepository: Repository<RiskAnalysis>,
    // Party Foundation Slice 1a — create()/update() validate
    // dto.default_party_role_code against ACTIVE party_roles registry codes.
    // LAST param; the registry is only consulted when a
    // default_party_role_code is actually supplied. DI always provides it
    // (ProjectsModule imports PartyRolesModule).
    private readonly partyRoles: PartyRolesService,
  ) {}

  /**
   * Party Foundation Slice 1a — normalize + validate a
   * default_party_role_code. ''/whitespace-only = "no selection" → NULL;
   * a present code must resolve to a KNOWN + ACTIVE party_roles registry row
   * (findActiveByCode returns null for BOTH unknown and inactive codes, so
   * the 11 roles seeded inactive by migration 1776000000001 are rejected
   * here until Slice 1b activates them). Mirrors
   * ContractsService.resolveHostPartyRoleCode.
   */
  private async resolveDefaultPartyRoleCode(
    rawCode: string | undefined | null,
  ): Promise<string | null> {
    const code = rawCode?.trim() || null;
    if (!code) return null;
    const role = await this.partyRoles.findActiveByCode(code);
    if (!role) {
      throw new BadRequestException(
        `Unknown or inactive party role code: ${code}. ` +
          'Valid codes are the active rows of the party_roles registry ' +
          '(GET /party-roles?applies_to=contract).',
      );
    }
    return code;
  }

  async findAll(orgId: string): Promise<any[]> {
    const projects = await this.projectRepository
      .createQueryBuilder('project')
      .where('project.organization_id = :orgId', { orgId })
      .loadRelationCountAndMap('project.memberCount', 'project.members')
      .loadRelationCountAndMap('project.contractCount', 'project.contracts')
      .orderBy('project.created_at', 'DESC')
      .getMany();

    return projects;
  }

  async findById(id: string, orgId: string): Promise<Project> {
    // Fail-closed org scoping: bind organization_id as a QueryBuilder PARAM so a
    // null/undefined orgId compiles to `= NULL` and matches NOTHING. The old
    // find-options `where: { organization_id: orgId }` DROPPED a null value and
    // returned the row cross-org (confirmed leak). Mirrors the sibling findAll().
    // Full relations first; fall back to a basic (still org-scoped) query if a
    // relation load fails (e.g. a missing FK reference).
    let project: Project | null = null;
    try {
      project = await this.projectRepository
        .createQueryBuilder('project')
        .leftJoinAndSelect('project.members', 'members')
        .leftJoinAndSelect('members.user', 'memberUser')
        .leftJoinAndSelect('project.creator', 'creator')
        .where('project.id = :id', { id })
        .andWhere('project.organization_id = :orgId', { orgId })
        .getOne();
    } catch (error) {
      this.logger.warn(
        `[findOne] Primary query with relations failed for project ${id}, retrying without nested relations. Original error: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Relation loading failed — retry without relations (still org-scoped).
      project = await this.projectRepository
        .createQueryBuilder('project')
        .where('project.id = :id', { id })
        .andWhere('project.organization_id = :orgId', { orgId })
        .getOne();
      if (project) {
        project.members = [];
      }
    }

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  async create(
    orgId: string,
    userId: string,
    dto: CreateProjectDto,
  ): Promise<Project> {
    // Party Foundation Slice 1a — registry-validate BEFORE the insert
    // (unknown/inactive codes 400; ''/omitted → NULL).
    const defaultPartyRoleCode = await this.resolveDefaultPartyRoleCode(
      dto.default_party_role_code,
    );

    const project = this.projectRepository.create({
      organization_id: orgId,
      created_by: userId,
      name: dto.name,
      objective: dto.objective,
      country: dto.country,
      start_date: dto.start_date ? new Date(dto.start_date) : undefined,
      end_date: dto.end_date ? new Date(dto.end_date) : undefined,
      // Slice 1a — explicit mapping (never spread the DTO; lesson #231). The
      // NORMALIZED, registry-validated value.
      default_party_role_code: defaultPartyRoleCode,
    });

    const savedProject = await this.projectRepository.save(project);

    // Auto-add creator as project member
    const member = this.projectMemberRepository.create({
      project_id: savedProject.id,
      user_id: userId,
      role: 'OWNER',
    });
    await this.projectMemberRepository.save(member);

    return savedProject;
  }

  async update(
    id: string,
    orgId: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const project = await this.projectRepository.findOne({
      where: { id, organization_id: orgId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (dto.name !== undefined) project.name = dto.name;
    if (dto.objective !== undefined) project.objective = dto.objective;
    if (dto.country !== undefined) project.country = dto.country;
    if (dto.start_date !== undefined) project.start_date = new Date(dto.start_date);
    if (dto.end_date !== undefined) project.end_date = new Date(dto.end_date);
    // Party Foundation Slice 1a — registry-validated (KNOWN + ACTIVE codes
    // only; '' clears back to NULL). Same helper as create().
    if (dto.default_party_role_code !== undefined) {
      project.default_party_role_code = await this.resolveDefaultPartyRoleCode(
        dto.default_party_role_code,
      );
    }

    return this.projectRepository.save(project);
  }

  async getDashboard(id: string, orgId: string): Promise<Record<string, any>> {
    const project = await this.projectRepository.findOne({
      where: { id, organization_id: orgId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Contract counts by status
    const contractCountsByStatus = await this.contractRepository // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
      .createQueryBuilder('contract')
      .select('contract.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('contract.project_id = :projectId', { projectId: id })
      .groupBy('contract.status')
      .getRawMany();

    // Total contract count
    const totalContracts = await this.contractRepository.count({ // lint-exempt: aggregation count (Q3 — org-wide)
      where: { project_id: id },
    });

    // Party counts by type
    const partyCountsByType = await this.projectPartyRepository
      .createQueryBuilder('party')
      .select('party.party_type', 'party_type')
      .addSelect('COUNT(*)', 'count')
      .where('party.project_id = :projectId', { projectId: id })
      .groupBy('party.party_type')
      .getRawMany();

    const totalParties = await this.projectPartyRepository.count({
      where: { project_id: id },
    });

    // Risk score summary
    const riskSummary = await this.riskAnalysisRepository // lint-exempt: aggregation QB (Q3 — org-wide, not per-contract)
      .createQueryBuilder('risk')
      .select('risk.risk_level', 'risk_level')
      .addSelect('COUNT(*)', 'count')
      .innerJoin('risk.contract', 'contract')
      .where('contract.project_id = :projectId', { projectId: id })
      .groupBy('risk.risk_level')
      .getRawMany();

    return {
      project_id: id,
      contracts: {
        total: totalContracts,
        by_status: contractCountsByStatus,
      },
      parties: {
        total: totalParties,
        by_type: partyCountsByType,
      },
      risk_summary: riskSummary,
    };
  }

  async addMember(
    projectId: string,
    orgId: string,
    dto: AddMemberDto,
  ): Promise<ProjectMember> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId, organization_id: orgId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Verify user belongs to the same organization
    const userRepo = this.projectMemberRepository.manager.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: dto.user_id, organization_id: orgId },
    });

    if (!user) {
      throw new ForbiddenException(
        'User does not belong to your organization',
      );
    }

    // Check if user is already a member
    const existingMember = await this.projectMemberRepository.findOne({
      where: { project_id: projectId, user_id: dto.user_id },
    });

    if (existingMember) {
      throw new ConflictException('User is already a member of this project');
    }

    const member = this.projectMemberRepository.create({
      project_id: projectId,
      user_id: dto.user_id,
      role: dto.role ?? 'MEMBER',
      permission_level: dto.permission_level ?? null,
    });

    return this.projectMemberRepository.save(member);
  }

  async updateMemberPermission(
    projectId: string,
    userId: string,
    orgId: string,
    dto: UpdateMemberPermissionDto,
  ): Promise<ProjectMember> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId, organization_id: orgId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const member = await this.projectMemberRepository.findOne({
      where: { project_id: projectId, user_id: userId },
      relations: ['user'],
    });

    if (!member) {
      throw new NotFoundException('Member not found in this project');
    }

    member.permission_level = dto.permission_level;
    return this.projectMemberRepository.save(member);
  }

  async removeMember(
    projectId: string,
    userId: string,
    orgId: string,
  ): Promise<void> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId, organization_id: orgId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const member = await this.projectMemberRepository.findOne({
      where: { project_id: projectId, user_id: userId },
    });

    if (!member) {
      throw new NotFoundException('Member not found in this project');
    }

    await this.projectMemberRepository.remove(member);
  }

  async deleteProject(id: string, orgId: string): Promise<void> {
    const project = await this.projectRepository.findOne({
      where: { id, organization_id: orgId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // All related data (contracts, clauses, risks, obligations, documents,
    // comments, versions, etc.) is cascade-deleted by FK constraints.
    await this.projectRepository.remove(project);
  }

  async getMembers(
    projectId: string,
    orgId: string,
  ): Promise<ProjectMember[]> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId, organization_id: orgId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return this.projectMemberRepository.find({
      where: { project_id: projectId },
      relations: ['user'],
    });
  }
}
