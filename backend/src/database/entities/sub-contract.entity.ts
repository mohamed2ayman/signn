import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { Contract, ContractStatus } from './contract.entity';
import { Organization } from './organization.entity';

@Entity('sub_contracts')
export class SubContract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  main_contract_id: string;

  @ManyToOne(() => Contract)
  @JoinColumn({ name: 'main_contract_id' })
  mainContract: Contract;

  @Column({ type: 'varchar', length: 50 })
  subcontract_number: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  scope_description: string;

  @Column({ type: 'uuid' })
  org_id: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'org_id' })
  organization: Organization;

  @Column({ type: 'uuid' })
  created_by: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ type: 'varchar', length: 50, default: ContractStatus.DRAFT })
  status: ContractStatus;

  @Column({ type: 'varchar', length: 255 })
  subcontractor_name: string;

  @Column({ type: 'varchar', length: 255 })
  subcontractor_email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subcontractor_company: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  subcontractor_contact_phone: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  contract_value: number;

  @Column({ type: 'date', nullable: true })
  start_date: Date;

  @Column({ type: 'date', nullable: true })
  end_date: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => SubContractStatusLog, (l) => l.sub_contract)
  status_logs: SubContractStatusLog[];
}

@Entity('sub_contract_status_logs')
export class SubContractStatusLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sub_contract_id: string;

  @ManyToOne(() => SubContract, (s) => s.status_logs)
  @JoinColumn({ name: 'sub_contract_id' })
  sub_contract: SubContract;

  @Column({ type: 'uuid' })
  changed_by: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'changed_by' })
  changer: User;

  @Column({ type: 'varchar', length: 50 })
  previous_status: string;

  @Column({ type: 'varchar', length: 50 })
  new_status: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn({ type: 'timestamptz' })
  changed_at: Date;
}
