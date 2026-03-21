import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

import {
  SubscriptionPlan,
  OrganizationSubscription,
  SubscriptionStatus,
  Organization,
} from '../../database/entities';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly subscriptionPlanRepository: Repository<SubscriptionPlan>,
    @InjectRepository(OrganizationSubscription)
    private readonly organizationSubscriptionRepository: Repository<OrganizationSubscription>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly configService: ConfigService,
  ) {}

  async getPlans(): Promise<SubscriptionPlan[]> {
    return this.subscriptionPlanRepository.find({
      where: { is_active: true },
      order: { price: 'ASC' },
    });
  }

  async getAllPlans(): Promise<SubscriptionPlan[]> {
    return this.subscriptionPlanRepository.find({
      order: { created_at: 'DESC' },
    });
  }

  async createPlan(dto: CreatePlanDto): Promise<SubscriptionPlan> {
    const plan = this.subscriptionPlanRepository.create({
      name: dto.name,
      description: dto.description,
      price: dto.price,
      currency: dto.currency ?? 'USD',
      duration_days: dto.duration_days,
      max_projects: dto.max_projects,
      max_users: dto.max_users,
      max_contracts_per_project: dto.max_contracts_per_project,
      features: dto.features,
      is_active: dto.is_active ?? true,
    });

    return this.subscriptionPlanRepository.save(plan);
  }

  async updatePlan(id: string, dto: UpdatePlanDto): Promise<SubscriptionPlan> {
    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id },
    });

    if (!plan) {
      throw new NotFoundException('Subscription plan not found');
    }

    Object.assign(plan, dto);

    return this.subscriptionPlanRepository.save(plan);
  }

  async getOrgSubscription(
    orgId: string,
  ): Promise<OrganizationSubscription | null> {
    return this.organizationSubscriptionRepository.findOne({
      where: {
        organization_id: orgId,
        status: SubscriptionStatus.ACTIVE,
      },
      relations: ['plan'],
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Create a Paymob payment intention for a subscription plan.
   * Returns the payment_key and iframe_id for the frontend to embed.
   */
  async createPaymentIntention(
    orgId: string,
    planId: string,
  ): Promise<{ payment_key: string; iframe_id: string; order_id: string }> {
    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id: planId },
    });
    if (!plan) {
      throw new NotFoundException('Subscription plan not found');
    }

    const paymobApiKey = this.configService.get<string>('PAYMOB_API_KEY', '');
    const iframeId = this.configService.get<string>('PAYMOB_IFRAME_ID', '');
    const integrationId = this.configService.get<string>(
      'PAYMOB_INTEGRATION_ID',
      '',
    );

    if (!paymobApiKey) {
      // Dev fallback — return mock data
      this.logger.warn('PAYMOB_API_KEY not set — returning mock payment intention');
      return {
        payment_key: 'mock_payment_key_for_dev',
        iframe_id: iframeId || 'mock_iframe',
        order_id: 'mock_order',
      };
    }

    try {
      // Step 1: Auth request
      const authResponse = await fetch('https://accept.paymob.com/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: paymobApiKey }),
      });
      const authData = await authResponse.json();
      const authToken = authData.token;

      // Step 2: Order registration
      const amountCents = Math.round(Number(plan.price) * 100);
      const orderResponse = await fetch(
        'https://accept.paymob.com/api/ecommerce/orders',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auth_token: authToken,
            delivery_needed: false,
            amount_cents: amountCents,
            currency: plan.currency || 'EGP',
            merchant_order_id: `${orgId}:${planId}`,
            items: [
              {
                name: plan.name,
                amount_cents: amountCents,
                quantity: 1,
                description: plan.description || `${plan.name} subscription`,
              },
            ],
          }),
        },
      );
      const orderData = await orderResponse.json();

      // Step 3: Payment key
      const paymentKeyResponse = await fetch(
        'https://accept.paymob.com/api/acceptance/payment_keys',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auth_token: authToken,
            amount_cents: amountCents,
            expiration: 3600,
            order_id: orderData.id,
            billing_data: {
              first_name: 'Sign',
              last_name: 'User',
              email: 'user@signplatform.com',
              phone_number: '+0000000000',
              apartment: 'N/A',
              floor: 'N/A',
              street: 'N/A',
              building: 'N/A',
              shipping_method: 'N/A',
              postal_code: 'N/A',
              city: 'N/A',
              country: 'N/A',
              state: 'N/A',
            },
            currency: plan.currency || 'EGP',
            integration_id: parseInt(integrationId, 10),
          }),
        },
      );
      const paymentKeyData = await paymentKeyResponse.json();

      return {
        payment_key: paymentKeyData.token,
        iframe_id: iframeId,
        order_id: String(orderData.id),
      };
    } catch (error) {
      this.logger.error('Paymob payment intention failed', error);
      throw new BadRequestException('Failed to create payment intention');
    }
  }

  async activateSubscription(
    orgId: string,
    planId: string,
    paymobId?: string,
  ): Promise<OrganizationSubscription> {
    const organization = await this.organizationRepository.findOne({
      where: { id: orgId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException('Subscription plan not found');
    }

    if (!plan.is_active) {
      throw new BadRequestException('This subscription plan is no longer active');
    }

    // Deactivate any existing active subscriptions
    await this.organizationSubscriptionRepository.update(
      { organization_id: orgId, status: SubscriptionStatus.ACTIVE },
      { status: SubscriptionStatus.INACTIVE },
    );

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.duration_days);

    const subscription = this.organizationSubscriptionRepository.create({
      organization_id: orgId,
      plan_id: planId,
      status: SubscriptionStatus.ACTIVE,
      start_date: startDate,
      end_date: endDate,
      paymob_subscription_id: paymobId ?? null,
    });

    return this.organizationSubscriptionRepository.save(subscription);
  }

  async handlePaymobWebhook(
    payload: Record<string, any>,
  ): Promise<{ success: boolean }> {
    const hmacSecret = this.configService.get<string>('PAYMOB_HMAC_SECRET');

    if (!hmacSecret) {
      this.logger.error('PAYMOB_HMAC_SECRET is not configured');
      throw new BadRequestException('Webhook configuration error');
    }

    // Verify HMAC signature
    const receivedHmac = payload.hmac;
    if (!receivedHmac) {
      throw new BadRequestException('Missing HMAC signature');
    }

    // Build the HMAC verification string from Paymob's expected fields
    const obj = payload.obj;
    if (!obj) {
      throw new BadRequestException('Invalid webhook payload');
    }

    const hmacFields = [
      obj.amount_cents,
      obj.created_at,
      obj.currency,
      obj.error_occured,
      obj.has_parent_transaction,
      obj.id,
      obj.integration_id,
      obj.is_3d_secure,
      obj.is_auth,
      obj.is_capture,
      obj.is_refunded,
      obj.is_standalone_payment,
      obj.is_voided,
      obj.order?.id,
      obj.owner,
      obj.pending,
      obj.source_data?.pan,
      obj.source_data?.sub_type,
      obj.source_data?.type,
      obj.success,
    ]
      .map((val) => String(val ?? ''))
      .join('');

    const computedHmac = crypto
      .createHmac('sha512', hmacSecret)
      .update(hmacFields)
      .digest('hex');

    if (computedHmac !== receivedHmac) {
      this.logger.warn('Invalid HMAC signature in Paymob webhook');
      throw new BadRequestException('Invalid HMAC signature');
    }

    // Process the payment
    if (obj.success === true || obj.success === 'true') {
      const orderId = obj.order?.id?.toString();
      const merchantOrderId = obj.order?.merchant_order_id;

      if (merchantOrderId) {
        // merchant_order_id format expected: "orgId:planId"
        const parts = merchantOrderId.split(':');
        if (parts.length === 2) {
          const [orgId, planId] = parts;
          try {
            await this.activateSubscription(orgId, planId, orderId);
            this.logger.log(
              `Subscription activated for org ${orgId} via Paymob webhook`,
            );
          } catch (error) {
            this.logger.error(
              `Failed to activate subscription for org ${orgId}`,
              error,
            );
          }
        }
      }
    }

    return { success: true };
  }
}
