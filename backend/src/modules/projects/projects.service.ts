import {
  Injectable,
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
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddMemberDto } from './dto/add-member.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly projectMemberRepository: Repository<ProjectMember>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(ProjectParty)
    private readonly projectPartyRepository: Repository<ProjectParty>,
    @InjectRepository(RiskAnalysis)
    private readonly riskAnalysisRepository: Repository<RiskAnalysis>,
  ) {}

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
    const project = await this.projectRepository.findOne({
      where: { id, organization_id: orgId },
      relations: ['members', 'members.user', 'creator'],
    });

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
    const project = this.projectRepository.create({
      organization_id: orgId,
      created_by: userId,
      name: dto.name,
      objective: dto.objective,
      country: dto.country,
      start_date: dto.start_date ? new Date(dto.start_date) : undefined,
      end_date: dto.end_date ? new Date(dto.end_date) : undefined,
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
    const contractCountsByStatus = await this.contractRepository
      .createQueryBuilder('contract')
      .select('contract.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('contract.project_id = :projectId', { projectId: id })
      .groupBy('contract.status')
      .getRawMany();

    // Total contract count
    const totalContracts = await this.contractRepository.count({
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
    const riskSummary = await this.riskAnalysisRepository
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
    });

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
