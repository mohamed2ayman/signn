import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Clause } from '../../database/entities';
import { ClausesController } from './clauses.controller';
import { ClausesService } from './clauses.service';

@Module({
  imports: [TypeOrmModule.forFeature([Clause])],
  controllers: [ClausesController],
  providers: [ClausesService],
  exports: [ClausesService],
})
export class ClausesModule {}
