import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { LegalSource } from './legal-source.entity';

// ─── Enums ────────────────────────────────────────────────────────────────────
// Names are chosen to match the PostgreSQL enum type names created in the migration:
// legal_document_source_type_enum / legal_document_status_enum /
// legal_document_embedding_status_enum
// (explicit _enum suffix per lesson #143 — no ambiguity at ALTER TYPE time)

export enum LegalDocumentSourceType {
  PRIMARY_TEXT     = 'PRIMARY_TEXT',
  CURATED_SUMMARY  = 'CURATED_SUMMARY',
}

export enum LegalDocumentStatus {
  IN_FORCE = 'IN_FORCE',
  AMENDED  = 'AMENDED',
  REPEALED = 'REPEALED',
  DRAFT    = 'DRAFT',
}

export enum LegalDocumentEmbeddingStatus {
  PENDING    = 'PENDING',
  PROCESSING = 'PROCESSING',
  INDEXED    = 'INDEXED',
  FAILED     = 'FAILED',
}

// ─── Entity ───────────────────────────────────────────────────────────────────

@Entity('legal_documents')
export class LegalDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Core identity ──────────────────────────────────────────────────────────

  /** ISO-3166-1 alpha-2 jurisdiction code. Validated at DTO layer (@IsIn list). */
  @Column({ type: 'varchar', length: 10 })
  jurisdiction: string;

  @Column({
    type: 'enum',
    enum: LegalDocumentSourceType,
    enumName: 'legal_document_source_type_enum',
    default: LegalDocumentSourceType.PRIMARY_TEXT,
  })
  source_type: LegalDocumentSourceType;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  // ── Law reference ──────────────────────────────────────────────────────────

  /** e.g. '131' for Egyptian Civil Code Law 131/1948 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  law_number: string | null;

  /** Gregorian year of enactment. e.g. 1948 */
  @Column({ type: 'int', nullable: true })
  law_year: number | null;

  /** Full enactment date (Gregorian) when known. */
  @Column({ type: 'date', nullable: true })
  gregorian_date: string | null;

  /**
   * Hijri date stored as a string because PostgreSQL has no native Hijri type.
   * Format convention: 'YYYY-MM-DD' or partial 'YYYY' / 'YYYY-MM'.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  hijri_date: string | null;

  // ── Status ─────────────────────────────────────────────────────────────────

  @Column({
    type: 'enum',
    enum: LegalDocumentStatus,
    enumName: 'legal_document_status_enum',
    default: LegalDocumentStatus.IN_FORCE,
  })
  status: LegalDocumentStatus;

  // ── Language ───────────────────────────────────────────────────────────────

  /**
   * BCP-47-style language codes stored as a Postgres varchar array.
   * Examples: ['AR'], ['EN'], ['AR','EN']
   * TypeORM array columns use `type: 'varchar'` + `array: true`.
   */
  @Column({ type: 'varchar', length: 5, array: true, nullable: true })
  language: string[] | null;

  // ── Self-reference ─────────────────────────────────────────────────────────

  /** FK to parent law when this document is a regulation/amendment. */
  @Column({ type: 'uuid', nullable: true })
  parent_law_id: string | null;

  @ManyToOne(() => LegalDocument, (doc) => doc.child_documents, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_law_id' })
  parent_law: LegalDocument | null;

  @OneToMany(() => LegalDocument, (doc) => doc.parent_law)
  child_documents: LegalDocument[];

  // ── File storage ───────────────────────────────────────────────────────────

  /** Stored file URL from StorageService.uploadBuffer(). */
  @Column({ type: 'varchar', length: 1000, nullable: true })
  file_url: string | null;

  /** Human-readable original filename. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  file_name: string | null;

  /** SHA-256 hex digest of the raw PDF bytes. Used for dedup. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  content_hash: string | null;

  // ── Provenance ─────────────────────────────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  source_url: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  source_attribution: string | null;

  /** FK to the publisher source catalogue (carries the visual-order flag). */
  @Column({ type: 'uuid', nullable: true })
  source_id: string | null;

  @ManyToOne(() => LegalSource, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_id' })
  source: LegalSource | null;

  // ── Embedding pipeline ─────────────────────────────────────────────────────

  @Column({
    type: 'enum',
    enum: LegalDocumentEmbeddingStatus,
    enumName: 'legal_document_embedding_status_enum',
    default: LegalDocumentEmbeddingStatus.PENDING,
  })
  embedding_status: LegalDocumentEmbeddingStatus;

  /** Last pipeline error message — set on any failure stage. */
  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  /** Full extracted text — persisted for re-chunking and admin review. */
  @Column({ type: 'text', nullable: true })
  extracted_text: string | null;

  /** Job ID for the in-flight text extraction Celery task. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  extraction_job_id: string | null;

  /** Job ID for the in-flight embedding Celery task. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  embedding_job_id: string | null;

  // ── Audit ──────────────────────────────────────────────────────────────────

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
