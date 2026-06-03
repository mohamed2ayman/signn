import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';

import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ViewerCredentialGuard } from '../guards/viewer-credential.guard';

/**
 * Phase 7.18 bucket 1b-i — read-only viewer portal.
 *
 * Authorization: Viewer <token> ONLY. No JwtAuthGuard.
 *
 * The viewer credential is bound to ONE contract_id. ContractAccessService
 * enforces that the requested :id matches the bound id; anything else
 * returns 404 (per the assertContractInOrg convention).
 *
 * The response shape is identical to the existing managing-user contract
 * read — same joins, same sensitive-field scrub on creator/approver, same
 * contract_clauses payload including the existing AI clause classification
 * (zero new cost, per spec decision 2).
 *
 * THIS CONTROLLER IS READ-ONLY. Do NOT add write methods here. 1b-i
 * builds the read path only; write capabilities (comments, version
 * upload, sign) are gated behind durable identity (1b-ii) and ops-
 * configurable per-org quotas (later buckets).
 */
@Controller('viewer/contracts')
@UseGuards(ViewerCredentialGuard)
export class ViewerPortalController {
  constructor(private readonly contractAccess: ContractAccessService) {}

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() viewer: any,
  ) {
    return this.contractAccess.findAccessibleContract(id, viewer);
  }
}
