import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-tier trunk — Slice T0c-1 (ContractParty backend spine, Option 3-lite).
 *
 * Three tables:
 *
 *  - party_roles — a seeded REGISTRY (mirrors contract_relationship_types,
 *    migration 1768000000001): one row per party-role code (EMPLOYER /
 *    CONTRACTOR / ENGINEER / …) with labels ×3 locales, an applies_to scope
 *    ('project' | 'contract' | 'both'), active flag, sort order. The registry
 *    is the SINGLE SOURCE for valid role codes — contract_parties.role_code
 *    stores the code as a SOFT varchar reference (no hard FK), validated in
 *    the service. Adding a future role = INSERT a row (no code change,
 *    no ALTER TYPE).
 *
 *  - contract_parties — the parties on a contract (Employer, Contractor,
 *    Engineer, …). contract_id FK is ON DELETE CASCADE — parties are OWNED
 *    children of the contract, deliberately NOT the RESTRICT used for
 *    contracts.parent_contract_id (lesson #229: RESTRICT there protects a
 *    cross-contract hierarchy; parties have no life outside their contract).
 *    organization_id is an OPTIONAL link to a SIGN organization
 *    (ON DELETE SET NULL — the party row outlives the link, matching the
 *    LegalDocument.parent_law_id optional-link template).
 *
 *  - contract_party_contacts — named contact persons under a party, with an
 *    is_designated_signatory flag (service-enforced: only on a signatory
 *    party, at most one per party).
 *
 * Additive only, no backfill. Idempotent: CREATE TABLE IF NOT EXISTS +
 * CREATE INDEX IF NOT EXISTS + ON CONFLICT (code) DO NOTHING for the seed —
 * never EXCEPTION WHEN (lessons #31/#103/#111). No ALTER TYPE — no
 * `transaction = false` needed.
 */
export class AddContractParties1770000000001 implements MigrationInterface {
  name = 'AddContractParties1770000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. The party-role registry ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS party_roles (
        id         UUID         NOT NULL DEFAULT gen_random_uuid(),
        code       VARCHAR(50)  NOT NULL,
        label_en   VARCHAR(120) NOT NULL,
        label_ar   VARCHAR(120) NOT NULL,
        label_fr   VARCHAR(120) NOT NULL,
        applies_to VARCHAR(10)  NOT NULL,
        is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
        sort_order INT          NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_party_roles PRIMARY KEY (id),
        CONSTRAINT uq_party_roles_code UNIQUE (code),
        CONSTRAINT ck_party_roles_applies_to
          CHECK (applies_to IN ('project', 'contract', 'both'))
      )
    `);

    // Seed the 11 launch roles. ON CONFLICT (code) DO NOTHING — existing rows
    // (e.g. Ops-edited labels/flags) are never overwritten on re-run.
    // EN/AR labels are founder-final; FR is DRAFT pending legal-terminology
    // review (same posture as the clauseType.* / riskTab.* i18n terms).
    await queryRunner.query(`
      INSERT INTO party_roles (code, label_en, label_ar, label_fr, applies_to, is_active, sort_order)
      VALUES
        ('EMPLOYER', 'Employer', 'صاحب العمل', 'Maître d''ouvrage', 'both', TRUE, 10),
        ('CONTRACTOR', 'Contractor', 'مقاول', 'Entrepreneur', 'both', TRUE, 20),
        ('ENGINEERING_CONSULTANT', 'Engineering Consultant', 'استشاري هندسي', 'Consultant en ingénierie', 'both', TRUE, 30),
        ('DESIGN_CONSULTANT', 'Design Consultant', 'استشاري تصميم', 'Consultant en conception', 'both', TRUE, 40),
        ('COST_CONSULTANT', 'Cost Consultant', 'استشاري تكاليف', 'Économiste de la construction', 'both', TRUE, 50),
        ('SUBCONTRACTOR', 'Sub-contractor', 'مقاول من الباطن', 'Sous-traitant', 'both', TRUE, 60),
        ('SUPPLIER', 'Supplier', 'مورّد', 'Fournisseur', 'contract', TRUE, 70),
        ('ENGINEER', 'Engineer', 'المهندس', 'Ingénieur', 'contract', TRUE, 80),
        ('GRANTOR', 'Grantor', 'المانح', 'Constituant', 'contract', TRUE, 90),
        ('BENEFICIARY', 'Beneficiary', 'المنتفع', 'Bénéficiaire', 'contract', TRUE, 100),
        ('OTHER', 'Other', 'أخرى', 'Autre', 'both', TRUE, 110)
      ON CONFLICT (code) DO NOTHING
    `);

    // ── 2. contract_parties ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contract_parties (
        id              UUID         NOT NULL DEFAULT gen_random_uuid(),
        contract_id     UUID         NOT NULL,
        role_code       VARCHAR(50)  NOT NULL,
        org_name        VARCHAR(255) NOT NULL,
        is_signatory    BOOLEAN      NOT NULL DEFAULT FALSE,
        organization_id UUID         NULL,
        legal_tax_card  VARCHAR(100) NULL,
        legal_address   TEXT         NULL,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_contract_parties PRIMARY KEY (id),
        CONSTRAINT fk_contract_parties_contract
          FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
        CONSTRAINT fk_contract_parties_organization
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_contract_parties_contract_id
      ON contract_parties (contract_id)
    `);

    // ── 3. contract_party_contacts ─────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS contract_party_contacts (
        id                       UUID         NOT NULL DEFAULT gen_random_uuid(),
        contract_party_id        UUID         NOT NULL,
        name                     VARCHAR(255) NOT NULL,
        email                    VARCHAR(255) NOT NULL,
        title                    VARCHAR(255) NULL,
        is_designated_signatory  BOOLEAN      NOT NULL DEFAULT FALSE,
        CONSTRAINT pk_contract_party_contacts PRIMARY KEY (id),
        CONSTRAINT fk_contract_party_contacts_party
          FOREIGN KEY (contract_party_id) REFERENCES contract_parties(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_contract_party_contacts_party_id
      ON contract_party_contacts (contract_party_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS contract_party_contacts`);
    await queryRunner.query(`DROP TABLE IF EXISTS contract_parties`);
    await queryRunner.query(`DROP TABLE IF EXISTS party_roles`);
  }
}
