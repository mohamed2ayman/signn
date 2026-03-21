import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ExportService } from './export.service';

@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('contracts/:id/pdf')
  async exportContractPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.exportService.generateContractPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="contract-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('contracts/:id/risk-report')
  async exportRiskReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.exportService.generateRiskReport(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="risk-report-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('contracts/:id/summary')
  async exportSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const fmt = format === 'json' ? 'json' : 'pdf';
    const result = await this.exportService.generateContractSummary(id, fmt);

    if (fmt === 'json') {
      res.json(result);
    } else {
      const buffer = result as Buffer;
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="summary-${id}.pdf"`,
        'Content-Length': buffer.length,
      });
      res.end(buffer);
    }
  }
}
