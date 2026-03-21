import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentProcessingSupport1710000000002
  implements MigrationInterface
{
  name = 'AddDocumentProcessingSupport1710000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create document processing status enum
    await queryRunner.query(`
      CREATE TYPE "document_processing_status_enum" AS ENUM (
        'UPLOADED',
        'EXTRACTING_TEXT',
        'TEXT_EXTRACTED',
        'EXTRACTING_CLAUSES',
        'CLAUSES_EXTRACTED',
        'FAILED'
      )
    `);

    // Create document_uploads table
    await queryRunner.query(`
      CREATE TABLE "document_uploads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "contract_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "file_url" varchar(1000) NOT NULL,
        "file_name" varchar(500) NOT NULL,
        "original_name" varchar(500),
        "file_size" integer,
        "mime_type" varchar(100),
        "document_priority" integer NOT NULL DEFAULT 0,
        "document_label" varchar(100),
        "processing_status" "document_processing_status_enum" NOT NULL DEFAULT 'UPLOADED',
        "extracted_text" text,
        "page_count" integer,
        "error_message" text,
        "processing_job_id" varchar(255),
        "uploaded_by" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document_uploads" PRIMARY KEY ("id"),
        CONSTRAINT "FK_document_uploads_contract" FOREIGN KEY ("contract_id")
          REFERENCES "contracts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_document_uploads_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_document_uploads_uploader" FOREIGN KEY ("uploaded_by")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Add new columns to clauses table
    await queryRunner.query(`
      ALTER TABLE "clauses"
        ADD COLUMN "source" varchar(20) NOT NULL DEFAULT 'MANUAL',
        ADD COLUMN "source_document_id" uuid,
        ADD COLUMN "confidence_score" decimal(3,2),
        ADD COLUMN "review_status" varchar(20) NOT NULL DEFAULT 'APPROVED',
        ADD COLUMN "reviewed_by" uuid,
        ADD COLUMN "reviewed_at" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(`
      ALTER TABLE "clauses"
        ADD CONSTRAINT "FK_clauses_source_document" FOREIGN KEY ("source_document_id")
          REFERENCES "document_uploads"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "clauses"
        ADD CONSTRAINT "FK_clauses_reviewer" FOREIGN KEY ("reviewed_by")
          REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // Add creation_flow column to contracts table
    await queryRunner.query(`
      ALTER TABLE "contracts"
        ADD COLUMN "creation_flow" varchar(30) NOT NULL DEFAULT 'MANUAL'
    `);

    // Add indexes for common queries
    await queryRunner.query(`
      CREATE INDEX "IDX_document_uploads_contract" ON "document_uploads" ("contract_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_document_uploads_status" ON "document_uploads" ("processing_status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_clauses_review_status" ON "clauses" ("review_status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_clauses_source" ON "clauses" ("source")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_clauses_source"`);
    await queryRunner.query(`DROP INDEX "IDX_clauses_review_status"`);
    await queryRunner.query(`DROP INDEX "IDX_document_uploads_status"`);
    await queryRunner.query(`DROP INDEX "IDX_document_uploads_contract"`);

    await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "creation_flow"`);

    await queryRunner.query(`ALTER TABLE "clauses" DROP CONSTRAINT "FK_clauses_reviewer"`);
    await queryRunner.query(`ALTER TABLE "clauses" DROP CONSTRAINT "FK_clauses_source_document"`);
    await queryRunner.query(`
      ALTER TABLE "clauses"
        DROP COLUMN "reviewed_at",
        DROP COLUMN "reviewed_by",
        DROP COLUMN "review_status",
        DROP COLUMN "confidence_score",
        DROP COLUMN "source_document_id",
        DROP COLUMN "source"
    `);

    await queryRunner.query(`DROP TABLE "document_uploads"`);
    await queryRunner.query(`DROP TYPE "document_processing_status_enum"`);
  }
}
