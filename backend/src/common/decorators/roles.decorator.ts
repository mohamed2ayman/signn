import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../database/entities';

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);
