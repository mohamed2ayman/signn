import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ContractComment,
  GuestContractAccess,
  GuestInvitation,
  Project,
  User,
} from '../../database/entities';
import { ContractsModule } from '../contracts/contracts.module';
import { AuthModule } from '../auth/auth.module';
import { ScopedRepositoryModule } from '../scoped-repository/scoped-repository.module';
// Feature #3 — Guest Watermarked Download reuses ExportService.generateContractPdf
// (ExportModule exports it) to render the same contract PDF the managing path
// renders, plus a server-built watermark stamp.
import { ExportModule } from '../export/export.module';
// Feature #4 — Guest upload of a new contract version reuses
// DocumentProcessingService.uploadAndProcess (DocumentProcessingModule exports
// it) for the storage + metering + extraction lifecycle, and
// NotificationDispatchService (NotificationsModule) for the managing-party
// upload notice + the host at-limit notice.
import { DocumentProcessingModule } from '../document-processing/document-processing.module';
import { NotificationsModule } from '../notifications/notifications.module';
// Guest chat Slice 1 — guest-walled multi-turn AI chat. Reuses the host chat
// entities (ChatSession/ChatMessage), the AiModule dispatch→poll boundary,
// and the metering engine (guest_ai_query meter, subject = host org).
import { ChatSession } from '../../database/entities/chat-session.entity';
import { ChatMessage } from '../../database/entities/chat-message.entity';
import { AiModule } from '../ai/ai.module';
import { MeteringModule } from '../metering/metering.module';

import { InvitationTokenService } from './services/invitation-token.service';
import { ViewerCredentialService } from './services/viewer-credential.service';
import { GuestInvitationService } from './services/guest-invitation.service';
import { GuestUploadService } from './services/guest-upload.service';
import { GuestChatService } from './services/guest-chat.service';
// Feature #8d — "Import to my workspace": binding-walled transactional copy
// of a shared contract into the importer's own org (ContractsService's
// createVersionSnapshot rides the same transaction; Project registered for
// the destination-ownership check).
import { GuestImportService } from './services/guest-import.service';
import { ViewerCredentialGuard } from './guards/viewer-credential.guard';

import { GuestInvitationsController } from './controllers/guest-invitations.controller';
import { PublicGuestInvitationController } from './controllers/public-guest-invitation.controller';
import { ViewerPortalController } from './controllers/viewer-portal.controller';
import { GuestCommentsController } from './controllers/guest-comments.controller';
import { GuestDownloadController } from './controllers/guest-download.controller';
import { GuestUploadController } from './controllers/guest-upload.controller';
import { GuestStatusController } from './controllers/guest-status.controller';
import { GuestChatController } from './controllers/guest-chat.controller';
import { GuestMyContractsController } from './controllers/guest-my-contracts.controller';
import { GuestImportController } from './controllers/guest-import.controller';

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
      ChatSession,
      ChatMessage,
      // #8d — destination-project ownership check (Project is org-scoped
      // reference data here, not a contract-scoped entity).
      Project,
    ]),
    ContractsModule,
    AuthModule,
    // Option B chokepoint (migration 2/4): GuestInvitationService.revoke's
    // by-id read routes through GuestInvitationScopedRepository (layer 2),
    // under the inline findInOrg wall (layer 1).
    ScopedRepositoryModule,
    ExportModule,
    DocumentProcessingModule,
    NotificationsModule,
    AiModule,
    MeteringModule,
  ],
  controllers: [
    GuestInvitationsController,
    PublicGuestInvitationController,
    ViewerPortalController,
    GuestCommentsController,
    GuestDownloadController,
    GuestUploadController,
    GuestStatusController,
    GuestChatController,
    GuestMyContractsController,
    GuestImportController,
  ],
  providers: [
    InvitationTokenService,
    ViewerCredentialService,
    GuestInvitationService,
    GuestUploadService,
    GuestChatService,
    GuestImportService,
    ViewerCredentialGuard,
  ],
})
export class GuestPortalModule {}
