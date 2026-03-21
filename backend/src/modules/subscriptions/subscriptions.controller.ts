import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities';
import { SubscriptionsService } from './subscriptions.service';
import { CreatePlanDto, UpdatePlanDto } from './dto';

@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  /**
   * Public endpoint - no auth needed (used on registration page)
   */
  @Get('admin/subscription-plans')
  async getPlans() {
    return this.subscriptionsService.getPlans();
  }

  /**
   * Admin only - get all plans including inactive
   */
  @Get('admin/subscription-plans/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN)
  async getAllPlans() {
    return this.subscriptionsService.getAllPlans();
  }

  /**
   * Admin only - create a new subscription plan
   */
  @Post('admin/subscription-plans')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN)
  async createPlan(@Body() dto: CreatePlanDto) {
    return this.subscriptionsService.createPlan(dto);
  }

  /**
   * Admin only - update a subscription plan
   */
  @Put('admin/subscription-plans/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN)
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.subscriptionsService.updatePlan(id, dto);
  }

  /**
   * Create a Paymob payment intention (requires auth)
   */
  @Post('subscriptions/create-payment-intention')
  @UseGuards(JwtAuthGuard)
  async createPaymentIntention(
    @CurrentUser() user: any,
    @Body() body: { plan_id: string },
  ) {
    return this.subscriptionsService.createPaymentIntention(
      user.organization_id,
      body.plan_id,
    );
  }

  /**
   * Get current org subscription (requires auth)
   */
  @Get('subscriptions/current')
  @UseGuards(JwtAuthGuard)
  async getCurrentSubscription(@CurrentUser() user: any) {
    return this.subscriptionsService.getOrgSubscription(user.organization_id);
  }

  /**
   * Public webhook endpoint - verify HMAC internally
   */
  @Post('subscriptions/paymob-webhook')
  async handlePaymobWebhook(@Body() payload: Record<string, any>) {
    return this.subscriptionsService.handlePaymobWebhook(payload);
  }
}
