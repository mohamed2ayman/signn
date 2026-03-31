import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ProjectMember,
  User,
  PermissionLevel,
  JobTitle,
  JOB_TITLE_DEFAULT_PERMISSION,
  PermissionDefault,
} from '../../database/entities';

export const PERMISSION_LEVEL_KEY = 'requiredPermissionLevel';

/**
 * Hierarchy: APPROVER > EDITOR > COMMENTER > VIEWER
 * A user with APPROVER satisfies any requirement.
 */
const LEVEL_RANK: Record<PermissionLevel, number> = {
  [PermissionLevel.VIEWER]: 0,
  [PermissionLevel.COMMENTER]: 1,
  [PermissionLevel.EDITOR]: 2,
  [PermissionLevel.APPROVER]: 3,
};

@Injectable()
export class PermissionLevelGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    @InjectRepository(PermissionDefault)
    private readonly permissionDefaultRepository: Repository<PermissionDefault>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredLevel = this.reflector.getAllAndOverride<PermissionLevel>(
      PERMISSION_LEVEL_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permission level requirement is set, allow
    if (!requiredLevel) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as User;

    if (!user) {
      return false;
    }

    // SYSTEM_ADMIN and OPERATIONS bypass permission level checks
    if (user.role === 'SYSTEM_ADMIN' || user.role === 'OPERATIONS') {
      return true;
    }

    // OWNER_ADMIN bypasses permission level checks (top-level org admin)
    if (user.role === 'OWNER_ADMIN') {
      return true;
    }

    // Determine project ID from request params, query, or body
    const projectId =
      request.params?.project_id ||
      request.params?.id ||
      request.query?.project_id ||
      request.body?.project_id;

    if (!projectId) {
      // If we can't determine the project, fall back to allowing
      // (the endpoint may not be project-scoped)
      return true;
    }

    // Look up user's membership in this project
    const membership = await this.memberRepository.findOne({
      where: { project_id: projectId, user_id: user.id },
      relations: ['user'],
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this project');
    }

    // Resolve effective permission level
    const effectiveLevel = await this.resolveEffectivePermission(membership, user);

    // Check hierarchy
    const userRank = LEVEL_RANK[effectiveLevel] ?? 0;
    const requiredRank = LEVEL_RANK[requiredLevel] ?? 0;

    if (userRank < requiredRank) {
      throw new ForbiddenException(
        `This action requires ${requiredLevel} permission level. You have ${effectiveLevel}.`,
      );
    }

    // Attach effective permission to request for downstream use
    request.effectivePermissionLevel = effectiveLevel;
    return true;
  }

  /**
   * Resolve the effective permission level for a project member.
   * Priority: explicit override on ProjectMember > admin-configured default > hardcoded default
   */
  async resolveEffectivePermission(
    membership: ProjectMember,
    user: User,
  ): Promise<PermissionLevel> {
    // 1. If there's an explicit per-project override, use it
    if (membership.permission_level) {
      return membership.permission_level;
    }

    // 2. If user has a job title, look up the admin-configured default first
    if (user.job_title) {
      const adminDefault = await this.permissionDefaultRepository.findOne({
        where: { job_title: user.job_title },
      });

      if (adminDefault) {
        return adminDefault.permission_level as PermissionLevel;
      }

      // 3. Fall back to the hardcoded default for the job title
      const jobTitleEnum = Object.values(JobTitle).find(
        (jt) => jt === user.job_title,
      ) as JobTitle | undefined;

      if (jobTitleEnum && JOB_TITLE_DEFAULT_PERMISSION[jobTitleEnum]) {
        return JOB_TITLE_DEFAULT_PERMISSION[jobTitleEnum];
      }
    }

    // 4. Default to VIEWER if no job title or unrecognized job title
    return PermissionLevel.VIEWER;
  }
}
