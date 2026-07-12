import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Risk-tab clutter reduction — per-clause chosen VISIBLE risk set (the "swap"
 * override). One row per contract_clause junction; its presence overrides the
 * deterministic default top-2 with exactly the 2 chosen visible risk ids.
 * Global (not per-user) — the annotation corpus has ONE canonical visible set
 * per clause for the gold export. See migration 1770000000004.
 */
@Entity('risk_clause_visibility')
export class RiskClauseVisibility {
  @PrimaryColumn({ type: 'uuid' })
  contract_clause_id: string;

  @Column({ type: 'uuid', array: true })
  visible_risk_ids: string[];

  @Column({ type: 'uuid', nullable: true })
  updated_by: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
