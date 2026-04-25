import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities';
import { AdminBillingService } from './admin-billing.service';
import { TransactionsQueryDto } from './dto';

@Controller('admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SYSTEM_ADMIN)
export class AdminBillingController {
  constructor(private readonly service: AdminBillingService) {}

  @Get('summary')
  getSummary() {
    return this.service.getSummary();
  }

  @Get('transactions')
  getTransactions(@Query() query: TransactionsQueryDto) {
    return this.service.getTransactions(query);
  }

  @Get('failed-payments')
  getFailedPayments() {
    return this.service.getFailedPayments();
  }

  @Get('transactions/export')
  async exportTransactions(
    @Query() query: TransactionsQueryDto,
    @Res() res: Response,
  ) {
    const rows = await this.service.exportTransactions(query);

    const header = [
      'id',
      'created_at',
      'organization_id',
      'organization_name',
      'plan_name',
      'amount',
      'currency',
      'status',
      'paymob_transaction_id',
    ];

    const escape = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'string' ? v : String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const lines: string[] = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          r.organization_id,
          r.organizationName,
          r.plan_name ?? '',
          r.amount,
          r.currency,
          r.status,
          r.paymob_transaction_id ?? '',
        ]
          .map(escape)
          .join(','),
      );
    }

    const csv = lines.join('\n');
    const filename = `sign-transactions-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send(csv);
  }
}
