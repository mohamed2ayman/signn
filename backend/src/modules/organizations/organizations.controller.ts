import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto, UploadPolicyDto } from './dto';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('me')
  async getMyOrganization(@OrganizationId() orgId: string) {
    return this.organizationsService.getMyOrganization(orgId);
  }

  @Put('me')
  async updateOrganization(
    @OrganizationId() orgId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.updateOrganization(orgId, dto);
  }

  @Post('me/policies')
  @UseInterceptors(FileInterceptor('file'))
  async uploadOrgPolicy(
    @OrganizationId() orgId: string,
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadPolicyDto,
  ) {
    return this.organizationsService.uploadOrgPolicy(orgId, user.id, file, dto);
  }
}
