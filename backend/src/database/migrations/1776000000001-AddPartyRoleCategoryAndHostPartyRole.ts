import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The 11 codes this migration seeds — the exact set down() removes, and the
 * exact set down()'s reference guard checks. Declared once so the guard and
 * the DELETE can never drift apart.
 */
const SEEDED_1A_CODES = [
  'DEVELOPER',
  'GOVERNMENT_AUTHORITY',
  'EPC_CONTRACTOR',
  'NOMINATED_SUBCONTRACTOR',
  'SUPERVISION_CONSULTANT',
  'PROJECT_MANAGER',
  'PROJECT_MANAGEMENT_CONSULTANT',
  'CONCESSIONAIRE',
  'OPERATOR',
  'GUARANTOR',
  'LENDER',
];

/**
 * Party Foundation — Slice 1a (DATA LAYER ONLY, no frontend).
 *
 * Four schema changes + one seed, all additive:
 *
 *  1. party_roles.category — a nullable GROUPING label (EMPLOYER_SIDE /
 *     CONTRACTOR_SIDE / CONSULTANTS / FINANCIAL / CONCESSION). Deliberately a
 *     plain VARCHAR, NOT a pg enum: the registry is the single source of
 *     truth, so adding a future group is a data change, never an ALTER TYPE
 *     (the contract_type / relationship_type / role_code convention).
 *     OTHER stays NULL on purpose — it is the ungrouped catch-all and renders
 *     last (its existing sort_order 110 already places it after the seeded 11).
 *
 *  2. Category BACKFILL for the 11 existing roles. sort_order is DELIBERATELY
 *     NOT TOUCHED — the column already existed before this slice and carries a
 *     deliberate 10..110 ordering. This migration never writes sort_order on an
 *     existing row.
 *
 *  3. 11 NEW registry roles, seeded is_active = FALSE. They are INVISIBLE to
 *     GET /party-roles (which defaults to active-only) and REJECTED by the
 *     write validators until Slice 1b flips them active after visual review.
 *     Their sort_order values interleave into the existing 10..110 sequence
 *     (11/12 after EMPLOYER=10, 21 after CONTRACTOR=20, …) so no existing row
 *     needs renumbering.
 *
 *  4. contracts.host_party_role_code — the AUTHORITATIVE record of which party
 *     the host organisation represents on a contract.
 *
 *  5. projects.default_party_role_code — the project-level default a contract
 *     inherits. NOTE: this column holds a CONTRACT-scoped role code, not a
 *     project-scoped one. A future consumer MUST query the contract-scoped role
 *     list; filtering the registry by applies_to = 'project' returns nothing
 *     usable today.
 *
 * BOTH new columns are SOFT VARCHAR(50) references to party_roles.code with NO
 * hard FK — matching the convention already established by
 * contract_parties.role_code (migration 1770000000001 creates FKs only for
 * contract_id and organization_id; role_code carries none) and by
 * contracts.relationship_type. Validity is enforced in the service layer
 * against ACTIVE registry rows.
 *
 * contracts.party_type is NOT touched, read, migrated, or backfilled by this
 * migration. It is still actively written today and keeps working unchanged.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS + ON CONFLICT (code) DO NOTHING +
 * a category backfill guarded on `category IS NULL` (so an Ops edit is never
 * clobbered on re-run). Never EXCEPTION WHEN (lessons #31/#103/#111).
 * No ALTER TYPE — no `transaction = false` needed.
 */
export class AddPartyRoleCategoryAndHostPartyRole1776000000001
  implements MigrationInterface
{
  name = 'AddPartyRoleCategoryAndHostPartyRole1776000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. party_roles.category ────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE party_roles
      ADD COLUMN IF NOT EXISTS category VARCHAR(40) NULL
    `);

    // ── 2. Category backfill for the 11 EXISTING roles ─────────────────────
    // Guarded on `category IS NULL` — idempotent and never overwrites a value
    // set later by Ops. sort_order is NOT written here: the existing 10..110
    // ordering is deliberate and stays exactly as it is.
    // The two TEST_* rows left by contract-parties.real-pg.spec.ts are not in
    // any code list below, so they are untouched.
    await queryRunner.query(`
      UPDATE party_roles SET category = 'EMPLOYER_SIDE'
      WHERE code = 'EMPLOYER' AND category IS NULL
    `);
    await queryRunner.query(`
      UPDATE party_roles SET category = 'CONTRACTOR_SIDE'
      WHERE code IN ('CONTRACTOR', 'SUBCONTRACTOR', 'SUPPLIER')
        AND category IS NULL
    `);
    await queryRunner.query(`
      UPDATE party_roles SET category = 'CONSULTANTS'
      WHERE code IN ('ENGINEER', 'ENGINEERING_CONSULTANT',
                     'DESIGN_CONSULTANT', 'COST_CONSULTANT')
        AND category IS NULL
    `);
    await queryRunner.query(`
      UPDATE party_roles SET category = 'FINANCIAL'
      WHERE code = 'BENEFICIARY' AND category IS NULL
    `);
    await queryRunner.query(`
      UPDATE party_roles SET category = 'CONCESSION'
      WHERE code = 'GRANTOR' AND category IS NULL
    `);
    // OTHER is intentionally left with category NULL — ungrouped, renders last.

    // ── 3. The 11 NEW roles — seeded INACTIVE ──────────────────────────────
    // applies_to = 'contract': step-0 read showed the existing 11 are MIXED
    // ('both' ×7, 'contract' ×4), so the rule resolves to the narrower scope.
    // is_active = FALSE keeps every one of them unselectable (hidden from
    // GET /party-roles, rejected by the service validators) until Slice 1b.
    // Labels are product-owner-final and inserted verbatim.
    await queryRunner.query(`
      INSERT INTO party_roles (code, label_en, label_ar, label_fr, applies_to, is_active, sort_order, category)
      VALUES
        ('DEVELOPER', 'Developer', 'المطور العقاري', 'Promoteur immobilier', 'contract', FALSE, 11, 'EMPLOYER_SIDE'),
        ('GOVERNMENT_AUTHORITY', 'Government Authority', 'الجهة الحكومية', 'Autorité publique', 'contract', FALSE, 12, 'EMPLOYER_SIDE'),
        ('EPC_CONTRACTOR', 'EPC Contractor', 'مقاول الهندسة والتوريد والإنشاء', 'Entrepreneur EPC', 'contract', FALSE, 21, 'CONTRACTOR_SIDE'),
        ('NOMINATED_SUBCONTRACTOR', 'Nominated Subcontractor', 'مقاول الباطن المسمّى', 'Sous-traitant désigné', 'contract', FALSE, 61, 'CONTRACTOR_SIDE'),
        ('SUPERVISION_CONSULTANT', 'Supervision Consultant', 'الاستشاري المشرف', 'Consultant en supervision', 'contract', FALSE, 31, 'CONSULTANTS'),
        ('PROJECT_MANAGER', 'Project Manager', 'مدير المشروع', 'Chef de projet', 'contract', FALSE, 81, 'CONSULTANTS'),
        ('PROJECT_MANAGEMENT_CONSULTANT', 'Project Management Consultant', 'استشاري إدارة المشروع', 'Consultant en gestion de projet', 'contract', FALSE, 82, 'CONSULTANTS'),
        ('CONCESSIONAIRE', 'Concessionaire', 'صاحب الامتياز', 'Concessionnaire', 'contract', FALSE, 91, 'CONCESSION'),
        ('OPERATOR', 'Operator', 'المُشغّل', 'Exploitant', 'contract', FALSE, 92, 'CONCESSION'),
        ('GUARANTOR', 'Guarantor', 'الضامن', 'Garant', 'contract', FALSE, 101, 'FINANCIAL'),
        ('LENDER', 'Lender', 'المُقرض', 'Prêteur', 'contract', FALSE, 102, 'FINANCIAL')
      ON CONFLICT (code) DO NOTHING
    `);

    // ── 4. contracts.host_party_role_code ──────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS host_party_role_code VARCHAR(50) NULL
    `);

    // ── 5. projects.default_party_role_code ────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS default_party_role_code VARCHAR(50) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── GUARD (runs FIRST, while the columns still exist) ──────────────────
    // The two new columns are SOFT references (no FK), so Postgres cannot
    // itself block deleting a seeded code that a contract or project points
    // at. This guard reproduces that protection explicitly and SURFACES the
    // error rather than defeating it — a referenced code is never silently
    // orphaned, and CASCADE is never used anywhere in this down().
    // It must run BEFORE the DROP COLUMNs below, which would otherwise make
    // the reference unobservable and let the DELETE always "succeed".
    const [{ n }]: Array<{ n: number }> = await queryRunner.query(
      `SELECT
         (SELECT COUNT(*)::int FROM contracts
            WHERE host_party_role_code = ANY($1::varchar[]))
       + (SELECT COUNT(*)::int FROM projects
            WHERE default_party_role_code = ANY($1::varchar[])) AS n`,
      [SEEDED_1A_CODES],
    );
    if (Number(n) > 0) {
      throw new Error(
        `Cannot revert 1776000000001: ${n} contract/project row(s) still ` +
          'reference one of the 11 seeded party-role codes. Clear those ' +
          'references first — this migration will not orphan them.',
      );
    }

    // Amended down() order: drop category, drop host_party_role_code, drop
    // default_party_role_code, then delete the 11 inserted codes.
    // sort_order is NOT touched, and no existing row's category is restored
    // or altered beyond the column being dropped.
    await queryRunner.query(`
      ALTER TABLE party_roles DROP COLUMN IF EXISTS category
    `);
    await queryRunner.query(`
      ALTER TABLE contracts DROP COLUMN IF EXISTS host_party_role_code
    `);
    await queryRunner.query(`
      ALTER TABLE projects DROP COLUMN IF EXISTS default_party_role_code
    `);

    // No CASCADE. If anything still blocks this delete, the error surfaces.
    await queryRunner.query(
      `DELETE FROM party_roles WHERE code = ANY($1::varchar[])`,
      [SEEDED_1A_CODES],
    );
  }
}
