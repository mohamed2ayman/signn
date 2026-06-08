import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Phase 7.27 — A legal-document publisher / source catalogue entry.
 *
 * Each source carries an `is_visual_order` flag.  Some publishers (e.g. the
 * Egyptian Tax Authority) store Arabic PDFs in *visual* order (RTL
 * word-reversed); the chunker reverses word order back to logical order ONLY
 * for documents whose source has this flag set.  Logical-order sources (the
 * common case) are left untouched.
 *
 * Sources are managed by SQL in v1 — there is no admin endpoint yet
 * (adding one is a documented future phase).
 */
@Entity('legal_sources')
export class LegalSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Display name. e.g. 'Egyptian Tax Authority'. */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** Optional base domain. e.g. 'eta.gov.eg'. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  base_url: string | null;

  /** ISO-3166-1 alpha-2 jurisdiction code. e.g. 'EG'. */
  @Column({ type: 'varchar', length: 10 })
  jurisdiction: string;

  /**
   * True when this source's PDFs store Arabic in visual (RTL word-reversed)
   * order and therefore require word-order reversal during chunking.
   */
  @Column({ type: 'boolean', default: false })
  is_visual_order: boolean;

  /**
   * Extraction strategy for this source's PDFs.
   * - true:  render pages to images and OCR them (~6 min/doc @ 300dpi, but
   *          clean for PDFs whose embedded fonts have a broken ToUnicode CMap,
   *          e.g. the Egyptian Tax Authority's kaf→آ corruption).  OCR emits
   *          logical-order Arabic, so is_visual_order reversal is suppressed.
   * - false: use the digital text-layer fast path (fast; correct for PDFs with
   *          intact font encoding).
   */
  @Column({ type: 'boolean', default: false })
  force_ocr: boolean;

  /** Optional human notes (provenance, verification details, etc.). */
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
