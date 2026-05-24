/**
 * Shared status / type / days-remaining utilities for obligation UI.
 * Lives in components/obligations/ so every obligation surface
 * (ObligationsTab on Contract Detail, ObligationsPage portfolio,
 * ProjectObligationsPage, future calendar view in Step 3) renders
 * the same colours and labels.
 *
 * Phase 7.1 Step 2 — Frontend Foundation
 */

import type {
  ObligationStatus,
  ObligationType,
} from '@/services/api/complianceService';

// ─── Status palette ──────────────────────────────────────────────
//
// Six statuses, four visual buckets. MET and COMPLETED collapse to
// "actioned" (green); IN_PROGRESS keeps its own blue bucket so users
// can distinguish "started" from "done"; WAIVED is intentionally
// muted gray because waivers are valid outcomes, not failures.

export type StatusTone = 'pending' | 'in_progress' | 'actioned' | 'overdue' | 'waived';

export const STATUS_TO_TONE: Record<ObligationStatus, StatusTone> = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'actioned',
  MET: 'actioned',
  OVERDUE: 'overdue',
  WAIVED: 'waived',
};

export const TONE_STYLES: Record<
  StatusTone,
  { bg: string; text: string; dot: string; border: string }
> = {
  pending: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    dot: 'bg-amber-400',
    border: 'border-amber-200',
  },
  in_progress: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    dot: 'bg-blue-400',
    border: 'border-blue-200',
  },
  actioned: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    border: 'border-emerald-200',
  },
  overdue: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
    border: 'border-red-200',
  },
  waived: {
    bg: 'bg-gray-50',
    text: 'text-gray-600',
    dot: 'bg-gray-400',
    border: 'border-gray-200',
  },
};

// ─── Effective status (UI-derived) ───────────────────────────────
//
// If a PENDING / IN_PROGRESS obligation has a due_date in the past,
// the backend will eventually flip it to OVERDUE on the next reminder
// pass — but until that pass runs the UI should show OVERDUE anyway.

export function effectiveStatus(
  status: ObligationStatus,
  dueDate: string | null,
): ObligationStatus {
  if (status === 'PENDING' || status === 'IN_PROGRESS') {
    if (dueDate && new Date(dueDate) < new Date()) return 'OVERDUE';
  }
  return status;
}

// ─── Days-remaining traffic light ────────────────────────────────
//
// Per Step 2 spec:
//   ≥ 14 days remaining → green ("plenty of time")
//   1-13 days remaining → amber ("act soon")
//   ≤ 0 days remaining  → red   ("overdue / due today")

export type DaysTone = 'green' | 'amber' | 'red' | 'neutral';

export function daysUntil(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const ms = new Date(dueDate).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

export function daysTone(days: number | null): DaysTone {
  if (days === null) return 'neutral';
  if (days <= 0) return 'red';
  if (days < 14) return 'amber';
  return 'green';
}

export const DAYS_TONE_STYLES: Record<DaysTone, { text: string; bg: string }> = {
  green: { text: 'text-emerald-700', bg: 'bg-emerald-50' },
  amber: { text: 'text-amber-700', bg: 'bg-amber-50' },
  red: { text: 'text-red-700', bg: 'bg-red-50' },
  neutral: { text: 'text-gray-500', bg: 'bg-gray-50' },
};

// ─── Tier label (for days-remaining indicator) ───────────────────
//
// Returns the i18n key for the reminder tier matching this many
// days. Used both on the row and in the email subject lines.

export function tierKey(
  days: number | null,
): 'overdue' | 'dueToday' | 'days1' | 'days7' | 'days14' | 'days30' | null {
  if (days === null) return null;
  if (days < 0) return 'overdue';
  if (days === 0) return 'dueToday';
  if (days === 1) return 'days1';
  if (days <= 7) return 'days7';
  if (days <= 14) return 'days14';
  if (days <= 30) return 'days30';
  return null;
}

// ─── Status + type i18n key helpers ──────────────────────────────

export function statusLabelKey(s: ObligationStatus): string {
  return `obligation.status.${s}`;
}

export function typeLabelKey(t: ObligationType): string {
  return `obligation.type.${t}`;
}

// All 12 ObligationType values — kept in sync with the backend enum.
// Defined here so filter dropdowns and badge mappings reuse one source.
export const OBLIGATION_TYPES: readonly ObligationType[] = [
  'NOTICE_PERIOD',
  'PAYMENT',
  'PERFORMANCE_BOND',
  'INSURANCE',
  'MILESTONE',
  'DEFECTS_LIABILITY',
  'DISPUTE_RESOLUTION',
  'REPORTING',
  'EMPLOYER_OBLIGATION',
  'CONTRACTOR_OBLIGATION',
  'ENGINEER_OBLIGATION',
  'OTHER',
] as const;

// Six statuses including MET and WAIVED added in Phase 3.4.
export const OBLIGATION_STATUSES: readonly ObligationStatus[] = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'OVERDUE',
  'MET',
  'WAIVED',
] as const;

// ─── KPI bucketing ───────────────────────────────────────────────
//
// Used by ObligationKpiRow to derive Total/Pending/Overdue/Actioned
// counts from a flat array. Single source of truth so the contract
// tab and the portfolio page show consistent numbers.

export interface ObligationKpiCounts {
  total: number;
  pending: number;
  overdue: number;
  actioned: number;
}

export function computeKpis<T extends { status: ObligationStatus; due_date: string | null }>(
  items: T[],
): ObligationKpiCounts {
  let pending = 0;
  let overdue = 0;
  let actioned = 0;
  for (const o of items) {
    const eff = effectiveStatus(o.status, o.due_date);
    if (eff === 'OVERDUE') overdue++;
    else if (eff === 'MET' || eff === 'COMPLETED') actioned++;
    else if (eff === 'PENDING' || eff === 'IN_PROGRESS') pending++;
  }
  return { total: items.length, pending, overdue, actioned };
}
