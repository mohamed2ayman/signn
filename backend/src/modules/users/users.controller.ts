import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';

import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { UserRole } from '../../database/entities';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  InviteUserDto,
  UpdateRoleDto,
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
  ) {
    return this.usersService.inviteUser(organizationId, dto);
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
}
