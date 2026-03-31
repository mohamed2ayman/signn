import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Contract, ProjectMember, PermissionDefault } from '../../database/entities';
import { ExportModule } from '../export/export.module';
import { DocuSignService } from './docusign.service';
import { DocuSignController } from './docusign.controller';
import { DocuSignWebhookController } from './docusign-webhook.controller';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Contract, ProjectMember, PermissionDefault]),
    ExportModule,
  ],
  controllers: [DocuSignController, DocuSignWebhookController],
  providers: [DocuSignService, PermissionLevelGuard],
  exports: [DocuSignService],
})
export class DocuSignModule {}
