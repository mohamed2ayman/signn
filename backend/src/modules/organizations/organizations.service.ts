import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Organization,
  KnowledgeAsset,
  AssetType,
  AssetReviewStatus,
} from '../../database/entities';
import { StorageService } from '../storage/storage.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UploadPolicyDto } from './dto/upload-policy.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(KnowledgeAsset)
    private readonly knowledgeAssetRepository: Repository<KnowledgeAsset>,
    private readonly storageService: StorageService,
  ) {}

  async getMyOrganization(orgId: string): Promise<Organization> {
    const organization = await this.organizationRepository.findOne({
      where: { id: orgId },
      relations: ['subscriptions', 'subscriptions.plan'],
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  async updateOrganization(
    orgId: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    const organization = await this.organizationRepository.findOne({
      where: { id: orgId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    Object.assign(organization, dto);

    return this.organizationRepository.save(organization);
  }

  async uploadOrgPolicy(
    orgId: string,
    userId: string,
    file: Express.Multer.File,
    dto: UploadPolicyDto,
  ): Promise<KnowledgeAsset> {
    const organization = await this.organizationRepository.findOne({
      where: { id: orgId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // Upload file to storage
    const fileUrl = await this.storageService.uploadFile?.(file) ?? file.originalname;

    const knowledgeAsset = this.knowledgeAssetRepository.create({
      organization_id: orgId,
      title: dto.title,
      description: dto.description ?? null,
      asset_type: AssetType.ORGANIZATION_POLICY,
      review_status: AssetReviewStatus.AUTO_APPROVED,
      file_url: fileUrl,
      file_name: file.originalname,
      created_by: userId,
    });

    return this.knowledgeAssetRepository.save(knowledgeAsset);
  }
}
