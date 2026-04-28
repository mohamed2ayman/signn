import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { CannedResponse } from '../../database/entities';
import { RequestActor } from './support-chat.service';

const OPS_ROLES = new Set(['SYSTEM_ADMIN', 'OPERATIONS']);

@Injectable()
export class CannedResponseService {
  constructor(
    @InjectRepository(CannedResponse)
    private readonly repo: Repository<CannedResponse>,
  ) {}

  async list(actor: RequestActor): Promise<CannedResponse[]> {
    this.assertOps(actor);
    // Return both global and the actor's org responses, with org overrides
    // shadowing global ones (we still return both so the UI can label them).
    return this.repo.find({
      where: actor.organization_id
        ? [
            { organization_id: IsNull() },
            { organization_id: actor.organization_id },
          ]
        : [{ organization_id: IsNull() }],
      order: { shortcut: 'ASC' },
    });
  }

  async create(
    actor: RequestActor,
    data: { shortcut: string; title: string; body: string },
  ): Promise<CannedResponse> {
    this.assertOps(actor);

    const shortcut = this.normalizeShortcut(data.shortcut);
    const orgId = actor.organization_id ?? null;

    const conflict = await this.repo.findOne({
      where: {
        organization_id: orgId === null ? IsNull() : orgId,
        shortcut,
      } as any,
    });
    if (conflict) {
      throw new ConflictException(
        `Shortcut "${shortcut}" already exists in this scope`,
      );
    }

    const created = this.repo.create({
      organization_id: orgId,
      shortcut,
      title: data.title,
      body: data.body,
      created_by: actor.id,
    });
    return this.repo.save(created);
  }

  async update(
    id: string,
    actor: RequestActor,
    data: { shortcut?: string; title?: string; body?: string },
  ): Promise<CannedResponse> {
    this.assertOps(actor);
    const existing = await this.findScoped(id, actor);

    if (data.shortcut !== undefined) {
      existing.shortcut = this.normalizeShortcut(data.shortcut);
    }
    if (data.title !== undefined) existing.title = data.title;
    if (data.body !== undefined) existing.body = data.body;

    return this.repo.save(existing);
  }

  async remove(id: string, actor: RequestActor): Promise<void> {
    this.assertOps(actor);
    const existing = await this.findScoped(id, actor);
    await this.repo.remove(existing);
  }

  // ─── helpers ────────────────────────────────────────────────

  private async findScoped(
    id: string,
    actor: RequestActor,
  ): Promise<CannedResponse> {
    const found = await this.repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Canned response not found');

    // SYSTEM_ADMIN can edit any response (including globals).
    if (actor.role === 'SYSTEM_ADMIN') return found;

    // OPERATIONS can only edit their own org's responses.
    if (
      found.organization_id === null ||
      found.organization_id !== actor.organization_id
    ) {
      throw new ForbiddenException(
        'Cannot modify canned responses outside your organization',
      );
    }
    return found;
  }

  private normalizeShortcut(s: string): string {
    const trimmed = s.trim();
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }

  private assertOps(actor: RequestActor): void {
    if (!OPS_ROLES.has(actor.role)) {
      throw new ForbiddenException('Operations role required');
    }
  }
}
