import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  Contract,
  ContractClause,
  ContractVersion,
  ContractComment,
  ContractorResponse,
} from '../../database/entities';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      ContractClause,
      ContractVersion,
      ContractComment,
      ContractorResponse,
    ]),
  ],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
