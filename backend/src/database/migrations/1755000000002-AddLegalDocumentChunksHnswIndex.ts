import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.27 — Migration B: HNSW vector index on legal_document_chunks.
 *
 * Kept separate from Migration A so a future index-type swap
 * (e.g. HNSW → IVFFlat, or parameter tuning m=32) is a single-file
 * change without touching the table DDL.
 *
 * Parameters:
 *   m = 16             — number of bi-directional links per node (pgvector default)
 *   ef_construction=64 — candidate list size at construction time (pgvector default)
 *
 * Distance metric: cosine (vector_cosine_ops) matches text-embedding-3-small.
 *
 * DO NOT change these parameters without first benchmarking on representative data.
 * The query layer uses `<=>` (cosine distance) which is index-type-agnostic —
 * switching to IVFFlat later requires only replacing this migration's CREATE INDEX.
 */
export class AddLegalDocumentChunksHnswIndex1755000000002 implements MigrationInterface {
  name = 'AddLegalDocumentChunksHnswIndex1755000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_legal_document_chunks_embedding"
        ON "legal_document_chunks"
        USING hnsw ("embedding" vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_legal_document_chunks_embedding";
    `);
  }
}
