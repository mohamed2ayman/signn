import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ProjectParty, Project } from '../../database/entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectPartiesController } from './project-parties.controller';
import { PublicPartiesController } from './public-parties.controller';
import { ProjectPartiesService } from './project-parties.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectParty, Project]),
    NotificationsModule,
  ],
  controllers: [ProjectPartiesController, PublicPartiesController],
  providers: [ProjectPartiesService],
  exports: [ProjectPartiesService],
})
export class ProjectPartiesModule {}
