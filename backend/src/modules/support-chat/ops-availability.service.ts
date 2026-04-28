import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  OpsAvailability,
  OpsAvailabilityStatus,
  User,
} from '../../database/entities';
import { RequestActor } from './support-chat.service';

const OPS_ROLES = new Set(['SYSTEM_ADMIN', 'OPERATIONS']);

@Injectable()
export class OpsAvailabilityService {
  constructor(
    @InjectRepository(OpsAvailability)
    private readonly repo: Repository<OpsAvailability>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getMine(actor: RequestActor): Promise<OpsAvailability> {
    this.assertOps(actor);
    let row = await this.repo.findOne({ where: { ops_id: actor.id } });
    if (!row) {
      row = this.repo.create({
        ops_id: actor.id,
        status: OpsAvailabilityStatus.OFFLINE,
      });
      row = await this.repo.save(row);
    }
    return row;
  }

  async setMine(
    actor: RequestActor,
    status: OpsAvailabilityStatus,
  ): Promise<OpsAvailability> {
    this.assertOps(actor);
    let row = await this.repo.findOne({ where: { ops_id: actor.id } });
    if (!row) {
      row = this.repo.create({ ops_id: actor.id, status });
    } else {
      row.status = status;
    }
    return this.repo.save(row);
  }

  /**
   * List ONLINE / AWAY ops members in the actor's org — used by the
   * transfer-chat modal to populate the recipient picker.
   */
  async listAvailableOps(actor: RequestActor): Promise<
    Array<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
      status: OpsAvailabilityStatus;
    }>
  > {
    this.assertOps(actor);

    const opsUsersQb = this.userRepo
      .createQueryBuilder('user')
      .where('user.role IN (:...roles)', {
        roles: ['SYSTEM_ADMIN', 'OPERATIONS'],
      });
    if (actor.organization_id && actor.role !== 'SYSTEM_ADMIN') {
      opsUsersQb.andWhere('user.organization_id = :orgId', {
        orgId: actor.organization_id,
      });
    }
    const opsUsers = await opsUsersQb.getMany();
    if (opsUsers.length === 0) return [];

    const availabilities = await this.repo.find({
      where: { ops_id: In(opsUsers.map((u) => u.id)) },
    });
    const byId = new Map(availabilities.map((a) => [a.ops_id, a.status]));

    return opsUsers
      .map((u) => ({
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        status: byId.get(u.id) ?? OpsAvailabilityStatus.OFFLINE,
      }))
      .filter(
        (u) =>
          u.status === OpsAvailabilityStatus.ONLINE ||
          u.status === OpsAvailabilityStatus.AWAY,
      );
  }

  private assertOps(actor: RequestActor): void {
    if (!OPS_ROLES.has(actor.role)) {
      throw new ForbiddenException('Operations role required');
    }
  }
}
