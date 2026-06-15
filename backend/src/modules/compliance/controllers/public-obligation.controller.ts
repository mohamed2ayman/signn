import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Obligation,
  ObligationStatus,
} from '../../../database/entities';
import { ObligationTokenService } from '../services/obligation-token.service';

/**
 * Public, no-auth endpoint hit by the "Mark as Met" button in the
 * reminder email. The HMAC token in the query string proves the email
 * recipient owns the action.
 *
 *   GET /api/v1/public/obligations/mark-met?token=<HMAC>
 *
 * Path is under `/public/` to keep it well-separated from the
 * authenticated `/obligations/:id` surface.
 */
@Controller('public/obligations')
export class PublicObligationController {
  constructor(
    @InjectRepository(Obligation) // lint-exempt: system/no-orgId by design
    private readonly obligationRepo: Repository<Obligation>,
    private readonly tokens: ObligationTokenService,
    private readonly configService: ConfigService,
  ) {}

  @Get('mark-met')
  async markMet(
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const verified = this.tokens.verify(token ?? '');
    if (!verified.ok || !verified.payload) {
      res.status(410).type('html').send(this.errorPage(verified.reason ?? 'invalid'));
      return;
    }

    const o = await this.obligationRepo.findOne({ // lint-exempt: system/no-orgId by design
      where: { id: verified.payload.obligation_id },
    });
    if (!o) {
      res.status(404).type('html').send(this.errorPage('not_found'));
      return;
    }
    if (
      o.status === ObligationStatus.MET ||
      o.status === ObligationStatus.COMPLETED
    ) {
      res.type('html').send(this.successPage(o.description, /* alreadyMet= */ true));
      return;
    }
    o.status = ObligationStatus.MET;
    o.completed_at = new Date();
    o.completed_by = verified.payload.user_id;
    await this.obligationRepo.save(o); // lint-exempt: system/no-orgId by design
    res.type('html').send(this.successPage(o.description, false));
  }

  private successPage(description: string, alreadyMet: boolean): string {
    const msg = alreadyMet
      ? 'This obligation was already marked as complete.'
      : 'Obligation marked as complete.';
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>SIGN — Obligation Updated</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:480px;margin:80px auto;padding:24px;color:#0F1729;text-align:center;}
.brand{font-size:28px;font-weight:700;color:#4F6EF7;margin-bottom:24px;}
.icon{font-size:64px;color:#059669;margin-bottom:16px;}
h1{font-size:22px;margin:0 0 12px;}
p{color:#6B7280;line-height:1.5;}
a{display:inline-block;margin-top:24px;padding:12px 24px;background:#4F6EF7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;}</style>
</head><body>
<div class="brand">SIGN</div>
<div class="icon">✓</div>
<h1>${msg}</h1>
<p>${this.escape(description)}</p>
<a href="${this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173')}/app/dashboard">View dashboard</a>
</body></html>`;
  }

  private errorPage(reason: string): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>SIGN — Link Expired</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:480px;margin:80px auto;padding:24px;color:#0F1729;text-align:center;}
.brand{font-size:28px;font-weight:700;color:#4F6EF7;margin-bottom:24px;}
.icon{font-size:48px;color:#DC2626;margin-bottom:16px;}
p{color:#6B7280;line-height:1.5;}</style>
</head><body>
<div class="brand">SIGN</div>
<div class="icon">⚠</div>
<h1>Link no longer valid</h1>
<p>This mark-as-met link is ${this.escape(reason)}. Please update the obligation directly inside SIGN.</p>
</body></html>`;
  }

  private escape(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
