import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import {
  ProjectParty,
  PartyType,
  PARTY_TYPE_PERMISSIONS,
  Project,
} from '../../database/entities';
import { EmailService } from '../notifications/email.service';
import { CreatePartyDto } from './dto/create-party.dto';
import { UpdatePartyDto } from './dto/update-party.dto';

@Injectable()
export class ProjectPartiesService {
  constructor(
    @InjectRepository(ProjectParty)
    private readonly projectPartyRepository: Repository<ProjectParty>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    private readonly emailService: EmailService,
  ) {}

  async findAll(
    orgId: string,
    projectId?: string,
  ): Promise<ProjectParty[]> {
    const queryBuilder = this.projectPartyRepository
      .createQueryBuilder('party')
      .leftJoinAndSelect('party.project', 'project')
      .where('party.owner_organization_id = :orgId', { orgId });

    if (projectId) {
      queryBuilder.andWhere('party.project_id = :projectId', { projectId });
    }

    queryBuilder.orderBy('party.created_at', 'DESC');

    return queryBuilder.getMany();
  }

  async findById(id: string, orgId: string): Promise<ProjectParty> {
    const party = await this.projectPartyRepository.findOne({
      where: { id, owner_organization_id: orgId },
      relations: ['project', 'responses'],
    });

    if (!party) {
      throw new NotFoundException('Project party not found');
    }

    return party;
  }

  async create(orgId: string, dto: CreatePartyDto): Promise<ProjectParty> {
    // Verify the project belongs to this organization
    const project = await this.projectRepository.findOne({
      where: { id: dto.project_id, organization_id: orgId },
    });

    if (!project) {
      throw new NotFoundException('Project not found in your organization');
    }

    // Get default permissions for the party type and merge with custom permissions
    const defaultPermissions = { ...PARTY_TYPE_PERMISSIONS[dto.party_type] };
    const mergedPermissions = dto.permissions
      ? { ...defaultPermissions, ...dto.permissions }
      : defaultPermissions;

    const party = this.projectPartyRepository.create({
      project_id: dto.project_id,
      owner_organization_id: orgId,
      party_type: dto.party_type,
      name: dto.name,
      email: dto.email,
      contact_person: dto.contact_person,
      phone: dto.phone,
      permissions: mergedPermissions,
      invitation_status: 'PENDING',
    });

    return this.projectPartyRepository.save(party);
  }

  async update(
    id: string,
    orgId: string,
    dto: UpdatePartyDto,
  ): Promise<ProjectParty> {
    const party = await this.projectPartyRepository.findOne({
      where: { id, owner_organization_id: orgId },
    });

    if (!party) {
      throw new NotFoundException('Project party not found');
    }

    if (dto.party_type !== undefined) party.party_type = dto.party_type;
    if (dto.name !== undefined) party.name = dto.name;
    if (dto.email !== undefined) party.email = dto.email;
    if (dto.contact_person !== undefined) party.contact_person = dto.contact_person;
    if (dto.phone !== undefined) party.phone = dto.phone;
    if (dto.permissions !== undefined) {
      party.permissions = { ...party.permissions, ...dto.permissions };
    }

    return this.projectPartyRepository.save(party);
  }

  async invite(id: string, orgId: string): Promise<{ message: string }> {
    const party = await this.projectPartyRepository.findOne({
      where: { id, owner_organization_id: orgId },
      relations: ['project'],
    });

    if (!party) {
      throw new NotFoundException('Project party not found');
    }

    // Generate invitation token
    const invitationToken = uuidv4();
    party.invitation_token = invitationToken;
    party.invitation_status = 'INVITED';

    await this.projectPartyRepository.save(party);

    // Send invitation email
    await this.emailService.sendInvitation(
      party.email,
      invitationToken,
      party.party_type,
    );

    return { message: `Invitation sent to ${party.email}` };
  }

  async getByProject(
    projectId: string,
    orgId: string,
  ): Promise<ProjectParty[]> {
    // Verify project belongs to organization
    const project = await this.projectRepository.findOne({
      where: { id: projectId, organization_id: orgId },
    });

    if (!project) {
      throw new NotFoundException('Project not found in your organization');
    }

    return this.projectPartyRepository.find({
      where: { project_id: projectId, owner_organization_id: orgId },
      order: { created_at: 'DESC' },
    });
  }

  getPartyTypes(): Array<{
    type: PartyType;
    permissions: Record<string, boolean>;
  }> {
    return Object.values(PartyType).map((type) => ({
      type,
      permissions: { ...PARTY_TYPE_PERMISSIONS[type] },
    }));
  }

  async acceptInvitation(
    token: string,
    data: { name: string; contact_person: string; phone?: string },
  ): Promise<ProjectParty> {
    const party = await this.projectPartyRepository.findOne({
      where: { invitation_token: token },
      relations: ['project'],
    });

    if (!party) {
      throw new NotFoundException('Invalid invitation token');
    }

    if (party.invitation_status === 'ACCEPTED') {
      throw new ForbiddenException('Invitation already accepted');
    }

    party.name = data.name;
    party.contact_person = data.contact_person;
    if (data.phone) party.phone = data.phone;
    party.invitation_status = 'ACCEPTED';

    return this.projectPartyRepository.save(party);
  }

  async findByInvitationToken(token: string): Promise<ProjectParty> {
    const party = await this.projectPartyRepository.findOne({
      where: { invitation_token: token },
      relations: ['project', 'owner_organization'],
    });

    if (!party) {
      throw new NotFoundException('Invalid invitation token');
    }

    return party;
  }
}
