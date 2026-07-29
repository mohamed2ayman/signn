import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 7.22 Slice 1 — the Contract Playbook DATA LAYER.
 *
 * `playbook_positions` stores ONE org's standard position for ONE clause type
 * ("payment terms: 28-45 days", "retention: max 10%"). NEXT_PHASES 7.22 scopes
 * this as an org-level, OWNER_ADMIN-only Settings surface; Slice 1 ships the
 * table + CRUD only. NOTHING reads it yet — the resolver, the compliance feed,
 * and the UI are Slice 2/3.
 *
 * TENANCY: `organization_id` is carried DIRECTLY and is the tenancy root of
 * every read and write, so this table is ORG-scoped, NOT contract-scoped — the
 * same class as `erp_connections`, and therefore outside the Option B contract
 * chokepoint. `project_id` / `contract_id` are NARROWING columns only: they
 * scope a position DOWN inside an org that already owns the row, and are never
 * consulted to establish tenancy.
 *
 * SOFT-CODE COLUMNS: `scope` and `rule_type` are varchar + a CHECK constraint,
 * NOT pg enums — the RedlineStatus / relationship_type / role_code convention.
 * Widening either is then a code change plus a one-line CHECK swap, never an
 * `ALTER TYPE` (CLAUDE.md ARCHITECTURE RULE 10). The CHECK is mirrored from the
 * sibling `redline_notification_batches_event_class_check` precedent
 * (1773000000001), which constrains its varchar-enum the same way.
 *
 * `clause_type` deliberately has NO allowlist: 7.22 explicitly requires "any
 * custom clause type the org wants to track". `is_custom_clause_type` is the
 * discriminator between a standard key and an org-invented one.
 *
 * SCOPE-COHERENCE CHECK: `scope` and the two narrowing columns must agree, or
 * the Slice-2 resolver reads a corrupt row (e.g. scope='PROJECT' with a NULL
 * project_id would resolve as "unscoped"). Enforced at the DB so no code path —
 * including a future importer or a manual SQL fix — can create that state:
 *   ORG      → project_id IS NULL AND contract_id IS NULL
 *   PROJECT  → project_id IS NOT NULL AND contract_id IS NULL
 *   CONTRACT → contract_id IS NOT NULL (project_id optional: the contract's
 *              parent project may be denormalized in for the resolver)
 *
 * FK on-delete follows OWNERSHIP (lesson #233):
 *   organization_id → CASCADE   the org owns the row; without it the row is
 *                               meaningless (mirrors erp_connections).
 *   project_id      → CASCADE   a PROJECT-scoped position exists only to narrow
 *                               to that project. SET NULL was REJECTED: it
 *                               would leave scope='PROJECT' with project_id
 *                               NULL, which the scope-coherence CHECK above
 *                               forbids — i.e. SET NULL would make deleting a
 *                               project fail outright.
 *   contract_id     → CASCADE   same argument as project_id.
 *   created_by      → SET NULL  an ACTOR reference, not structure. Deleting the
 *                               admin who authored a position must NOT delete
 *                               the org's standard position (the granted_by /
 *                               revoked_by precedent on guest_contract_access).
 *
 * Index rationale — honest accounting, since every index is a real write cost:
 *   - (organization_id) — the tenancy predicate present on EVERY query. Serves
 *     the plain org-wide list and is the fallback for any filter combination
 *     the two composites below do not cover.
 *   - (organization_id, scope, project_id, contract_id) — shaped for the
 *     Slice-2 resolver, whose lookup is "all positions visible to THIS contract"
 *     = org + the three scope tiers. Leading column is still organization_id so
 *     it is usable for org-only probes too.
 *   - (organization_id, clause_type) — "what is our position on <clause_type>?",
 *     the per-clause lookup the deviation check will make once per clause.
 *   These three are exactly the index set the prompt specifies; no speculative
 *   index is added beyond them. They are NOT partial: unlike the
 *   guest_contract_access revocation case there is no dead-row class here
 *   (`is_active=false` rows stay queryable — deactivating is reversible and the
 *   Settings UI must still list them).
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS, never
 * `EXCEPTION WHEN` (lessons #31/#103/#111). No ALTER TYPE, so no
 * `transaction = false` needed. down() drops indexes then the table; the
 * inline constraints go with the table. down↔up round-trip verified.
 */
export class CreatePlaybookPositions1775000000001 implements MigrationInterface {
  name = 'CreatePlaybookPositions1775000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS playbook_positions (
        id                    uuid         NOT NULL DEFAULT gen_random_uuid(),
        organization_id       uuid         NOT NULL,
        scope                 varchar(20)  NOT NULL DEFAULT 'ORG',
        project_id            uuid         NULL,
        contract_id           uuid         NULL,
        clause_type           varchar(100) NOT NULL,
        is_custom_clause_type boolean      NOT NULL DEFAULT false,
        rule_type             varchar(20)  NOT NULL,
        value_config          jsonb        NOT NULL,
        note                  text         NULL,
        is_active             boolean      NOT NULL DEFAULT true,
        created_by            uuid         NULL,
        created_at            timestamptz  NOT NULL DEFAULT now(),
        updated_at            timestamptz  NOT NULL DEFAULT now(),

        CONSTRAINT pk_playbook_positions PRIMARY KEY (id),

        -- Soft-code columns constrained at the DB, not as pg enums.
        CONSTRAINT playbook_positions_scope_check
          CHECK (scope IN ('ORG', 'PROJECT', 'CONTRACT')),
        CONSTRAINT playbook_positions_rule_type_check
          CHECK (rule_type IN ('RANGE', 'THRESHOLD', 'ENUM', 'REQUIRED', 'TEXT')),

        -- scope and the narrowing columns must agree — see the header note.
        CONSTRAINT playbook_positions_scope_coherence_check CHECK (
          (scope = 'ORG'      AND project_id IS NULL     AND contract_id IS NULL)
          OR
          (scope = 'PROJECT'  AND project_id IS NOT NULL AND contract_id IS NULL)
          OR
          (scope = 'CONTRACT' AND contract_id IS NOT NULL)
        ),

        CONSTRAINT fk_playbook_positions_organization
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_playbook_positions_project
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT fk_playbook_positions_contract
          FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
        CONSTRAINT fk_playbook_positions_created_by
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // The tenancy predicate on every query.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_playbook_positions_organization_id
        ON playbook_positions (organization_id)
    `);

    // Shaped for the Slice-2 scope-precedence resolver.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_playbook_positions_org_scope
        ON playbook_positions (organization_id, scope, project_id, contract_id)
    `);

    // "What is our position on <clause_type>?" within an org.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_playbook_positions_org_clause_type
        ON playbook_positions (organization_id, clause_type)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_playbook_positions_org_clause_type`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_playbook_positions_org_scope`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_playbook_positions_organization_id`,
    );
    // Inline PK / CHECK / FK constraints are dropped with the table.
    await queryRunner.query(`DROP TABLE IF EXISTS playbook_positions`);
  }
}
