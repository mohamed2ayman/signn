import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum OpsAvailabilityStatus {
  ONLINE = 'ONLINE',
  AWAY = 'AWAY',
  OFFLINE = 'OFFLINE',
}

@Entity('ops_availability')
export class OpsAvailability {
  @PrimaryColumn({ type: 'uuid' })
  ops_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'ops_id' })
  ops: User;

  @Column({ type: 'varchar', length: 20, default: OpsAvailabilityStatus.OFFLINE })
  status: OpsAvailabilityStatus;

  @UpdateDateColumn({ type: 'timestamptz' })
  last_changed_at: Date;
}
