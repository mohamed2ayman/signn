import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Claim,
  ClaimDocument,
  ClaimResponse,
  ClaimStatusLog,
} from '../../database/entities/claim.entity';
import { Contract, ProjectMember, PermissionDefault } from '../../database/entities';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { PermissionLevelGuard } from '../../common/guards/permission-level.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Claim,
      ClaimDocument,
      ClaimResponse,
      ClaimStatusLog,
      Contract,
      ProjectMember,
      PermissionDefault,
    ]),
  ],
  controllers: [ClaimsController],
  providers: [ClaimsService, PermissionLevelGuard],
  exports: [ClaimsService],
})
export class ClaimsModule {}
