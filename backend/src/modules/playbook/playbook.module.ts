import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PlaybookPosition } from '../../database/entities';
import { PlaybookController } from './playbook.controller';
import { PlaybookService } from './playbook.service';

/**
 * 7.22 Slice 1 — Contract Playbook DATA LAYER.
 *
 * NOT @Global() — a domain module (lesson #113 rule 3). `forFeature` here is
 * also what registers PlaybookPosition with the runtime TypeORM connection
 * (app.module uses `autoLoadEntities: true`); the migration CLI picks it up
 * separately via the `database/entities/*.entity.ts` glob in data-source.ts.
 *
 * `PlaybookService` is EXPORTED so Slice 2's resolver can consume it without
 * reaching for the repository directly. Nothing imports it yet — no compliance,
 * AI, or frontend wiring exists in this slice by design.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PlaybookPosition])],
  controllers: [PlaybookController],
  providers: [PlaybookService],
  exports: [PlaybookService],
})
export class PlaybookModule {}
