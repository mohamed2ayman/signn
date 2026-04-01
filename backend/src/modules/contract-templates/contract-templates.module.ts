import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  KnowledgeAsset,
  Clause,
  ContractClause,
} from '../../database/entities';
import { ContractTemplatesService } from './contract-templates.service';
import { ContractTemplatesController } from './contract-templates.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeAsset, Clause, ContractClause]),
  ],
  controllers: [ContractTemplatesController],
  providers: [ContractTemplatesService],
  exports: [ContractTemplatesService],
})
export class ContractTemplatesModule {}
