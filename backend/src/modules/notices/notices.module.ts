import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Notice,
  NoticeDocument,
  NoticeResponse,
  NoticeStatusLog,
} from '../../database/entities/notice.entity';
import { Contract, ProjectMember, PermissionDefault } from '../../database/entities';
import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notice,
      NoticeDocument,
      NoticeResponse,
      NoticeStatusLog,
      Contract,
      ProjectMember,
      PermissionDefault,
    ]),
    // Tenant-isolation Tier 3 — ContractAccessService is the wall for
    // POST /notices + GET /notices?contract_id=.
    ContractsModule,
  ],
  controllers: [NoticesController],
  providers: [NoticesService, PermissionLevelGuard],
  exports: [NoticesService],
})
export class NoticesModule {}
