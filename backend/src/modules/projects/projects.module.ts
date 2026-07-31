import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  Project,
  ProjectMember,
  Contract,
  ProjectParty,
  RiskAnalysis,
} from '../../database/entities';
import { PartyRolesModule } from '../contract-parties/party-roles.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectMember,
      Contract,
      ProjectParty,
      RiskAnalysis,
    ]),
    // Party Foundation Slice 1a — ProjectsService create()/update() validate
    // dto.default_party_role_code against ACTIVE party_roles registry codes.
    PartyRolesModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
