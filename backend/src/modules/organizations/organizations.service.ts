import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Organization,
  KnowledgeAsset,
  AssetType,
  AssetReviewStatus,
} from '../../database/entities';
import { StorageService } from '../storage/storage.service';
import {
  validateFileType,
  ALLOWED_PDF_MIMES,
  ALLOWED_PDF_EXTENSIONS,
} from '../../common/utils/file-validation';
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

    validateFileType(file, ALLOWED_PDF_MIMES, ALLOWED_PDF_EXTENSIONS, 'PDF');

    const uploaded = await this.storageService.uploadFile(file as any, 'policies');
    if (!uploaded) {
      throw new InternalServerErrorException('File upload failed');
    }

    const knowledgeAsset = this.knowledgeAssetRepository.create({
      organization_id: orgId,
      title: dto.title,
      description: dto.description ?? null,
      asset_type: AssetType.ORGANIZATION_POLICY,
      review_status: AssetReviewStatus.AUTO_APPROVED,
      file_url: uploaded.file_url,
      file_name: file.originalname,
      created_by: userId,
    } as any);

    return this.knowledgeAssetRepository.save(knowledgeAsset as any) as any;
  }
}
