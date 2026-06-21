import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Contract } from './contract.entity';
import { ContractClause } from './contract-clause.entity';
import { User } from './user.entity';

@Entity('contract_comments')
export class ContractComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, (contract) => contract.comments)
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid', nullable: true })
  contract_clause_id: string;

  @ManyToOne(() => ContractClause, (cc) => cc.comments, { nullable: true })
  @JoinColumn({ name: 'contract_clause_id' })
  contract_clause: ContractClause;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'boolean', default: false })
  is_resolved: boolean;

  /**
   * Guest-visibility boundary (Guest Portal comments-list, feature #1).
   * FAIL-CLOSED: defaults to TRUE (internal). A comment is shown to an
   * external guest ONLY when this is `false`. Guest-authored comments are
   * written with `false` (a guest always sees their own comments); managing
   * comments default to internal and must be explicitly marked guest-visible.
   * The guest GET is a whitelist on `is_internal_note = false`; the managing
   * GET is unfiltered (org members see everything).
   */
  @Column({ type: 'boolean', default: true })
  is_internal_note: boolean;

  @Column({ type: 'uuid', nullable: true })
  parent_comment_id: string;

  @ManyToOne(() => ContractComment, { nullable: true })
  @JoinColumn({ name: 'parent_comment_id' })
  parent_comment: ContractComment;

  @OneToMany(() => ContractComment, (comment) => comment.parent_comment)
  replies: ContractComment[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
