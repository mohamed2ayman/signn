import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Contract } from '../../database/entities';
import { ContractScopedRepository } from './contract-scoped.repository';

/**
 * Option B — S1: the scoped-repository module.
 *
 * Houses the data-layer tenancy chokepoint. In S1 it provides exactly one
 * concrete repository — {@link ContractScopedRepository} (the Contract ROOT).
 * Child-entity scoped repositories are added here in later buckets; the ESLint
 * lint that bans bare contract-repo access (and routes everything through this
 * module) is the final bucket.
 *
 * Consumers import THIS module and inject `ContractScopedRepository` — they do
 * NOT inject `@InjectRepository(Contract)` for tenancy-scoped loads. The wall
 * (`ContractAccessService`) stays where it is and is unaffected.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Contract])],
  providers: [ContractScopedRepository],
  exports: [ContractScopedRepository],
})
export class ScopedRepositoryModule {}
