import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PermissionLevel } from '../../database/entities';
import { DocuSignService } from './docusign.service';
import { InitiateSignatureDto } from './dto/initiate-signature.dto';

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionLevelGuard)
export class DocuSignController {
  constructor(private readonly docusignService: DocuSignService) {}

  @Post(':id/initiate-signature')
  @RequirePermission(PermissionLevel.APPROVER)
  async initiateSignature(
    @Param('id', ParseUUIDPipe) contractId: string,
    @Body() dto: InitiateSignatureDto,
    @CurrentUser() user: any,
    @Query('return_url') returnUrl?: string,
  ) {
    const frontendUrl =
      returnUrl || `${process.env.FRONTEND_URL || 'http://localhost:5173'}/app/contracts/${contractId}?signed=true`;

    return this.docusignService.initiateSignature(
      contractId,
      dto.signers,
      user.email,
      `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
      frontendUrl,
    );
  }

  @Get(':id/signing-url')
  async getSigningUrl(
    @Param('id', ParseUUIDPipe) contractId: string,
    @CurrentUser() user: any,
    @Query('return_url') returnUrl?: string,
  ) {
    const contract = await this.docusignService['contractRepo'].findOne({
      where: { id: contractId },
    });

    if (!contract?.docusign_envelope_id) {
      return { signingUrl: null, message: 'No signature envelope found' };
    }

    const url = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/app/contracts/${contractId}?signed=true`;

    try {
      const signingUrl = await this.docusignService.getSigningUrl(
        contract.docusign_envelope_id,
        user.email,
        `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
        returnUrl || url,
      );
      return { signingUrl };
    } catch {
      return { signingUrl: null, message: 'You are not a pending signer' };
    }
  }

  @Get(':id/signature-status')
  async getSignatureStatus(
    @Param('id', ParseUUIDPipe) contractId: string,
  ) {
    const contract = await this.docusignService['contractRepo'].findOne({
      where: { id: contractId },
    });

    if (!contract) {
      return { signature_status: null, signers: [] };
    }

    // If there's an envelope, try to get fresh status from DocuSign
    if (contract.docusign_envelope_id && contract.signature_status !== 'FULLY_EXECUTED') {
      try {
        const envelopeStatus = await this.docusignService.getEnvelopeStatus(
          contract.docusign_envelope_id,
        );
        return {
          signature_status: contract.signature_status,
          envelope_status: envelopeStatus.status,
          signers: envelopeStatus.signers,
          executed_at: contract.executed_at,
        };
      } catch {
        // Fall through to return stored data
      }
    }

    return {
      signature_status: contract.signature_status,
      signers: contract.signature_signers || [],
      executed_at: contract.executed_at,
    };
  }
}
