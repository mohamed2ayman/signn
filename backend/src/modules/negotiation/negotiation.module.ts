import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NegotiationEvent, Contract } from '../../database/entities';
import { NegotiationController } from './negotiation.controller';
import { NegotiationService } from './negotiation.service';
// Option B — Chokepoint migration (negotiation, 1 of 4): findHistory's LIST read
// goes through NegotiationEventScopedRepository, exported by this module.
import { ScopedRepositoryModule } from '../scoped-repository/scoped-repository.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NegotiationEvent, Contract]),
    ScopedRepositoryModule,
  ],
  controllers: [NegotiationController],
  providers: [NegotiationService],
  exports: [NegotiationService],
})
export class NegotiationModule {}
