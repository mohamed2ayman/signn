import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-tier trunk — Slice T0a (relationship-type dimension).
 *
 * Adds the NEW "relationship type" dimension to contracts — the contract's
 * position in the delivery chain / legal relationship (Main / Sub-Contract /
 * Nominated Sub / Nominated Supplier / Supply-Direct / Consultant Appointment /
 * Usufruct, plus 3 seeded-but-inactive "coming soon" types: Joint Venture /
 * Framework / Novation). This is SEPARATE from and ORTHOGONAL to
 * contracts.contract_type (the STANDARD FORM, e.g. FIDIC_RED_BOOK_2017).
 *
 * Design (locked at T0a recon):
 *  - contracts.relationship_type — varchar(50) NULL soft code (matching
 *    contract_type's varchar style; NOT a PG enum, NOT a hard FK). NULL =
 *    unclassified/legacy — existing contracts are never backfilled.
 *  - contract_relationship_types — a seeded REGISTRY table holding the
 *    per-type metadata (labels ×3 locales, domain group, parent-link rule,
 *    allowed parent types, default signatory roles, active flag). The
 *    registry is the SINGLE SOURCE for both backend validation and the
 *    frontend picker (served via GET /contract-relationship-types) — no
 *    isStandardForm-style helper duplication across FE/BE.
 *  - Adding a future relationship type = INSERT a row (no code change,
 *    no ALTER TYPE) — the exact extensibility the registry buys.
 *
 * parent_link_rule / allowed_parent_types / default_signatory_role_* are
 * SEEDED now but not CONSUMED until later slices (T0b parent linking,
 * T0c signatories). default_signatory_role_* use the existing PartyType
 * vocabulary where possible (EMPLOYER / CONTRACTOR / SUBCONTRACTOR /
 * ENGINEERING_CONSULTANT); GRANTOR / BENEFICIARY / SUPPLIER are NEW string
 * codes — deliberately NOT added to the PartyType enum in this slice (a
 * shared role-vocabulary decision is a later slice).
 *
 * Additive only, no backfill. Idempotent: CREATE TABLE IF NOT EXISTS +
 * ADD COLUMN IF NOT EXISTS + ON CONFLICT (code) DO NOTHING for the seed —
 * never EXCEPTION WHEN (lessons #31/#103/#111). No ALTER TYPE — no
 * `transaction = false` needed.
 */
export class AddContractRelationshipTypes1768000000001 implements MigrationInterface {
  name = 'AddContractRelationshipTypes1768000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contract_relationship_types (
        id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
        code                     VARCHAR(50)  NOT NULL,
        label_en                 VARCHAR(120) NOT NULL,
        label_ar                 VARCHAR(120) NOT NULL,
        label_fr                 VARCHAR(120) NOT NULL,
        domain_group             VARCHAR(30)  NOT NULL,
        parent_link_rule         VARCHAR(20)  NOT NULL DEFAULT 'none',
        allowed_parent_types     JSONB        NOT NULL DEFAULT '[]'::jsonb,
        default_signatory_role_1 VARCHAR(50)  NULL,
        default_signatory_role_2 VARCHAR(50)  NULL,
        is_active                BOOLEAN      NOT NULL DEFAULT TRUE,
        sort_order               INT          NOT NULL DEFAULT 0,
        created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_contract_relationship_types PRIMARY KEY (id),
        CONSTRAINT uq_contract_relationship_types_code UNIQUE (code)
      )
    `);

    // Seed the 10 launch types. ON CONFLICT (code) DO NOTHING — existing rows
    // (e.g. Ops-edited labels/flags) are never overwritten on re-run.
    // AR/FR labels pending Youssef's legal-terminology review (same posture
    // as the clauseType.* / riskTab.* i18n terms).
    await queryRunner.query(`
      INSERT INTO contract_relationship_types
        (code, label_en, label_ar, label_fr, domain_group, parent_link_rule,
         allowed_parent_types, default_signatory_role_1, default_signatory_role_2,
         is_active, sort_order)
      VALUES
        ('MAIN', 'Main Contract', 'عقد رئيسي', 'Contrat principal',
         'delivery_chain', 'none', '[]'::jsonb, 'EMPLOYER', 'CONTRACTOR', TRUE, 10),
        ('SUBCONTRACT', 'Sub-Contract', 'عقد فرعي', 'Sous-contrat',
         'delivery_chain', 'required', '["MAIN"]'::jsonb, 'CONTRACTOR', 'SUBCONTRACTOR', TRUE, 20),
        ('NOMINATED_SUB', 'Nominated Sub-Contract', 'عقد فرعي مُسمّى', 'Sous-contrat désigné',
         'delivery_chain', 'required', '["MAIN"]'::jsonb, 'CONTRACTOR', 'SUBCONTRACTOR', TRUE, 30),
        ('NOMINATED_SUPPLIER', 'Nominated Supplier', 'مورّد مُسمّى', 'Fournisseur désigné',
         'delivery_chain', 'required', '["MAIN"]'::jsonb, 'CONTRACTOR', 'SUPPLIER', TRUE, 40),
        ('SUPPLY_DIRECT', 'Supply / Direct', 'توريد / شراء مباشر', 'Fourniture / Achat direct',
         'delivery_chain', 'optional', '["MAIN"]'::jsonb, 'SUPPLIER', 'EMPLOYER', TRUE, 50),
        ('CONSULTANT', 'Consultant / Engineer Appointment', 'تعيين استشاري / مهندس', 'Nomination de consultant / ingénieur',
         'appointment', 'optional', '["MAIN"]'::jsonb, 'EMPLOYER', 'ENGINEERING_CONSULTANT', TRUE, 60),
        ('USUFRUCT', 'Usufruct', 'حق الانتفاع', 'Usufruit',
         'property_rights', 'none', '[]'::jsonb, 'GRANTOR', 'BENEFICIARY', TRUE, 70),
        ('JOINT_VENTURE', 'Joint Venture', 'مشروع مشترك', 'Coentreprise',
         'party_agreement', 'none', '[]'::jsonb, NULL, NULL, FALSE, 80),
        ('FRAMEWORK', 'Framework', 'اتفاقية إطارية', 'Accord-cadre',
         'party_agreement', 'none', '[]'::jsonb, NULL, NULL, FALSE, 90),
        ('NOVATION', 'Novation', 'حوالة العقد', 'Novation',
         'party_agreement', 'none', '[]'::jsonb, NULL, NULL, FALSE, 100)
      ON CONFLICT (code) DO NOTHING
    `);

    // The soft code column on contracts. NULL = unclassified/legacy.
    await queryRunner.query(`
      ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS "relationship_type" varchar(50) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contracts DROP COLUMN IF EXISTS "relationship_type"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS contract_relationship_types
    `);
  }
}
