import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { LegalDocument } from './legal-document.entity';

/**
 * A single text chunk produced by the hybrid article-boundary chunker.
 *
 * The `embedding` column is managed EXCLUSIVELY by the Python Celery task
 * (`run_embed_legal_chunks`). NestJS:
 *   - INSERTs rows with embedding = NULL (TypeORM handles this via the entity)
 *   - READs with embedding via raw SQL (DataSource.query with `<=>` operator)
 *
 * The `embedding` column is therefore NOT mapped in this entity — TypeORM
 * does not need to read or write it; the column exists in the migration DDL,
 * and the raw SQL retrieval in LegalDocumentsService.retrieveRelevantChunks()
 * selects it explicitly.
 *
 * This avoids a dependency on a pgvector npm package that is not installed
 * and avoids storing float arrays through text-cast transformers that would
 * break pgvector's native ANN acceleration.
 */
@Entity('legal_document_chunks')
export class LegalDocumentChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  legal_document_id: string;

  @ManyToOne(() => LegalDocument, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'legal_document_id' })
  legal_document: LegalDocument;

  /**
   * Denormalised jurisdiction for index-only pre-filter.
   * WHERE jurisdiction = 'EG' before the vector ANN scan is much faster than
   * scanning all chunks and post-filtering (standard pgvector multi-tenant
   * pattern).
   */
  @Column({ type: 'varchar', length: 10 })
  jurisdiction: string;

  /** 0-based position of this chunk within the parent document. */
  @Column({ type: 'int' })
  chunk_index: number;

  /** The text slice that was embedded. */
  @Column({ type: 'text' })
  chunk_text: string;

  /**
   * Article reference extracted by the chunker.
   * e.g. 'Article 147' / 'مادة 147'
   * NULL for preamble / transitional provisions.
   * All sub-chunks of a single article share the same article_reference so
   * citations remain attached even when an oversized article is split.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  article_reference: string | null;

  /** Approximate token count — useful for debugging and future cost tracking. */
  @Column({ type: 'int', nullable: true })
  token_count: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
