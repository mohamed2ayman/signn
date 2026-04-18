import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';

import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { User, UserRole } from '../../database/entities';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  InviteUserDto,
  UpdateRoleDto,
  CreateOperationsUserDto,
} from './dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Put('me')
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Put('me/password')
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(userId, dto);
  }

  @Get()
  @Roles(UserRole.OWNER_ADMIN)
  async getOrgMembers(@OrganizationId() organizationId: string) {
    return this.usersService.getOrgMembers(organizationId);
  }

  @Post('invite')
  @Roles(UserRole.OWNER_ADMIN)
  async inviteUser(
    @OrganizationId() organizationId: string,
    @Body() dto: InviteUserDto,
    @CurrentUser() currentUser: User,
  ) {
    const inviterName =
      `${currentUser.first_name} ${currentUser.last_name}`.trim() ||
      'A team member';
    return this.usersService.inviteUser(organizationId, dto, inviterName);
  }

  @Put(':id/role')
  @Roles(UserRole.OWNER_ADMIN)
  async updateUserRole(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.usersService.updateUserRole(userId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER_ADMIN)
  async deactivateUser(@Param('id', ParseUUIDPipe) userId: string) {
    return this.usersService.deactivateUser(userId);
  }

  // ─── Admin-only endpoints ─────────────────────────────────────

  /**
   * GET /users/check-email?email=X
   * Real-time uniqueness check used by the "Add Operations Member" modal.
   */
  @Get('check-email')
  @Roles(UserRole.SYSTEM_ADMIN)
  async checkEmail(@Query('email') email: string) {
    return this.usersService.checkEmailExists(email);
  }

  /**
   * GET /users/admin/all?role=OPERATIONS
   * Returns all users (or filtered by role) with computed invitation_status.
   */
  @Get('admin/all')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  async getAllUsersForAdmin(@Query('role') role?: string) {
    return this.usersService.getAllUsersForAdmin(role);
  }

  /**
   * POST /users/admin/create-operations
   * Creates a new Operations team member, hashes their temp password, and
   * dispatches an invitation email.
   */
  @Post('admin/create-operations')
  @Roles(UserRole.SYSTEM_ADMIN)
  async createOperationsUser(
    @Body() dto: CreateOperationsUserDto,
    @CurrentUser() currentUser: User,
  ) {
    const inviterName =
      `${currentUser.first_name} ${currentUser.last_name}`.trim() ||
      'SIGN Admin';
    return this.usersService.createOperationsUser(dto, inviterName);
  }

  /**
   * POST /users/:id/resend-invitation
   * Regenerates the invitation token + temp password, resets invitation_sent_at,
   * and re-dispatches the email.
   */
  @Post(':id/resend-invitation')
  @Roles(UserRole.SYSTEM_ADMIN)
  async resendInvitation(
    @Param('id', ParseUUIDPipe) userId: string,
    @CurrentUser() currentUser: User,
  ) {
    const inviterName =
      `${currentUser.first_name} ${currentUser.last_name}`.trim() ||
      'SIGN Admin';
    return this.usersService.resendInvitation(userId, inviterName);
  }

  @Post(':id/mfa/reset')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.OPERATIONS)
  async adminResetUserMfa(@Param('id', ParseUUIDPipe) userId: string) {
    return this.usersService.adminResetUserMfa(userId);
  }
}
