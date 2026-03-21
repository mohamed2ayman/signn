import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Contract } from './contract.entity';

@Entity('contract_shares')
export class ContractShare {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid' })
  shared_by: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'shared_by' })
  sharer: User;

  @Column({ type: 'varchar', length: 255 })
  shared_with_email: string;

  @Column({ type: 'varchar', length: 20, default: 'view' })
  permission: string; // 'view' | 'comment' | 'edit'

  @Column({ type: 'varchar', length: 255, unique: true })
  token: string;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  accessed_at: Date;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
