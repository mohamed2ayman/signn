import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Obligation, ObligationStatus, User } from '../../../database/entities';
import { IcalExportService } from '../services/ical-export.service';

interface ObligationFilters {
  party?: string;
  type?: string;
  status?: ObligationStatus;
  from?: string;
  to?: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class ComplianceObligationsController {
  constructor(
    @InjectRepository(Obligation)
    private readonly obligationRepo: Repository<Obligation>,
    private readonly ical: IcalExportService,
  ) {}

  @Get('contracts/:contractId/obligations')
  async listForContract(
    @Param('contractId') contractId: string,
    @Query() filters: ObligationFilters,
  ): Promise<Obligation[]> {
    return this.applyFilters(
      this.obligationRepo
        .createQueryBuilder('o')
        .where('o.contract_id = :contractId', { contractId }),
      filters,
    )
      .orderBy('o.due_date', 'ASC')
      .getMany();
  }

  @Patch('contracts/:contractId/obligations/:obligationId')
  async update(
    @Param('obligationId') id: string,
    @Body() body: Partial<Obligation>,
    @CurrentUser() user: User,
  ): Promise<Obligation> {
    const o = await this.obligationRepo.findOne({ where: { id } });
    if (!o) throw new Error('Obligation not found');
    Object.assign(o, body);
    if (
      (body.status === ObligationStatus.MET ||
        body.status === ObligationStatus.COMPLETED) &&
      !o.completed_at
    ) {
      o.completed_at = new Date();
      o.completed_by = user.id;
    }
    return this.obligationRepo.save(o);
  }

  @Get('contracts/:contractId/obligations/ical')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async icalForContract(
    @Param('contractId') contractId: string,
    @Res() res: Response,
  ): Promise<void> {
    const items = await this.obligationRepo.find({
      where: { contract_id: contractId },
      relations: ['contract'],
    });
    const name = items[0]?.contract?.name
      ? `SIGN — ${items[0].contract.name}`
      : 'SIGN Obligations';
    const ics = this.ical.build({ name, obligations: items });
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sign-obligations-${contractId}.ics"`,
    );
    res.send(ics);
  }

  @Get('projects/:projectId/obligations')
  async listForProject(
    @Param('projectId') projectId: string,
    @Query() filters: ObligationFilters,
  ): Promise<Obligation[]> {
    return this.applyFilters(
      this.obligationRepo
        .createQueryBuilder('o')
        .leftJoinAndSelect('o.contract', 'c')
        .where('o.project_id = :projectId', { projectId }),
      filters,
    )
      .orderBy('o.due_date', 'ASC')
      .getMany();
  }

  // ─── Helpers ────────────────────────────────────────────

  private applyFilters<T>(qb: any, f: ObligationFilters): any {
    if (f.party) qb.andWhere('o.responsible_party = :party', { party: f.party });
    if (f.type) qb.andWhere('o.obligation_type = :type', { type: f.type });
    if (f.status) qb.andWhere('o.status = :status', { status: f.status });
    if (f.from && f.to) {
      qb.andWhere('o.due_date BETWEEN :from AND :to', {
        from: f.from,
        to: f.to,
      });
    } else if (f.from) {
      qb.andWhere('o.due_date >= :from', { from: f.from });
    } else if (f.to) {
      qb.andWhere('o.due_date <= :to', { to: f.to });
    }
    return qb;
  }
}
