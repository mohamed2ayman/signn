import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditLog } from '../../database/entities';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip } = request;
    const user = request.user;

    const entityType = this.extractEntityType(url);

    return next.handle().pipe(
      tap(async () => {
        try {
          const auditLog = this.auditLogRepository.create({
            user_id: user?.id ?? null,
            organization_id: user?.organization_id ?? null,
            action: `${method} ${url}`,
            entity_type: entityType,
            ip_address: ip || request.headers['x-forwarded-for'] || null,
          });

          await this.auditLogRepository.save(auditLog);
        } catch {
          // Silently fail to prevent audit logging from breaking the request
        }
      }),
    );
  }

  private extractEntityType(url: string): string | null {
    // Extract entity type from URL path, e.g., /api/v1/contracts -> contracts
    const segments = url.split('/').filter(Boolean);
    const apiIndex = segments.indexOf('api');

    if (apiIndex !== -1 && segments.length > apiIndex + 2) {
      return segments[apiIndex + 2];
    }

    // Fallback: use the last meaningful path segment
    return segments.length > 0 ? segments[segments.length - 1] : null;
  }
}
