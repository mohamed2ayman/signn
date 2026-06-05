import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ContractShare, Contract } from '../../database/entities';
import { User } from '../../database/entities/user.entity';
import { ProjectMember } from '../../database/entities/project-member.entity';
import { ContractSharingController } from './contract-sharing.controller';
import { ContractSharingService } from './contract-sharing.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ContractShare, Contract, User, ProjectMember]),
    NotificationsModule,
    ConfigModule,
  ],
  controllers: [ContractSharingController],
  providers: [ContractSharingService],
  exports: [ContractSharingService],
})
export class ContractSharingModule {}
