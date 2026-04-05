import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { AiService } from './ai.service';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('risk-analysis')
  async triggerRiskAnalysis(
    @Body() body: {
      contract_id: string;
      clauses: Array<{ id: string; text: string }>;
      knowledge_context?: string;
    },
    @OrganizationId() orgId: string,
  ) {
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
    return this.aiService.triggerDiffAnalysis(body);
  }

  @Post('extract-obligations')
  async triggerExtractObligations(
    @Body() body: {
      contract_id: string;
      clauses: Array<{ id: string; text: string }>;
    },
  ) {
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
  ) {
    return this.aiService.triggerConflictDetection(body);
  }

  @Post('chat')
  async triggerChat(
    @Body() body: {
      message: string;
      contract_id?: string;
      history?: Array<{ role: string; content: string }>;
    },
    @OrganizationId() orgId: string,
  ) {
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
