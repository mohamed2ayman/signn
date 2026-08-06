import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The 11 codes this migration activates — the exact set up() flips TRUE and
 * the exact set down() flips back FALSE. Declared once so the two directions
 * can never drift apart (the 1776000000001 / 1779000000001 convention).
 *
 * This list is byte-identical to the 11 codes seeded is_active = FALSE by
 * 1776000000001. No other row is named here, so no other row is touched —
 * including the 13 already-active codes and the two TEST_* rows that a
 * killed contract-parties.real-pg.spec.ts run can leave behind.
 */
const SLICE_1B_ACTIVATED_CODES = [
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
 * Party Foundation — Slice 1b: ACTIVATE the 11 roles seeded by 1776000000001.
 *
 * 1776000000001 deliberately seeded these is_active = FALSE: they were NEW
 * vocabulary awaiting the Slice 1b visual review, and staying inactive kept
 * them hidden from GET /party-roles (which defaults to active-only) and
 * REJECTED by the ContractsService / ProjectsService write validators. That
 * review is what Slice 1b delivers, so this migration flips the gate.
 *
 * REGISTRY DATA ONLY. No schema change, no new column, no new code — this is
 * a single UPDATE of a boolean on 11 existing rows.
 *
 * Resulting state: 24 non-TEST codes, ALL 24 active.
 *   before — 13 active / 11 inactive
 *   after  — 24 active /  0 inactive
 *
 * Nothing is renumbered: sort_order and category were both set by
 * 1776000000001 and are untouched here. Their interleaved sort_order values
 * (11, 12, 21, 31, 61, 81, 82, 91, 92, 101, 102) already sit inside the
 * existing 10..110 sequence, so activation changes visibility only.
 *
 * Idempotent: re-running sets TRUE on rows already TRUE — a no-op. A code
 * absent from party_roles simply matches nothing. Never EXCEPTION WHEN
 * (lessons #31/#103/#111). No ALTER TYPE — no `transaction = false` needed.
 */
export class ActivatePartyFoundationRoles1780000000001
  implements MigrationInterface
{
  name = 'ActivatePartyFoundationRoles1780000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE party_roles SET is_active = TRUE WHERE code = ANY($1::varchar[])`,
      [SLICE_1B_ACTIVATED_CODES],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restores the exact pre-Slice-1b state: these 11 become unselectable
    // again (hidden from GET /party-roles, rejected by the write validators).
    //
    // Deliberately NO reference guard and NO throw, unlike 1779000000001's
    // down(). That one DELETEs rows, which would orphan a soft varchar
    // reference from contracts.host_party_role_code /
    // projects.default_party_role_code. This one only flips a boolean — the
    // registry rows survive, so an existing reference is never orphaned and
    // its stored value is never lost.
    //
    // Known, accepted consequence: a contract/project that already stored one
    // of these codes keeps that value, but the picker will no longer offer it,
    // so the control renders unset until someone picks an active role. That is
    // the correct meaning of reverting a visibility flag — and blocking the
    // revert with a throw would make a routine rollback of a UI slice
    // impossible.
    await queryRunner.query(
      `UPDATE party_roles SET is_active = FALSE WHERE code = ANY($1::varchar[])`,
      [SLICE_1B_ACTIVATED_CODES],
    );
  }
}
