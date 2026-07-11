import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-tier trunk — Slice T0a.2 corrections (Arabic legal labels).
 *
 * The T0a.1 seed (migration 1768000000001) inserted the 10 relationship-type
 * rows with DRAFT Arabic labels ("pending Youssef's legal-terminology review").
 * That seed is INSERT ... ON CONFLICT (code) DO NOTHING — idempotent and
 * insert-only — so a re-seed will NEVER overwrite the draft labels. The founder
 * has now provided final, legally-reviewed Arabic, so this migration applies it
 * with explicit per-row UPDATEs (the ONLY way to change already-seeded rows).
 *
 * ONLY label_ar changes here. label_en and label_fr are untouched (French is
 * reviewed separately). 5 of the 10 targets equal their T0a.1 seed value
 * (MAIN / SUPPLY_DIRECT / CONSULTANT / USUFRUCT / FRAMEWORK) — updated anyway
 * so the corrected set is explicit and self-documenting; the other 5 change.
 *
 * Additive data-only, no schema change. down() restores the exact T0a.1 seed
 * label_ar values, so up↔down round-trips cleanly. (There is no label-history
 * table, so "prior value" is defined as the T0a.1 seed value — an Ops-hand-edit
 * between T0a.1 and this migration would be reverted to the seed by down(); that
 * is the documented, accepted semantics.)
 */
export class UpdateRelationshipTypeArabicLabels1768000000002
  implements MigrationInterface
{
  name = 'UpdateRelationshipTypeArabicLabels1768000000002';

  // [code, final legally-reviewed label_ar (up), T0a.1 seed label_ar (down)]
  private static readonly ROWS: ReadonlyArray<readonly [string, string, string]> = [
    ['MAIN', 'عقد رئيسي', 'عقد رئيسي'],
    ['SUBCONTRACT', 'عقد الباطن', 'عقد فرعي'],
    ['NOMINATED_SUB', 'عقد باطن مُعيَّن', 'عقد فرعي مُسمّى'],
    ['NOMINATED_SUPPLIER', 'مورّد مُعيَّن', 'مورّد مُسمّى'],
    ['SUPPLY_DIRECT', 'توريد / شراء مباشر', 'توريد / شراء مباشر'],
    ['CONSULTANT', 'تعيين استشاري / مهندس', 'تعيين استشاري / مهندس'],
    ['USUFRUCT', 'حق الانتفاع', 'حق الانتفاع'],
    ['JOINT_VENTURE', 'عقد تحالف', 'مشروع مشترك'],
    ['FRAMEWORK', 'اتفاقية إطارية', 'اتفاقية إطارية'],
    ['NOVATION', 'عقد الإحلال', 'حوالة العقد'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [code, labelAr] of UpdateRelationshipTypeArabicLabels1768000000002.ROWS) {
      await queryRunner.query(
        `UPDATE contract_relationship_types SET label_ar = $1 WHERE code = $2`,
        [labelAr, code],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [code, , seedLabelAr] of UpdateRelationshipTypeArabicLabels1768000000002.ROWS) {
      await queryRunner.query(
        `UPDATE contract_relationship_types SET label_ar = $1 WHERE code = $2`,
        [seedLabelAr, code],
      );
    }
  }
}
