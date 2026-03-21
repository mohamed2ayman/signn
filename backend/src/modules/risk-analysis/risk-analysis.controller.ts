import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities';
import { RiskAnalysisService } from './risk-analysis.service';
import { CreateRiskRuleDto, UpdateRiskStatusDto } from './dto';

@Controller('risk-analysis')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RiskAnalysisController {
  constructor(private readonly riskAnalysisService: RiskAnalysisService) {}

  @Get('contract/:contractId')
  async getByContract(
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ) {
    return this.riskAnalysisService.getByContract(contractId);
  }

  @Get('contract/:contractId/summary')
  async getRiskSummary(
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ) {
    return this.riskAnalysisService.getRiskSummary(contractId);
  }

  @Get('clause/:clauseId')
  async getByClause(
    @Param('clauseId', ParseUUIDPipe) clauseId: string,
  ) {
    return this.riskAnalysisService.getByClause(clauseId);
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRiskStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.riskAnalysisService.updateRiskStatus(id, dto, user.id);
  }

  @Get('rules')
  async getRules(@Query('active_only') activeOnly?: string) {
    return this.riskAnalysisService.getRules(
      activeOnly !== 'false',
    );
  }

  @Post('rules')
  @Roles(UserRole.SYSTEM_ADMIN)
  async createRule(
    @Body() dto: CreateRiskRuleDto,
    @CurrentUser() user: any,
  ) {
    return this.riskAnalysisService.createRule(dto, user.id);
  }

  @Put('rules/:id')
  @Roles(UserRole.SYSTEM_ADMIN)
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<CreateRiskRuleDto> & { is_active?: boolean },
  ) {
    return this.riskAnalysisService.updateRule(id, dto);
  }

  @Delete('rules/:id')
  @Roles(UserRole.SYSTEM_ADMIN)
  async deleteRule(@Param('id', ParseUUIDPipe) id: string) {
    await this.riskAnalysisService.deleteRule(id);
    return { message: 'Risk rule deactivated' };
  }

  @Get('categories')
  async getCategories() {
    return this.riskAnalysisService.getCategories();
  }
}
