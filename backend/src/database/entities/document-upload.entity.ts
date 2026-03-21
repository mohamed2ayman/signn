import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { Organization } from './organization.entity';
import { User } from './user.entity';

export enum DocumentProcessingStatus {
  UPLOADED = 'UPLOADED',
  EXTRACTING_TEXT = 'EXTRACTING_TEXT',
  TEXT_EXTRACTED = 'TEXT_EXTRACTED',
  EXTRACTING_CLAUSES = 'EXTRACTING_CLAUSES',
  CLAUSES_EXTRACTED = 'CLAUSES_EXTRACTED',
  FAILED = 'FAILED',
}

@Entity('document_uploads')
export class DocumentUpload {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, (contract) => contract.documents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid' })
  organization_id: string;

  @ManyToOne(() => Organization, { nullable: false })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'varchar', length: 1000 })
  file_url: string;

  @Column({ type: 'varchar', length: 500 })
  file_name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  original_name: string | null;

  @Column({ type: 'int', nullable: true })
  file_size: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mime_type: string | null;

  @Column({ type: 'int', default: 0 })
  document_priority: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  document_label: string | null;

  @Column({
    type: 'enum',
    enum: DocumentProcessingStatus,
    default: DocumentProcessingStatus.UPLOADED,
  })
  processing_status: DocumentProcessingStatus;

  @Column({ type: 'text', nullable: true })
  extracted_text: string | null;

  @Column({ type: 'int', nullable: true })
  page_count: number | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  processing_job_id: string | null;

  @Column({ type: 'uuid' })
  uploaded_by: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'uploaded_by' })
  uploader: User;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
