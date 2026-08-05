import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The 2 codes this migration seeds — the exact set down() removes, and the
 * exact set down()'s reference guard checks. Declared once so the guard and
 * the DELETE can never drift apart (the 1776000000001 convention).
 */
const SEEDED_1B_PRE_CODES = ['JV_CONTRACTOR', 'CONSORTIUM_MEMBER'];

/**
 * Party Foundation — Slice 1b-pre (REGISTRY DATA ONLY, no frontend).
 *
 * Two roles that ProjectCreationPage's legacy free-text PARTY_OPTIONS list
 * offers today — "JV Contractor (Joint Venture)" and "Consortium Member" —
 * have NO registry equivalent among the 22 codes seeded by 1770000000001 +
 * 1776000000001. Slice 1b removes that free-text list in favour of the
 * registry-backed picker, so without these two rows that removal would
 * silently drop two options users can pick right now.
 *
 * DIFFERENT FROM SLICE 1a: these ship is_active = TRUE.
 *
 * The 11 roles seeded by 1776000000001 are is_active = FALSE on purpose —
 * they are NEW vocabulary awaiting Slice 1b's visual review, and staying
 * inactive keeps them hidden from GET /party-roles and rejected by the write
 * validators until then. These two are the opposite case: they are
 * REPLACEMENTS for options already selectable in the UI, so they must be
 * selectable from the moment the picker replaces the free-text list. Seeding
 * them inactive would make Slice 1b a regression.
 *
 * Placement:
 *  - category = 'CONTRACTOR_SIDE' — both are contractor-side delivery
 *    vehicles (a joint venture / consortium bidding as the contractor).
 *    Takes CONTRACTOR_SIDE from 5 members to 7.
 *  - sort_order 22 + 23 — interleaves directly after EPC_CONTRACTOR (21),
 *    inside the CONTRACTOR=20 block, so NO existing row is renumbered.
 *    Both slots were verified free (the live sequence jumps 21 → 30).
 *  - applies_to = 'contract' — matches every role added by 1776000000001
 *    (verified against the live rows: all 11 are 'contract').
 *
 * Labels are product-owner-final, human-reviewed, and inserted verbatim —
 * not translated, normalised, or transliterated here. All six strings were
 * verified NFC-normalised and within the varchar(120) column bound before
 * this migration was written; the registry has no normalisation layer, so
 * this migration must not introduce the first non-NFC row.
 *
 * Idempotent: ON CONFLICT (code) DO NOTHING. Never EXCEPTION WHEN
 * (lessons #31/#103/#111). No ALTER TYPE — no `transaction = false` needed.
 */
export class AddJvContractorAndConsortiumMemberRoles1779000000001
  implements MigrationInterface
{
  name = 'AddJvContractorAndConsortiumMemberRoles1779000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO party_roles (code, label_en, label_ar, label_fr, applies_to, is_active, sort_order, category)
      VALUES
        ('JV_CONTRACTOR', 'JV Contractor', 'مقاول تحالف', 'Entrepreneur groupé', 'contract', TRUE, 22, 'CONTRACTOR_SIDE'),
        ('CONSORTIUM_MEMBER', 'Consortium Member', 'عضو تحالف', 'Membre du groupement', 'contract', TRUE, 23, 'CONTRACTOR_SIDE')
      ON CONFLICT (code) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── GUARD (runs FIRST, before the DELETE) ──────────────────────────────
    // contracts.host_party_role_code and projects.default_party_role_code are
    // SOFT references (varchar, no FK — the 1776000000001 convention), so
    // Postgres cannot itself block deleting a code a row still points at.
    // This guard reproduces that protection explicitly and SURFACES the error
    // rather than defeating it — a referenced code is never silently orphaned,
    // and CASCADE is never used anywhere in this down().
    const [{ n }]: Array<{ n: number }> = await queryRunner.query(
      `SELECT
         (SELECT COUNT(*)::int FROM contracts
            WHERE host_party_role_code = ANY($1::varchar[]))
       + (SELECT COUNT(*)::int FROM projects
            WHERE default_party_role_code = ANY($1::varchar[])) AS n`,
      [SEEDED_1B_PRE_CODES],
    );
    if (Number(n) > 0) {
      throw new Error(
        `Cannot revert 1779000000001: ${n} contract/project row(s) still ` +
          'reference JV_CONTRACTOR or CONSORTIUM_MEMBER. Clear those ' +
          'references first — this migration will not orphan them.',
      );
    }

    // No CASCADE. If anything still blocks this delete, the error surfaces.
    await queryRunner.query(
      `DELETE FROM party_roles WHERE code = ANY($1::varchar[])`,
      [SEEDED_1B_PRE_CODES],
    );
  }
}
