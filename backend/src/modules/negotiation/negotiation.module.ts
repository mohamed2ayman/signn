import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NegotiationEvent, Contract } from '../../database/entities';
import { NegotiationController } from './negotiation.controller';
import { NegotiationService } from './negotiation.service';

@Module({
  imports: [TypeOrmModule.forFeature([NegotiationEvent, Contract])],
  controllers: [NegotiationController],
  providers: [NegotiationService],
  exports: [NegotiationService],
})
export class NegotiationModule {}
