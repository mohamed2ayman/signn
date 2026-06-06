import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { AiService } from './ai.service';
import { ContractAccessService } from '../contracts/services/contract-access.service';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    // Tenant-isolation Tier 1 — controller-level wall on body.contract_id
    // for every AI dispatch endpoint. Same shape as compliance.controller.ts
    // (PR #45 / commit 54a3959). The wall throws NotFoundException (404)
    // on cross-tenant probe; no existence leak.
    private readonly contractAccess: ContractAccessService,
  ) {}

  /**
   * Tenant-isolation Tier 1 — managing-user access wall.
   *
   * Asserts the caller's JWT-derived org owns `contractId` BEFORE any AI
   * forward fires. Throws NotFoundException (404, NOT 403) on:
   *   - missing/empty caller org (a JWT with `organization_id IS NULL`
   *     cannot own contracts), or
   *   - contract not owned by the caller's org.
   *
   * Same shape as compliance.controller.ts:62–71 and matches PR #42 / #45
   * no-existence-leak semantics.
   */
  private async assertContractInCallerOrg(
    contractId: string,
    orgId: string | null | undefined,
  ): Promise<void> {
    if (!orgId) {
      throw new NotFoundException('Contract not found');
    }
    await this.contractAccess.findInOrg(contractId, orgId);
  }

  @Post('risk-analysis')
  async triggerRiskAnalysis(
    @Body() body: {
      contract_id: string;
      clauses: Array<{ id: string; text: string }>;
      knowledge_context?: string;
    },
    @OrganizationId() orgId: string,
  ) {
    await this.assertContractInCallerOrg(body.contract_id, orgId);
    return this.aiService.triggerRiskAnalysis({
      ...body,
      org_id: orgId,
    });
  }

  @Post('summarize')
  async triggerSummarize(
    @Body() body: { contract_id: string; full_text: string },
    @OrganizationId() orgId: string,
  ) {
    await this.assertContractInCallerOrg(body.contract_id, orgId);
    return this.aiService.triggerSummarize({
      ...body,
      org_id: orgId,
    });
  }

  @Post('diff')
  async triggerDiffAnalysis(
    @Body() body: {
      original_clauses: Array<{ id: string; text: string }>;
      modified_clauses: Array<{ id: string; text: string }>;
    },
  ) {
    // /ai/diff carries no contract_id — it operates on bare clauses
    // supplied by the caller. Tenant isolation on clause ownership is
    // OUT OF SCOPE for Tier 1 (see docs/tenant-isolation-tier1.md);
    // this handler is intentionally left untouched.
    return this.aiService.triggerDiffAnalysis(body);
  }

  @Post('extract-obligations')
  async triggerExtractObligations(
    @Body() body: {
      contract_id: string;
      clauses: Array<{ id: string; text: string }>;
    },
    @OrganizationId() orgId: string,
  ) {
    await this.assertContractInCallerOrg(body.contract_id, orgId);
    return this.aiService.triggerExtractObligations(body);
  }

  @Post('detect-conflicts')
  async triggerConflictDetection(
    @Body() body: {
      contract_id: string;
      clauses: Array<{
        id: string;
        text: string;
        document_id?: string | null;
        document_label?: string | null;
        document_priority?: number;
      }>;
    },
    @OrganizationId() orgId: string,
  ) {
    await this.assertContractInCallerOrg(body.contract_id, orgId);
    return this.aiService.triggerConflictDetection(body);
  }

  @Post('chat')
  async triggerChat(
    @Body() body: {
      message: string;
      contract_id?: string;
      history?: Array<{ role: string; content: string }>;
      system_context?: string;
    },
    @OrganizationId() orgId: string,
  ) {
    // contract_id is OPTIONAL on this endpoint — only gate when it's
    // present. An unscoped chat (no contract context) is allowed for
    // managing users in any org.
    if (body.contract_id) {
      await this.assertContractInCallerOrg(body.contract_id, orgId);
    }
    return this.aiService.triggerChat({
      ...body,
      org_id: orgId,
    });
  }

  @Post('research')
  async triggerResearch(
    @Body() body: { keywords: string[]; jurisdiction?: string },
  ) {
    return this.aiService.triggerResearch(body);
  }

  @Get('jobs/:jobId')
  async getJobStatus(@Param('jobId') jobId: string) {
    return this.aiService.getJobStatus(jobId);
  }

  @Post('embeddings/ingest')
  async ingestEmbedding(
    @Body() body: {
      asset_id: string;
      text: string;
      metadata?: Record<string, any>;
    },
    @OrganizationId() orgId: string,
  ) {
    return this.aiService.ingestEmbedding({
      ...body,
      org_id: orgId,
    });
  }

  @Post('embeddings/search')
  async searchEmbeddings(
    @Body() body: {
      query: string;
      filters?: Record<string, any>;
      top_k?: number;
    },
    @OrganizationId() orgId: string,
  ) {
    return this.aiService.searchEmbeddings({
      ...body,
      org_id: orgId,
    });
  }
}
