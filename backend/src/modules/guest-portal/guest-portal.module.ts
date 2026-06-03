import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ContractComment,
  GuestContractAccess,
  GuestInvitation,
  User,
} from '../../database/entities';
import { ContractsModule } from '../contracts/contracts.module';
import { AuthModule } from '../auth/auth.module';

import { InvitationTokenService } from './services/invitation-token.service';
import { ViewerCredentialService } from './services/viewer-credential.service';
import { GuestInvitationService } from './services/guest-invitation.service';
import { ViewerCredentialGuard } from './guards/viewer-credential.guard';

import { GuestInvitationsController } from './controllers/guest-invitations.controller';
import { PublicGuestInvitationController } from './controllers/public-guest-invitation.controller';
import { ViewerPortalController } from './controllers/viewer-portal.controller';
import { GuestCommentsController } from './controllers/guest-comments.controller';

/**
 * Phase 7.18 — Guest Portal module.
 *
 *   bucket 1a    — authorization spine (lives in ContractsModule)
 *   bucket 1b-i  — invitations + pre-password viewer (this module)
 *   bucket 1b-ii — viewer→guest-user identity transition + comment write
 *                  (this module, depends on AuthModule for JWT issuance)
 *
 * Depends on:
 *   ContractsModule — exports ContractAccessService (the single authority).
 *   AuthModule      — exports AuthService.issueGuestSession (1b-ii uses
 *                     the same generateTokens + _finalizeLogin path as
 *                     login / register / acceptInvitation).
 *
 * Entities registered here:
 *   GuestInvitation       — owned by this module (1b-i).
 *   GuestContractAccess   — owned by ContractsModule; reused here so the
 *                           atomic identity transition can write a binding
 *                           in the same transaction as the user insert.
 *   User, ContractComment — read-only consumers for the transaction +
 *                           the guest-comment write path.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GuestInvitation,
      GuestContractAccess,
      User,
      ContractComment,
    ]),
    ContractsModule,
    AuthModule,
  ],
  controllers: [
    GuestInvitationsController,
    PublicGuestInvitationController,
    ViewerPortalController,
    GuestCommentsController,
  ],
  providers: [
    InvitationTokenService,
    ViewerCredentialService,
    GuestInvitationService,
    ViewerCredentialGuard,
  ],
})
export class GuestPortalModule {}
