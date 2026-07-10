import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractRelationshipType } from '../../database/entities';
import { ContractRelationshipTypesService } from './contract-relationship-types.service';
import { ContractRelationshipTypesController } from './contract-relationship-types.controller';

/**
 * Multi-tier trunk — Slice T0a. The relationship-type registry module.
 *
 * Exports ContractRelationshipTypesService so ContractsModule can validate
 * CreateContractDto.relationship_type against ACTIVE registry codes.
 * No dependency on ContractsModule (no cycle).
 */
@Module({
  imports: [TypeOrmModule.forFeature([ContractRelationshipType])],
  controllers: [ContractRelationshipTypesController],
  providers: [ContractRelationshipTypesService],
  exports: [ContractRelationshipTypesService],
})
export class ContractRelationshipTypesModule {}
