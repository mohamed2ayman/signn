import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.27 — Migration A: Legal Corpus Foundation
 *
 * Creates:
 *   - Three enum types (explicit _enum suffix per lesson #143)
 *   - legal_documents table
 *   - legal_document_chunks table (embedding vector(1536) nullable — Python fills it)
 *   - btree indexes for jurisdiction/status filtering
 *
 * Does NOT create the HNSW vector index — that lives in Migration B
 * (1755000000002) so a future index-type swap is a single-file change.
 *
 * Pattern: DO $$ IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '...')
 * — never EXCEPTION WHEN (lessons #31, #103, #111).
 */
export class AddLegalCorpus1755000000001 implements MigrationInterface {
  name = 'AddLegalCorpus1755000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Enum types ──────────────────────────────────────────────────────
    // Explicit `_enum` suffix so lesson #143 check is a no-op —
    // we know the exact PostgreSQL type name at authoring time.

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'legal_document_source_type_enum'
        ) THEN
          CREATE TYPE "legal_document_source_type_enum" AS ENUM (
            'PRIMARY_TEXT',
            'CURATED_SUMMARY'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'legal_document_status_enum'
        ) THEN
          CREATE TYPE "legal_document_status_enum" AS ENUM (
            'IN_FORCE',
            'AMENDED',
            'REPEALED',
            'DRAFT'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'legal_document_embedding_status_enum'
        ) THEN
          CREATE TYPE "legal_document_embedding_status_enum" AS ENUM (
            'PENDING',
            'PROCESSING',
            'INDEXED',
            'FAILED'
          );
        END IF;
      END $$;
    `);

    // ── 2. legal_documents table ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "legal_documents" (
        "id"                 UUID DEFAULT uuid_generate_v4() PRIMARY KEY,

        -- Core identity
        "jurisdiction"       VARCHAR(10)  NOT NULL,
        "source_type"        "legal_document_source_type_enum" NOT NULL DEFAULT 'PRIMARY_TEXT',
        "title"              VARCHAR(500) NOT NULL,

        -- Law reference fields
        "law_number"         VARCHAR(100) NULL,
        "law_year"           INTEGER      NULL,
        "gregorian_date"     DATE         NULL,
        "hijri_date"         VARCHAR(20)  NULL,

        -- Status
        "status"             "legal_document_status_enum" NOT NULL DEFAULT 'IN_FORCE',

        -- Language (Postgres array — e.g. ARRAY['AR','EN'])
        "language"           VARCHAR(5)[] NULL,

        -- Self-reference for "regulation implements law" / "decree amends"
        "parent_law_id"      UUID         NULL
          REFERENCES "legal_documents"("id") ON DELETE SET NULL,

        -- File storage (mirrors knowledge_assets.file_url pattern)
        "file_url"           VARCHAR(1000) NULL,
        "file_name"          VARCHAR(500)  NULL,

        -- Dedup guard
        "content_hash"       VARCHAR(64)  NULL,

        -- Provenance
        "source_url"         TEXT         NULL,
        "source_attribution" VARCHAR(500) NULL,

        -- Embedding pipeline state
        "embedding_status"   "legal_document_embedding_status_enum" NOT NULL DEFAULT 'PENDING',
        "error_message"      TEXT         NULL,

        -- Full extracted text — needed for chunking step and admin review
        "extracted_text"     TEXT         NULL,
        "extraction_job_id"  VARCHAR(255) NULL,
        "embedding_job_id"   VARCHAR(255) NULL,

        -- Audit
        "created_by"         UUID         NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "updated_at"         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // ── 3. Btree indexes on legal_documents ───────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_legal_documents_jurisdiction_status"
        ON "legal_documents" ("jurisdiction", "status");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_legal_documents_parent_law_id"
        ON "legal_documents" ("parent_law_id")
        WHERE "parent_law_id" IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_legal_documents_content_hash"
        ON "legal_documents" ("content_hash")
        WHERE "content_hash" IS NOT NULL;
    `);

    // ── 4. legal_document_chunks table ────────────────────────────────────
    // embedding is nullable — rows are inserted with embedding=NULL;
    // the Python Celery task fills in vectors asynchronously.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "legal_document_chunks" (
        "id"                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        "legal_document_id" UUID NOT NULL
          REFERENCES "legal_documents"("id") ON DELETE CASCADE,

        -- Denormalised for index-only pre-filter (WHERE jurisdiction = 'EG'
        -- before the pgvector ANN scan is significantly faster than scanning all
        -- chunks and post-filtering — standard pgvector multi-tenant pattern).
        "jurisdiction"      VARCHAR(10) NOT NULL,

        -- Chunk position within the document (0-based)
        "chunk_index"       INTEGER     NOT NULL,

        -- The text slice that was embedded
        "chunk_text"        TEXT        NOT NULL,

        -- pgvector column — nullable until the Celery task completes.
        -- vector(1536) matches text-embedding-3-small output dimension.
        "embedding"         vector(1536) NULL,

        -- e.g. 'Article 147' / 'مادة 147' — from the article-boundary chunker.
        -- NULL for preamble / transitional provisions.
        "article_reference" VARCHAR(100) NULL,

        -- Approximate token count for debugging and future cost tracking.
        "token_count"       INTEGER      NULL,

        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // ── 5. Btree indexes on legal_document_chunks ─────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_legal_document_chunks_document_id"
        ON "legal_document_chunks" ("legal_document_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_legal_document_chunks_jurisdiction"
        ON "legal_document_chunks" ("jurisdiction");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse order — chunks reference documents, documents reference users.
    await queryRunner.query(`DROP TABLE IF EXISTS "legal_document_chunks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "legal_documents"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "legal_document_embedding_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "legal_document_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "legal_document_source_type_enum"`);
  }
}
