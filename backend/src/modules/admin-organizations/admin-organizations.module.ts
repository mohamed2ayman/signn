import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Organization,
  OrganizationSubscription,
  User,
  Project,
  Contract,
  AuditLog,
} from '../../database/entities';
import { AdminOrganizationsController } from './admin-organizations.controller';
import { AdminOrganizationsService } from './admin-organizations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      OrganizationSubscription,
      User,
      Project,
      Contract,
      AuditLog,
    ]),
  ],
  controllers: [AdminOrganizationsController],
  providers: [AdminOrganizationsService],
})
export class AdminOrganizationsModule {}
