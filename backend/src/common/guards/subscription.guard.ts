import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OrganizationSubscription,
  SubscriptionStatus,
  Project,
  User,
  Contract,
} from '../../database/entities';

export const SUBSCRIPTION_CHECK_KEY = 'subscription_check';

export type SubscriptionCheckType =
  | 'max_projects'
  | 'max_users'
  | 'max_contracts_per_project';

/**
 * Guard that enforces subscription plan limits.
 * Use with @SetMetadata(SUBSCRIPTION_CHECK_KEY, 'max_projects') decorator.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(OrganizationSubscription)
    private readonly subscriptionRepository: Repository<OrganizationSubscription>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const checkType = this.reflector.getAllAndOverride<SubscriptionCheckType>(
      SUBSCRIPTION_CHECK_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!checkType) {
      return true; // No subscription check required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.organization_id) {
      return true; // No org = no subscription to enforce
    }

    const subscription = await this.subscriptionRepository.findOne({
      where: {
        organization_id: user.organization_id,
        status: SubscriptionStatus.ACTIVE,
      },
      relations: ['plan'],
      order: { created_at: 'DESC' },
    });

    if (!subscription || !subscription.plan) {
      throw new ForbiddenException({
        message: 'No active subscription found',
        code: 'NO_SUBSCRIPTION',
      });
    }

    // Check if subscription is expired
    if (new Date(subscription.end_date) < new Date()) {
      throw new ForbiddenException({
        message: 'Your subscription has expired',
        code: 'SUBSCRIPTION_EXPIRED',
      });
    }

    const plan = subscription.plan;

    switch (checkType) {
      case 'max_projects': {
        const projectCount = await this.projectRepository.count({
          where: { organization_id: user.organization_id },
        });
        if (projectCount >= plan.max_projects) {
          throw new ForbiddenException({
            message: `You have reached the maximum number of projects (${plan.max_projects}) for your plan`,
            code: 'PLAN_LIMIT_PROJECTS',
            limit: plan.max_projects,
            current: projectCount,
          });
        }
        break;
      }

      case 'max_users': {
        const userCount = await this.userRepository.count({
          where: { organization_id: user.organization_id, is_active: true },
        });
        if (userCount >= plan.max_users) {
          throw new ForbiddenException({
            message: `You have reached the maximum number of users (${plan.max_users}) for your plan`,
            code: 'PLAN_LIMIT_USERS',
            limit: plan.max_users,
            current: userCount,
          });
        }
        break;
      }

      case 'max_contracts_per_project': {
        const projectId = request.body?.project_id || request.params?.projectId;
        if (projectId) {
          const contractCount = await this.contractRepository.count({
            where: { project_id: projectId },
          });
          if (contractCount >= plan.max_contracts_per_project) {
            throw new ForbiddenException({
              message: `You have reached the maximum number of contracts per project (${plan.max_contracts_per_project}) for your plan`,
              code: 'PLAN_LIMIT_CONTRACTS',
              limit: plan.max_contracts_per_project,
              current: contractCount,
            });
          }
        }
        break;
      }
    }

    return true;
  }
}
