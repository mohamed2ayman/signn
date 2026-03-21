import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1710000000000 implements MigrationInterface {
  name = 'InitialSchema1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable extensions
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);

    // Create ENUM types
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "user_role" AS ENUM (
          'SYSTEM_ADMIN', 'OPERATIONS', 'OWNER_ADMIN', 'OWNER_CREATOR',
          'OWNER_REVIEWER', 'CONTRACTOR_ADMIN', 'CONTRACTOR_CREATOR',
          'CONTRACTOR_REVIEWER', 'CONTRACTOR_TENDERING'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "contract_status" AS ENUM (
          'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PENDING_TENDERING',
          'SENT_TO_CONTRACTOR', 'CONTRACTOR_REVIEWING', 'PENDING_FINAL_APPROVAL',
          'CHANGES_REQUESTED', 'RISK_ESCALATION_PENDING', 'ACTIVE', 'COMPLETED', 'TERMINATED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "contract_type_enum" AS ENUM ('FIDIC_RED', 'FIDIC_YELLOW', 'ADHOC', 'UPLOADED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "asset_type" AS ENUM (
          'LAW', 'INTERNATIONAL_STANDARD', 'ORGANIZATION_POLICY', 'CONTRACT_TEMPLATE', 'KNOWLEDGE'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "asset_review_status" AS ENUM (
          'PENDING_REVIEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'AUTO_APPROVED'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "subscription_status" AS ENUM ('ACTIVE', 'INACTIVE', 'CANCELLED', 'EXPIRED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "obligation_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "notification_type" AS ENUM ('EMAIL', 'IN_APP', 'BOTH');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // Organizations
    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name" VARCHAR(255) NOT NULL,
        "industry" VARCHAR(255),
        "crn" VARCHAR(100),
        "country" VARCHAR(100),
        "logo_url" VARCHAR(500),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organizations" PRIMARY KEY ("id")
      )
    `);

    // Subscription Plans
    await queryRunner.query(`
      CREATE TABLE "subscription_plans" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name" VARCHAR(255) NOT NULL,
        "description" TEXT,
        "price" DECIMAL(10,2) NOT NULL,
        "currency" VARCHAR(10) NOT NULL DEFAULT 'USD',
        "duration_days" INTEGER NOT NULL,
        "max_projects" INTEGER NOT NULL,
        "max_users" INTEGER NOT NULL,
        "max_contracts_per_project" INTEGER NOT NULL,
        "features" JSONB,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_plans" PRIMARY KEY ("id")
      )
    `);

    // Organization Subscriptions
    await queryRunner.query(`
      CREATE TABLE "organization_subscriptions" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" UUID NOT NULL,
        "plan_id" UUID NOT NULL,
        "status" "subscription_status" NOT NULL DEFAULT 'INACTIVE',
        "start_date" TIMESTAMPTZ NOT NULL,
        "end_date" TIMESTAMPTZ NOT NULL,
        "paymob_subscription_id" VARCHAR(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organization_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_org_subscriptions_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_org_subscriptions_plan" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT
      )
    `);

    // Users
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" UUID,
        "email" VARCHAR(255) NOT NULL,
        "password_hash" VARCHAR(255) NOT NULL,
        "first_name" VARCHAR(100) NOT NULL,
        "last_name" VARCHAR(100) NOT NULL,
        "role" "user_role" NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
        "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
        "mfa_secret" VARCHAR(255),
        "invitation_token" VARCHAR(255),
        "invitation_expires_at" TIMESTAMPTZ,
        "last_login_at" TIMESTAMPTZ,
        "preferred_language" VARCHAR(10) NOT NULL DEFAULT 'en',
        "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
        "locked_until" TIMESTAMPTZ,
        "refresh_token_hash" VARCHAR(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "FK_users_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL
      )
    `);

    // Projects
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" UUID NOT NULL,
        "name" VARCHAR(255) NOT NULL,
        "objective" TEXT,
        "country" VARCHAR(100),
        "start_date" DATE,
        "end_date" DATE,
        "created_by" UUID NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_projects" PRIMARY KEY ("id"),
        CONSTRAINT "FK_projects_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_projects_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    // Project Members
    await queryRunner.query(`
      CREATE TABLE "project_members" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "project_id" UUID NOT NULL,
        "user_id" UUID NOT NULL,
        "role" VARCHAR(50),
        "added_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_project_members" PRIMARY KEY ("id"),
        CONSTRAINT "FK_project_members_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_project_members_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_project_members" UNIQUE ("project_id", "user_id")
      )
    `);

    // Contractors
    await queryRunner.query(`
      CREATE TABLE "contractors" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "owner_organization_id" UUID NOT NULL,
        "contractor_organization_id" UUID,
        "name" VARCHAR(255) NOT NULL,
        "email" VARCHAR(255) NOT NULL,
        "contact_person" VARCHAR(255),
        "phone" VARCHAR(50),
        "invitation_token" VARCHAR(255),
        "invitation_status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contractors" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contractors_owner_org" FOREIGN KEY ("owner_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_contractors_contractor_org" FOREIGN KEY ("contractor_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL
      )
    `);

    // Clauses
    await queryRunner.query(`
      CREATE TABLE "clauses" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" UUID,
        "title" VARCHAR(500) NOT NULL,
        "content" TEXT NOT NULL,
        "clause_type" VARCHAR(100),
        "version" INTEGER NOT NULL DEFAULT 1,
        "parent_clause_id" UUID,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_by" UUID,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_clauses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_clauses_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_clauses_parent" FOREIGN KEY ("parent_clause_id") REFERENCES "clauses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_clauses_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Contracts
    await queryRunner.query(`
      CREATE TABLE "contracts" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "project_id" UUID NOT NULL,
        "name" VARCHAR(500) NOT NULL,
        "contract_type" "contract_type_enum" NOT NULL,
        "status" "contract_status" NOT NULL DEFAULT 'DRAFT',
        "current_version" INTEGER NOT NULL DEFAULT 1,
        "party_type" VARCHAR(50),
        "created_by" UUID NOT NULL,
        "approved_by" UUID,
        "approved_at" TIMESTAMPTZ,
        "shared_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contracts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contracts_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_contracts_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_contracts_approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Contract Clauses (many-to-many, ordered)
    await queryRunner.query(`
      CREATE TABLE "contract_clauses" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "contract_id" UUID NOT NULL,
        "clause_id" UUID NOT NULL,
        "section_number" VARCHAR(50),
        "order_index" INTEGER NOT NULL DEFAULT 0,
        "customizations" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contract_clauses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contract_clauses_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_contract_clauses_clause" FOREIGN KEY ("clause_id") REFERENCES "clauses"("id") ON DELETE CASCADE
      )
    `);

    // Contract Versions
    await queryRunner.query(`
      CREATE TABLE "contract_versions" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "contract_id" UUID NOT NULL,
        "version_number" INTEGER NOT NULL,
        "snapshot" JSONB NOT NULL,
        "change_summary" TEXT,
        "created_by" UUID,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contract_versions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contract_versions_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_contract_versions_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Contractor Responses
    await queryRunner.query(`
      CREATE TABLE "contractor_responses" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "contract_id" UUID NOT NULL,
        "contractor_id" UUID NOT NULL,
        "response_contract_id" UUID,
        "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        "submitted_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contractor_responses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contractor_responses_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_contractor_responses_contractor" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_contractor_responses_response" FOREIGN KEY ("response_contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL
      )
    `);

    // Risk Analyses
    await queryRunner.query(`
      CREATE TABLE "risk_analyses" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "contract_id" UUID NOT NULL,
        "contract_clause_id" UUID,
        "risk_category" VARCHAR(100) NOT NULL,
        "risk_level" "risk_level" NOT NULL,
        "description" TEXT NOT NULL,
        "recommendation" TEXT,
        "citation_source" VARCHAR(500),
        "citation_excerpt" TEXT,
        "status" VARCHAR(50) NOT NULL DEFAULT 'OPEN',
        "handled_by" UUID,
        "handled_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_risk_analyses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_risk_analyses_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_risk_analyses_clause" FOREIGN KEY ("contract_clause_id") REFERENCES "contract_clauses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_risk_analyses_handled_by" FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Knowledge Assets
    await queryRunner.query(`
      CREATE TABLE "knowledge_assets" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" UUID,
        "title" VARCHAR(500) NOT NULL,
        "description" TEXT,
        "asset_type" "asset_type" NOT NULL,
        "review_status" "asset_review_status" NOT NULL DEFAULT 'PENDING_REVIEW',
        "file_url" VARCHAR(1000),
        "file_name" VARCHAR(500),
        "jurisdiction" VARCHAR(10),
        "tags" JSONB,
        "include_in_risk_analysis" BOOLEAN NOT NULL DEFAULT false,
        "include_in_citations" BOOLEAN NOT NULL DEFAULT false,
        "embedding_status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        "reviewed_by" UUID,
        "reviewed_at" TIMESTAMPTZ,
        "created_by" UUID,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_assets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_knowledge_assets_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_knowledge_assets_reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_knowledge_assets_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Obligations
    await queryRunner.query(`
      CREATE TABLE "obligations" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "contract_id" UUID NOT NULL,
        "contract_clause_id" UUID,
        "description" TEXT NOT NULL,
        "responsible_party" VARCHAR(100),
        "due_date" DATE,
        "frequency" VARCHAR(50),
        "status" "obligation_status" NOT NULL DEFAULT 'PENDING',
        "reminder_days_before" INTEGER NOT NULL DEFAULT 7,
        "completed_at" TIMESTAMPTZ,
        "completed_by" UUID,
        "evidence_url" VARCHAR(1000),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_obligations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_obligations_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_obligations_clause" FOREIGN KEY ("contract_clause_id") REFERENCES "contract_clauses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_obligations_completed_by" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Notifications
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" UUID NOT NULL,
        "title" VARCHAR(500) NOT NULL,
        "message" TEXT NOT NULL,
        "type" "notification_type" NOT NULL DEFAULT 'IN_APP',
        "is_read" BOOLEAN NOT NULL DEFAULT false,
        "related_entity_type" VARCHAR(100),
        "related_entity_id" UUID,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Audit Logs
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" UUID,
        "organization_id" UUID,
        "action" VARCHAR(255) NOT NULL,
        "entity_type" VARCHAR(100),
        "entity_id" UUID,
        "old_values" JSONB,
        "new_values" JSONB,
        "ip_address" VARCHAR(50),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_audit_logs_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_audit_logs_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL
      )
    `);

    // Contract Comments
    await queryRunner.query(`
      CREATE TABLE "contract_comments" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "contract_id" UUID NOT NULL,
        "contract_clause_id" UUID,
        "user_id" UUID NOT NULL,
        "content" TEXT NOT NULL,
        "is_resolved" BOOLEAN NOT NULL DEFAULT false,
        "parent_comment_id" UUID,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contract_comments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contract_comments_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_contract_comments_clause" FOREIGN KEY ("contract_clause_id") REFERENCES "contract_clauses"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_contract_comments_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_contract_comments_parent" FOREIGN KEY ("parent_comment_id") REFERENCES "contract_comments"("id") ON DELETE CASCADE
      )
    `);

    // Risk Rules
    await queryRunner.query(`
      CREATE TABLE "risk_rules" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name" VARCHAR(255) NOT NULL,
        "description" TEXT,
        "risk_category" VARCHAR(100) NOT NULL,
        "severity" "risk_level" NOT NULL,
        "detection_keywords" JSONB,
        "applicable_contract_types" JSONB,
        "recommendation_template" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_by" UUID,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_risk_rules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_risk_rules_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Risk Categories
    await queryRunner.query(`
      CREATE TABLE "risk_categories" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name" VARCHAR(255) NOT NULL,
        "description" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_risk_categories" PRIMARY KEY ("id")
      )
    `);

    // Support Tickets
    await queryRunner.query(`
      CREATE TABLE "support_tickets" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" UUID NOT NULL,
        "organization_id" UUID,
        "category" VARCHAR(50) NOT NULL,
        "priority" VARCHAR(50) NOT NULL,
        "subject" VARCHAR(500) NOT NULL,
        "description" TEXT NOT NULL,
        "status" VARCHAR(50) NOT NULL DEFAULT 'OPEN',
        "assigned_to" UUID,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_tickets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_support_tickets_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_support_tickets_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_support_tickets_assigned_to" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Create indexes for performance
    await queryRunner.query(`CREATE INDEX "IDX_users_organization" ON "users" ("organization_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_users_email" ON "users" ("email")`);
    await queryRunner.query(`CREATE INDEX "IDX_users_role" ON "users" ("role")`);
    await queryRunner.query(`CREATE INDEX "IDX_projects_organization" ON "projects" ("organization_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_contracts_project" ON "contracts" ("project_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_contracts_status" ON "contracts" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_contract_clauses_contract" ON "contract_clauses" ("contract_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_contract_clauses_clause" ON "contract_clauses" ("clause_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_contract_clauses_order" ON "contract_clauses" ("contract_id", "order_index")`);
    await queryRunner.query(`CREATE INDEX "IDX_risk_analyses_contract" ON "risk_analyses" ("contract_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_risk_analyses_clause" ON "risk_analyses" ("contract_clause_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_risk_analyses_level" ON "risk_analyses" ("risk_level")`);
    await queryRunner.query(`CREATE INDEX "IDX_knowledge_assets_org" ON "knowledge_assets" ("organization_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_knowledge_assets_type" ON "knowledge_assets" ("asset_type")`);
    await queryRunner.query(`CREATE INDEX "IDX_knowledge_assets_status" ON "knowledge_assets" ("review_status")`);
    await queryRunner.query(`CREATE INDEX "IDX_obligations_contract" ON "obligations" ("contract_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_obligations_status" ON "obligations" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_obligations_due_date" ON "obligations" ("due_date")`);
    await queryRunner.query(`CREATE INDEX "IDX_notifications_user" ON "notifications" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_notifications_read" ON "notifications" ("user_id", "is_read")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_user" ON "audit_logs" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_org" ON "audit_logs" ("organization_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_contractors_owner_org" ON "contractors" ("owner_organization_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_contract_versions_contract" ON "contract_versions" ("contract_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_contract_comments_contract" ON "contract_comments" ("contract_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_support_tickets_user" ON "support_tickets" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_support_tickets_status" ON "support_tickets" ("status")`);

    // Seed default risk categories
    await queryRunner.query(`
      INSERT INTO "risk_categories" ("id", "name", "description", "is_active") VALUES
      (uuid_generate_v4(), 'Design and Scope Risks', 'Risks related to design changes, scope creep, and specification ambiguities', true),
      (uuid_generate_v4(), 'Time and Delay Risks', 'Risks related to project timelines, delays, and extensions of time', true),
      (uuid_generate_v4(), 'Cost and Payment Risks', 'Risks related to cost overruns, payment terms, and financial obligations', true),
      (uuid_generate_v4(), 'Performance and Quality Risks', 'Risks related to workmanship quality, performance standards, and defects', true),
      (uuid_generate_v4(), 'Contractual and Legal Risks', 'Risks related to legal compliance, contractual obligations, and liability', true),
      (uuid_generate_v4(), 'Force Majeure Risks', 'Risks related to force majeure events and unforeseeable circumstances', true),
      (uuid_generate_v4(), 'Subcontracting Risks', 'Risks related to subcontractor management, liability, and performance', true),
      (uuid_generate_v4(), 'Dispute Resolution Risks', 'Risks related to dispute mechanisms, arbitration, and litigation', true)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order (respecting foreign key constraints)
    await queryRunner.query(`DROP TABLE IF EXISTS "support_tickets" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "risk_categories" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "risk_rules" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "contract_comments" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "obligations" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_assets" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "risk_analyses" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "contractor_responses" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "contract_versions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "contract_clauses" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "contracts" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "clauses" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "contractors" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "project_members" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "projects" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_subscriptions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_plans" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organizations" CASCADE`);

    // Drop ENUM types
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "obligation_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscription_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "asset_review_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "asset_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "risk_level"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "contract_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "contract_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role"`);
  }
}
