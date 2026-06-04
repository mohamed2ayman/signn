import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.18 — Metering Primitive (Part 1: engine only).
 *
 * Generic meter keyed by (subject, meter_key). Append-only ledger is source of
 * truth; metering_balance is a derived projection that holds the running
 * counter used for the atomic conditional decrement on reserve.
 *
 * SUBJECT = the org that owns the contract in scope (NEVER a guest's
 * User.organization_id directly — see metering-resolver.service.ts).
 *
 * RUN-COUNT METERING FOR v1. unit='run', amount=1 per call. Token-true-cost is
 * deliberately deferred to a later phase (audit §3 / §B.4) — the ledger's
 * metadata jsonb reserves room for it.
 *
 * Five tables + four enums:
 *   meter_definitions  (catalogue + per-meter defaults — PK is the meter_key enum)
 *   plan_allowances    (per-plan overrides — FK plan_id → subscription_plans.id)
 *   subject_allowances (per-org overrides on top of plan)
 *   metering_ledger    (append-only with status reserved | committed | released)
 *   metering_balance   (derived projection — the hot counter)
 *
 * Idempotency: lessons #31/#103/#111/#143 — every block uses `IF NOT EXISTS`
 * guards, no `EXCEPTION WHEN` swallowing. Enum names follow the post-#143
 * verbose convention. transaction = false because we use ALTER-style
 * idempotent DDL throughout (defensive — these specific CREATE TYPE / TABLE
 * statements could run in a transaction, but matching the established
 * Phase 7.18 migration shape keeps the pattern consistent).
 *
 * Seeding: ONLY the `compliance` meter_definition row is seeded in Part 1.
 * default_limit = 1000 is a PLACEHOLDER awaiting real numbers from Youssef +
 * Ayman with cost data. Do NOT treat as authoritative.
 */
export class AddMeteringPrimitive1753000000001 implements MigrationInterface {
  name = 'AddMeteringPrimitive1753000000001';

  // Mirrors the Phase 7.18 bucket 1a migration. Pure DDL would be transaction-
  // safe here, but per-migration `transaction = false` is the established
  // pattern for the metering-adjacent migrations on this branch.
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. Closed enums ──────────────────────────────────────────────────
    // meter_key — the CLOSED set of metered dimensions for v1. Adding a new
    // value later is a deliberate migration (`ALTER TYPE meter_key_enum ADD
    // VALUE`) — never write code that strings-in a meter_key.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meter_key_enum') THEN
          CREATE TYPE meter_key_enum AS ENUM (
            'compliance',
            'risk',
            'ai_assistant_message',
            'upload_extraction'
          );
        END IF;
      END $$
    `);

    // window_type — drives MeteringResolver.computeWindowKey().
    //   per_contract     → window_key = contract id
    //   rolling          → window_key = sliding period bucket
    //   calendar_period  → window_key = e.g. ISO month string
    //   lifetime         → window_key = constant 'lifetime'
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meter_window_type_enum') THEN
          CREATE TYPE meter_window_type_enum AS ENUM (
            'rolling',
            'calendar_period',
            'per_contract',
            'lifetime'
          );
        END IF;
      END $$
    `);

    // fail_mode — what happens when the METER ITSELF errors (not when limit
    // is reached). 'closed' denies on resolver error (safe default for billed
    // surfaces); 'open' allows. compliance is 'closed'.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meter_fail_mode_enum') THEN
          CREATE TYPE meter_fail_mode_enum AS ENUM ('closed', 'open');
        END IF;
      END $$
    `);

    // ledger row lifecycle: reserved → committed (work succeeded) | released
    // (work failed; capacity returned to balance).
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meter_ledger_status_enum') THEN
          CREATE TYPE meter_ledger_status_enum AS ENUM (
            'reserved',
            'committed',
            'released'
          );
        END IF;
      END $$
    `);

    // ─── 2. meter_definitions ─────────────────────────────────────────────
    // The catalogue. PK is the meter_key itself — exactly one definition per
    // key. Adding a definition row is what "activates" a meter for ops.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS meter_definitions (
        meter_key      meter_key_enum PRIMARY KEY,
        unit           VARCHAR(20) NOT NULL DEFAULT 'run',
        window_type    meter_window_type_enum NOT NULL,
        fail_mode      meter_fail_mode_enum NOT NULL DEFAULT 'closed',
        default_limit  INTEGER NOT NULL CHECK (default_limit >= 0),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ─── 3. plan_allowances ───────────────────────────────────────────────
    // Per-plan override of default_limit. Resolution order:
    //   subject_allowance ?? plan_allowance ?? meter_definition.default_limit
    // FK to subscription_plans is ON DELETE CASCADE — deleting a plan
    // removes its allowance rows. FK to meter_definitions is RESTRICT —
    // can't delete a meter definition that has live plan rows pointing at
    // it (prevents accidental config loss).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS plan_allowances (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id     UUID NOT NULL
          REFERENCES subscription_plans(id) ON DELETE CASCADE,
        meter_key   meter_key_enum NOT NULL
          REFERENCES meter_definitions(meter_key) ON DELETE RESTRICT,
        "limit"     INTEGER NOT NULL CHECK ("limit" >= 0),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_plan_allowances_plan_meter
          UNIQUE (plan_id, meter_key)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plan_allowances_plan_id
        ON plan_allowances (plan_id)
    `);

    // ─── 4. subject_allowances ────────────────────────────────────────────
    // Per-subject (per-org) override. Side table, NOT colocated with
    // subscription_plans.features — audit §B.7 documents the choice
    // (auditable + more tables, vs harder-to-audit jsonb inside the plan
    // row). FK to organizations is ON DELETE CASCADE.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subject_allowances (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_ref  UUID NOT NULL
          REFERENCES organizations(id) ON DELETE CASCADE,
        meter_key    meter_key_enum NOT NULL
          REFERENCES meter_definitions(meter_key) ON DELETE RESTRICT,
        "limit"      INTEGER NOT NULL CHECK ("limit" >= 0),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_subject_allowances_subject_meter
          UNIQUE (subject_ref, meter_key)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_subject_allowances_subject_ref
        ON subject_allowances (subject_ref)
    `);

    // ─── 5. metering_ledger ───────────────────────────────────────────────
    // Append-only. Pattern C idempotency: UNIQUE (subject_ref, meter_key,
    // idempotency_key) — re-submitting the same key returns the existing row
    // unchanged (no error, no double-charge), matching the existing
    // composite-unique-then-return-existing shape of guest-invitation
    // revoke/exchange/establish-identity.
    //
    // No FK on actor_ref / contract_ref — both can outlive the referenced
    // row (legitimate: we still want the ledger entry for audit even if the
    // contract is later deleted). actor_ref/contract_ref are attribution,
    // NOT subject.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS metering_ledger (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_ref     UUID NOT NULL
          REFERENCES organizations(id) ON DELETE RESTRICT,
        actor_ref       UUID NOT NULL,
        contract_ref    UUID NULL,
        meter_key       meter_key_enum NOT NULL
          REFERENCES meter_definitions(meter_key) ON DELETE RESTRICT,
        window_key      VARCHAR(128) NOT NULL,
        amount          INTEGER NOT NULL CHECK (amount > 0),
        status          meter_ledger_status_enum NOT NULL DEFAULT 'reserved',
        idempotency_key VARCHAR(128) NOT NULL,
        reservation_id  UUID NOT NULL,
        reserved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at      TIMESTAMPTZ NOT NULL,
        committed_at    TIMESTAMPTZ NULL,
        released_at     TIMESTAMPTZ NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT uq_metering_ledger_subject_meter_idem
          UNIQUE (subject_ref, meter_key, idempotency_key),
        CONSTRAINT uq_metering_ledger_reservation_id
          UNIQUE (reservation_id)
      )
    `);

    // Sweep index — partial, exactly matches the sweeper's WHERE shape so
    // the planner picks Bitmap Index Scan even at scale (audit §C.5,
    // lesson #134/#135 about partial-index predicate alignment).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_metering_ledger_reserved_expires_at
        ON metering_ledger (expires_at)
        WHERE status = 'reserved'
    `);

    // Subject-scoped lookups (admin "show this org's recent meter activity"
    // and reconcile from-job-id paths).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_metering_ledger_subject_meter
        ON metering_ledger (subject_ref, meter_key)
    `);

    // ─── 6. metering_balance ──────────────────────────────────────────────
    // Derived projection — the hot counter the atomic conditional UPDATE
    // operates on. Composite PK is (subject_ref, meter_key, window_key)
    // because that's the unique key per (org, meter, window) the reserve
    // step writes to. consumed >= 0 invariant guarded by CHECK; release
    // must never drive consumed below 0 (sweeper / release path tested).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS metering_balance (
        subject_ref  UUID NOT NULL
          REFERENCES organizations(id) ON DELETE CASCADE,
        meter_key    meter_key_enum NOT NULL
          REFERENCES meter_definitions(meter_key) ON DELETE RESTRICT,
        window_key   VARCHAR(128) NOT NULL,
        consumed     INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_metering_balance
          PRIMARY KEY (subject_ref, meter_key, window_key)
      )
    `);

    // ─── 7. Seed ONLY the compliance meter_definition ─────────────────────
    // Other three meter_keys (risk, ai_assistant_message, upload_extraction)
    // are DEFINED in the enum (so the closed-set contract is in place) but
    // intentionally NOT seeded — their definition rows land when each
    // consumer is wired in Part 2 (the windows + fail_modes get decided then).
    //
    // default_limit = 1000 is a PLACEHOLDER. Real numbers come from Youssef +
    // Ayman with actual cost data later. Never hardcode a "real" limit here.
    await queryRunner.query(`
      INSERT INTO meter_definitions
        (meter_key, unit, window_type, fail_mode, default_limit)
      VALUES
        ('compliance', 'run', 'per_contract', 'closed', 1000)
      ON CONFLICT (meter_key) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order — drop the things with FKs first.
    await queryRunner.query(`DROP TABLE IF EXISTS metering_balance`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_metering_ledger_subject_meter`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_metering_ledger_reserved_expires_at`);
    await queryRunner.query(`DROP TABLE IF EXISTS metering_ledger`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_subject_allowances_subject_ref`);
    await queryRunner.query(`DROP TABLE IF EXISTS subject_allowances`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_plan_allowances_plan_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS plan_allowances`);
    await queryRunner.query(`DROP TABLE IF EXISTS meter_definitions`);

    // Drop the enums LAST.
    await queryRunner.query(`DROP TYPE IF EXISTS meter_ledger_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS meter_fail_mode_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS meter_window_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS meter_key_enum`);
  }
}
