import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 7.19 Slice 1 — counterparty redlining backend spine.
 *
 * `clause_redlines` holds the negotiation loop for clause-level BLOCK-REPLACE
 * proposals: a counterparty (Model A — a real MANAGING account acting via a
 * "Shared with me" guest_contract_access binding) PROPOSES a full new clause
 * body → the HOST accepts / rejects / counters / the author withdraws.
 * Accepting resolves INTO the existing contract version model (snapshot +
 * parent-chain clause promotion) — this table is the negotiation ledger, not
 * a parallel versioning system.
 *
 * Shape notes:
 *  - `contract_clause_id` anchors on the contract_clauses JUNCTION row (the
 *    same stable anchor comments use) — a clause promotion repoints the
 *    junction's clause_id but keeps the junction id, so redline threads
 *    survive accepted rounds.
 *  - `base_content_snapshot` = the active clause body at propose-time. It is
 *    BOTH the diff base for rendering and the staleness guard: an accept
 *    whose current clause content no longer matches it goes STALE instead of
 *    silently clobbering a body the author never saw.
 *  - status / author_identity_source are varchar (the SignatureStatus /
 *    ClauseSource storage convention), NOT pg-native enums — adding a value
 *    later is code-only, no ALTER TYPE.
 *  - FK on-delete follows ownership (lesson #233): contract / junction /
 *    parent-redline CASCADE (owned children of the negotiation), user and
 *    resulting_* references SET NULL (attribution survives principal
 *    deletion; history rows must never dangle-block a version prune).
 *
 * Additive only, no backfill. Idempotent: CREATE TABLE IF NOT EXISTS +
 * pg_constraint-guarded ALTERs + CREATE INDEX IF NOT EXISTS — never
 * EXCEPTION WHEN (lessons #31/#103/#111). No ALTER TYPE — no
 * `transaction = false` needed. Timestamp 1772* — 1771000000001 is already claimed by the parallel
 * guest-signing track (CreateGuestSignSlips1771000000001); identical
 * timestamps would make cross-branch migration ordering ambiguous at merge.
 */
export class CreateClauseRedlines1772000000001 implements MigrationInterface {
  name = 'CreateClauseRedlines1772000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS clause_redlines (
        id                     UUID        NOT NULL DEFAULT gen_random_uuid(),
        contract_id            UUID        NOT NULL,
        contract_clause_id     UUID        NOT NULL,
        round                  INT         NOT NULL DEFAULT 1,
        parent_redline_id      UUID        NULL,
        proposed_title         TEXT        NULL,
        proposed_content       TEXT        NOT NULL,
        note                   TEXT        NULL,
        base_content_snapshot  TEXT        NOT NULL,
        author_user_id         UUID        NULL,
        author_identity_source VARCHAR(20) NOT NULL DEFAULT 'MANAGING_USER',
        status                 VARCHAR(20) NOT NULL DEFAULT 'PROPOSED',
        decided_by_user_id     UUID        NULL,
        decided_at             TIMESTAMPTZ NULL,
        decision_note          TEXT        NULL,
        resulting_version_id   UUID        NULL,
        resulting_clause_id    UUID        NULL,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_clause_redlines PRIMARY KEY (id)
      )
    `);

    const fk = (name: string, ddl: string) => `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
          ALTER TABLE clause_redlines ADD CONSTRAINT "${name}" ${ddl};
        END IF;
      END $$;
    `;

    await queryRunner.query(
      fk(
        'fk_clause_redlines_contract',
        `FOREIGN KEY (contract_id) REFERENCES contracts (id) ON DELETE CASCADE`,
      ),
    );
    await queryRunner.query(
      fk(
        'fk_clause_redlines_contract_clause',
        `FOREIGN KEY (contract_clause_id) REFERENCES contract_clauses (id) ON DELETE CASCADE`,
      ),
    );
    await queryRunner.query(
      fk(
        'fk_clause_redlines_parent_redline',
        `FOREIGN KEY (parent_redline_id) REFERENCES clause_redlines (id) ON DELETE CASCADE`,
      ),
    );
    await queryRunner.query(
      fk(
        'fk_clause_redlines_author_user',
        `FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE SET NULL`,
      ),
    );
    await queryRunner.query(
      fk(
        'fk_clause_redlines_decided_by_user',
        `FOREIGN KEY (decided_by_user_id) REFERENCES users (id) ON DELETE SET NULL`,
      ),
    );
    await queryRunner.query(
      fk(
        'fk_clause_redlines_resulting_version',
        `FOREIGN KEY (resulting_version_id) REFERENCES contract_versions (id) ON DELETE SET NULL`,
      ),
    );
    await queryRunner.query(
      fk(
        'fk_clause_redlines_resulting_clause',
        `FOREIGN KEY (resulting_clause_id) REFERENCES clauses (id) ON DELETE SET NULL`,
      ),
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_clause_redlines_contract_clause_status
        ON clause_redlines (contract_id, contract_clause_id, status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS clause_redlines`);
  }
}
