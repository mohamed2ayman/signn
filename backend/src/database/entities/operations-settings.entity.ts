import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * OperationsSettings — singleton row (id = 'global') holding platform-wide
 * operations-review configuration. v1 holds one field: the AI confidence
 * threshold (default 90) shown on the ops-review admin screen.
 *
 * Mirrors the SecurityPolicy singleton (id='global', one seeded row). This
 * replaces an on-disk JSON file — path.resolve(__dirname,
 * '../../config/operations-config.json') — which on ECS is lost on every
 * redeploy (ephemeral disk) and diverges across replicas (per-task disk).
 * The DB row is now the single source of truth.
 */
@Entity('operations_settings')
export class OperationsSettings {
  /** Always 'global' for v1 — per-org overrides are out of scope. */
  @PrimaryColumn({ type: 'varchar', length: 20 })
  id: string;

  /** AI confidence threshold (0-100) for the ops-review queue. Default 90. */
  @Column({ type: 'int', default: 90 })
  confidence_threshold: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
