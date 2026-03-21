import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractShare, Contract } from '../../database/entities';
import { ContractSharingController } from './contract-sharing.controller';
import { ContractSharingService } from './contract-sharing.service';

@Module({
  imports: [TypeOrmModule.forFeature([ContractShare, Contract])],
  controllers: [ContractSharingController],
  providers: [ContractSharingService],
  exports: [ContractSharingService],
})
export class ContractSharingModule {}
