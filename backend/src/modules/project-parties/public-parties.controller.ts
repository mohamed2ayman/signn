import {
  Controller,
  Get,
  Post,
  Body,
  Param,
} from '@nestjs/common';
import { ProjectPartiesService } from './project-parties.service';
import { AcceptPartyInvitationDto } from './dto/accept-invitation.dto';

@Controller('public/parties')
export class PublicPartiesController {
  constructor(
    private readonly projectPartiesService: ProjectPartiesService,
  ) {}

  @Get('invitation/:token')
  async getInvitationDetails(@Param('token') token: string) {
    return this.projectPartiesService.findByInvitationToken(token);
  }

  @Post('invitation/accept')
  async acceptInvitation(@Body() dto: AcceptPartyInvitationDto) {
    return this.projectPartiesService.acceptInvitation(
      dto.invitation_token,
      {
        name: dto.name,
        contact_person: dto.contact_person,
        phone: dto.phone,
      },
    );
  }
}
