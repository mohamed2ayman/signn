import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PlaybookPosition } from '../../database/entities';
import { PlaybookController } from './playbook.controller';
import { PlaybookResolverService } from './playbook-resolver.service';
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
 * reaching for the repository directly.
 *
 * SLICE 2 adds `PlaybookResolverService` (scope precedence) and exports it as
 * the module's READ face for other modules — ComplianceModule imports this
 * module to feed resolved positions into the compliance knowledge context. The
 * CRUD surface (`PlaybookService`) stays the WRITE face and is not what
 * consumers should reach for.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PlaybookPosition])],
  controllers: [PlaybookController],
  providers: [PlaybookService, PlaybookResolverService],
  exports: [PlaybookService, PlaybookResolverService],
})
export class PlaybookModule {}
