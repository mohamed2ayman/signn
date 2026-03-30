import { SetMetadata } from '@nestjs/common';
import { PermissionLevel } from '../../database/entities';
import { PERMISSION_LEVEL_KEY } from '../guards/permission-level.guard';

/**
 * Decorator to require a minimum permission level for a route handler.
 * Works alongside existing @Roles() decorator — both must pass.
 *
 * Usage:
 *   @RequirePermission(PermissionLevel.EDITOR)   // write operations
 *   @RequirePermission(PermissionLevel.APPROVER)  // approvals & status transitions
 *   @RequirePermission(PermissionLevel.VIEWER)    // read-only
 */
export const RequirePermission = (level: PermissionLevel) =>
  SetMetadata(PERMISSION_LEVEL_KEY, level);
