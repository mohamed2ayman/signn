import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PermissionDefault } from '../../database/entities';
import { PermissionDefaultsController } from './permission-defaults.controller';
import { PermissionDefaultsService } from './permission-defaults.service';

@Module({
  imports: [TypeOrmModule.forFeature([PermissionDefault])],
  controllers: [PermissionDefaultsController],
  providers: [PermissionDefaultsService],
  exports: [PermissionDefaultsService],
})
export class PermissionDefaultsModule {}
