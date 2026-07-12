import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * i18n French finalization — party_roles + contract_relationship_types labels.
 *
 * Both registries were seeded (migrations 1770000000001 party_roles /
 * 1768000000001 relationship types) with DRAFT French labels "pending
 * Youssef's legal-terminology review". Those seeds are INSERT ... ON CONFLICT
 * (code) DO NOTHING — insert-only — so a re-seed will NEVER overwrite them.
 * The founder has now provided final, legally-reviewed French, so this
 * migration applies it with explicit per-row UPDATEs (the only way to change
 * already-seeded rows). Mirrors the 1768000000002 Arabic-label pattern.
 *
 * SCOPE — label_fr ONLY. label_en and label_ar are untouched on every row
 * (per founder decision: e.g. BENEFICIARY.label_fr moves to "Usufruitier"
 * while its EN "Beneficiary" / AR "المنتفع" stay). No description column is
 * added or touched — French descriptions ride separately with the T0c-2
 * frontend work as a fr/common.json locale change, NOT a DB migration.
 *
 * ONLY the 8 rows whose DRAFT French actually differs from the final are
 * updated (2 party_roles + 6 relationship types); the 13 already-matching
 * rows are deliberately left alone. Parameterized queries store the exact
 * UTF-8 / ASCII-apostrophe (0x27) strings verbatim (e.g. "Groupement
 * d'entreprises") — no manual escaping.
 *
 * Additive data-only, no schema change. down() restores the exact captured
 * pre-migration label_fr (the DRAFT seed value), so up↔down round-trips
 * cleanly. (There is no label-history table, so "prior value" is defined as
 * the seed value read at recon; an Ops-hand-edit between the seed and this
 * migration would be reverted to the seed by down() — the documented,
 * accepted semantics, same as 1768000000002.)
 *
 * Idempotent forward: each UPDATE ... WHERE code = $2 is safe to re-run.
 */
export class FinalizeFrenchPartyAndRelationshipLabels1770000000002
  implements MigrationInterface
{
  name = 'FinalizeFrenchPartyAndRelationshipLabels1770000000002';

  // [code, final label_fr (up), captured DRAFT label_fr (down)]
  private static readonly PARTY_ROLE_ROWS: ReadonlyArray<
    readonly [string, string, string]
  > = [
    ['COST_CONSULTANT', 'Consultant en coûts', 'Économiste de la construction'],
    ['BENEFICIARY', 'Usufruitier', 'Bénéficiaire'],
  ];

  private static readonly RELATIONSHIP_TYPE_ROWS: ReadonlyArray<
    readonly [string, string, string]
  > = [
    ['SUBCONTRACT', 'Contrat de sous-traitance', 'Sous-contrat'],
    ['NOMINATED_SUB', 'Sous-traitance désignée', 'Sous-contrat désigné'],
    ['NOMINATED_SUPPLIER', 'Fourniture désignée', 'Fournisseur désigné'],
    ['SUPPLY_DIRECT', 'Fourniture directe', 'Fourniture / Achat direct'],
    [
      'CONSULTANT',
      'Désignation de consultant / ingénieur',
      'Nomination de consultant / ingénieur',
    ],
    ['JOINT_VENTURE', "Groupement d'entreprises", 'Coentreprise'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [code, labelFr] of FinalizeFrenchPartyAndRelationshipLabels1770000000002.PARTY_ROLE_ROWS) {
      await queryRunner.query(
        `UPDATE party_roles SET label_fr = $1 WHERE code = $2`,
        [labelFr, code],
      );
    }
    for (const [code, labelFr] of FinalizeFrenchPartyAndRelationshipLabels1770000000002.RELATIONSHIP_TYPE_ROWS) {
      await queryRunner.query(
        `UPDATE contract_relationship_types SET label_fr = $1 WHERE code = $2`,
        [labelFr, code],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [code, , draftLabelFr] of FinalizeFrenchPartyAndRelationshipLabels1770000000002.PARTY_ROLE_ROWS) {
      await queryRunner.query(
        `UPDATE party_roles SET label_fr = $1 WHERE code = $2`,
        [draftLabelFr, code],
      );
    }
    for (const [code, , draftLabelFr] of FinalizeFrenchPartyAndRelationshipLabels1770000000002.RELATIONSHIP_TYPE_ROWS) {
      await queryRunner.query(
        `UPDATE contract_relationship_types SET label_fr = $1 WHERE code = $2`,
        [draftLabelFr, code],
      );
    }
  }
}
