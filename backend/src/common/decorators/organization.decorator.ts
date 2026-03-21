import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const OrganizationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.organization_id;
  },
);
