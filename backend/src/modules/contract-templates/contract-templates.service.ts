import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  KnowledgeAsset,
  AssetType,
  Clause,
  ClauseSource,
  ClauseReviewStatus,
  ContractClause,
  ContractType,
  LicenseOrganization,
} from '../../database/entities';

/** Contract types that are standard forms (not ad-hoc/uploaded) */
export function isStandardForm(contractType: ContractType): boolean {
  return contractType !== ContractType.ADHOC && contractType !== ContractType.UPLOADED;
}

/** Derive the license organization from a contract type */
export function getLicenseOrg(contractType: ContractType): LicenseOrganization {
  const ct = contractType as string;
  if (ct.startsWith('FIDIC_')) return LicenseOrganization.FIDIC;
  if (ct.startsWith('NEC') || ct === 'FAC_1' || ct === 'TAC_1') return LicenseOrganization.NEC;
  return LicenseOrganization.OTHER;
}

@Injectable()
export class ContractTemplatesService {
  private readonly logger = new Logger(ContractTemplatesService.name);

  constructor(
    @InjectRepository(KnowledgeAsset)
    private readonly knowledgeAssetRepository: Repository<KnowledgeAsset>,
    @InjectRepository(Clause)
    private readonly clauseRepository: Repository<Clause>,
    @InjectRepository(ContractClause)
    private readonly contractClauseRepository: Repository<ContractClause>,
  ) {}

  /**
   * Find the template for a given contract type code.
   */
  async findTemplate(contractTypeCode: string): Promise<KnowledgeAsset | null> {
    return this.knowledgeAssetRepository
      .createQueryBuilder('ka')
      .where('ka.asset_type = :type', { type: AssetType.CONTRACT_TEMPLATE })
      .andWhere("ka.content->>'contract_type_code' = :code", { code: contractTypeCode })
      .getOne();
  }

  /**
   * Instantiate a template onto a contract.
   * Creates Clause records and ContractClause junction records
   * for each clause in the template's clause_structure.
   */
  async instantiateTemplate(
    contractId: string,
    contractType: ContractType,
    organizationId?: string,
  ): Promise<ContractClause[]> {
    const template = await this.findTemplate(contractType as string);

    if (!template) {
      throw new NotFoundException(
        `No template found for contract type: ${contractType}`,
      );
    }

    const content = template.content as any;
    if (!content?.clause_structure || !Array.isArray(content.clause_structure)) {
      throw new BadRequestException('Template has no clause structure');
    }

    const createdContractClauses: ContractClause[] = [];
    let orderIndex = 1;

    for (const clauseDef of content.clause_structure) {
      // Create a Clause record for the main clause
      const clause = this.clauseRepository.create({
        organization_id: organizationId,
        title: `${clauseDef.clause_number}. ${clauseDef.clause_title}`,
        content: clauseDef.text || '',
        clause_type: `GENERAL_CONDITIONS`,
        version: 1,
        is_active: true,
        source: ClauseSource.MANUAL,
        review_status: ClauseReviewStatus.APPROVED,
      });

      const savedClause = await this.clauseRepository.save(clause);

      // Create ContractClause junction
      const contractClause = this.contractClauseRepository.create({
        contract_id: contractId,
        clause_id: savedClause.id,
        section_number: clauseDef.clause_number,
        order_index: orderIndex++,
        customizations: {
          source_template: contractType,
          source_organization: content.organization,
          color_name: content.color_name,
          is_general_condition: true,
          sub_clauses: clauseDef.sub_clauses || [],
        },
      });

      const savedCc = await this.contractClauseRepository.save(contractClause);
      createdContractClauses.push(savedCc);

      // Create sub-clause records
      for (const subDef of clauseDef.sub_clauses || []) {
        const subClause = this.clauseRepository.create({
          organization_id: organizationId,
          title: `${subDef.sub_clause_number} ${subDef.sub_clause_title}`,
          content: subDef.text || '',
          clause_type: 'GENERAL_CONDITIONS',
          version: 1,
          is_active: true,
          source: ClauseSource.MANUAL,
          review_status: ClauseReviewStatus.APPROVED,
          parent_clause_id: savedClause.id,
        });

        const savedSub = await this.clauseRepository.save(subClause);

        const subContractClause = this.contractClauseRepository.create({
          contract_id: contractId,
          clause_id: savedSub.id,
          section_number: subDef.sub_clause_number,
          order_index: orderIndex++,
          customizations: {
            source_template: contractType,
            source_organization: content.organization,
            color_name: content.color_name,
            is_general_condition: true,
            parent_clause_number: clauseDef.clause_number,
          },
        });

        const savedSubCc = await this.contractClauseRepository.save(subContractClause);
        createdContractClauses.push(savedSubCc);
      }
    }

    this.logger.log(
      `Instantiated template ${contractType} onto contract ${contractId}: ${createdContractClauses.length} clauses`,
    );

    return createdContractClauses;
  }

  /**
   * Get all available templates (for frontend listing).
   */
  async listTemplates(): Promise<KnowledgeAsset[]> {
    return this.knowledgeAssetRepository.find({
      where: { asset_type: AssetType.CONTRACT_TEMPLATE },
      order: { title: 'ASC' },
    });
  }
}
