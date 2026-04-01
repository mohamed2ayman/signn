import { Controller, Get, UseGuards } from '@nestjs/common';
import { ContractTemplatesService } from './contract-templates.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('contract-templates')
@UseGuards(JwtAuthGuard)
export class ContractTemplatesController {
  constructor(
    private readonly contractTemplatesService: ContractTemplatesService,
  ) {}

  @Get()
  async listTemplates() {
    return this.contractTemplatesService.listTemplates();
  }
}
