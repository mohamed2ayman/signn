/**
 * Guest version review — Sub-slice 2c. Pure model + DTO builders for the host
 * review/merge screen. Bridges the 2b compare result (diff, keyed by
 * section_number, carrying Clause.id) to the 2a apply DTO (which needs the
 * is_proposed junction-row ids + the live junction-row id a clause replaces).
 *
 * The bridge joins three reads, client-side:
 *   - compare  → the diff (summary + changes)
 *   - proposed → getProposedClauses (ContractClause[]; .id = proposed_contract_clause_id)
 *   - live     → getClauses (ContractClause[]; .id = replaces / removal target)
 * by clause_id (ADDED/MODIFIED proposed, REMOVED live) and section_number
 * (MODIFIED → live counterpart). No backend change is needed.
 */
import type {
  ApplyProposedVersionDto,
  ContractClause,
  VersionDiffChange,
} from '@/types';
import {
  coalesceWordDiffToWholeWords,
  countEditGroups,
  type DiffSeg,
} from '@/components/versions/wordDiff';

export type ReviewKind = 'modify' | 'add' | 'remove';
export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'merged';

export interface ReviewItem {
  /** Stable UI id: proposed junction id (add/modify) or live junction id (remove). */
  id: string;
  kind: ReviewKind;
  sectionNumber: string | null;
  title: string;
  category: string | null; // clause_type (null → general)
  confidence: number | null; // 0..1 — only present when the extractor scored it
  /** Coalesced word diff (modify only). */
  wordLevelDiff: DiffSeg[] | null;
  originalText: string | null;
  proposedText: string | null;
  editsCount: number;
  // ── apply-DTO mapping ──
  proposedContractClauseId: string | null; // add / modify
  replacesContractClauseId: string | null; // modify (live junction id)
  removalContractClauseId: string | null; // remove (live junction id)
}

export interface UnchangedItem {
  id: string;
  sectionNumber: string | null;
  title: string;
  category: string | null;
  body: string;
}

export interface ReviewModel {
  changed: ReviewItem[];
  unchanged: UnchangedItem[];
  totalClauses: number;
  counts: { modified: number; added: number; removed: number; unchanged: number };
  /** Every proposed junction id (for consuming unchanged duplicates on apply). */
  allProposedClauseIds: string[];
}

// ── Category → label + dot color (design palette) ────────────────────────────
const CATEGORY_META: Record<string, { label: string; color: string }> = {
  payment: { label: 'Payment', color: '#0D6EFD' },
  liability: { label: 'Liability', color: '#D83A47' },
  indemnification: { label: 'Liability', color: '#D83A47' },
  termination: { label: 'Termination', color: '#D83A47' },
  time: { label: 'Schedule', color: '#C8861A' },
  variations: { label: 'Schedule', color: '#C8861A' },
  defects: { label: 'Schedule', color: '#C8861A' },
  warranty: { label: 'Quality', color: '#0F9D8A' },
  insurance: { label: 'Quality', color: '#0F9D8A' },
  compliance: { label: 'Quality', color: '#0F9D8A' },
  scope_of_work: { label: 'Scope', color: '#0F9D8A' },
  force_majeure: { label: 'Legal', color: '#7A5AF0' },
  dispute_resolution: { label: 'Legal', color: '#7A5AF0' },
  confidentiality: { label: 'Legal', color: '#7A5AF0' },
  intellectual_property: { label: 'Legal', color: '#7A5AF0' },
  general: { label: 'General', color: '#8A93A0' },
  other: { label: 'General', color: '#8A93A0' },
};

const titleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function categoryMeta(clauseType: string | null | undefined): {
  label: string;
  color: string;
} {
  if (!clauseType) return { label: 'General', color: '#8A93A0' };
  return CATEGORY_META[clauseType] ?? { label: titleCase(clauseType), color: '#8A93A0' };
}

// ── Build the review model ───────────────────────────────────────────────────
const sectionKey = (s: string | null | undefined) =>
  s && s.trim() ? s.trim() : null;

export function buildReviewModel(
  changes: VersionDiffChange[],
  proposed: ContractClause[],
  live: ContractClause[],
): ReviewModel {
  const propByClauseId = new Map(proposed.map((cc) => [cc.clause_id, cc]));
  const liveByClauseId = new Map(live.map((cc) => [cc.clause_id, cc]));
  const liveBySection = new Map<string, ContractClause>();
  for (const cc of live) {
    const k = sectionKey(cc.section_number);
    if (k) liveBySection.set(k, cc);
  }

  const changed: ReviewItem[] = [];
  const unchanged: UnchangedItem[] = [];

  for (const ch of changes) {
    if (ch.changeType === 'MODIFIED') {
      const propCC = propByClauseId.get(ch.clauseId);
      if (!propCC) continue; // diff B-side is the proposed set; should always match
      const liveCC = ch.clauseNumber ? liveBySection.get(ch.clauseNumber.trim()) : undefined;
      const wld = coalesceWordDiffToWholeWords(ch.wordLevelDiff);
      changed.push({
        id: propCC.id,
        kind: 'modify',
        sectionNumber: ch.clauseNumber,
        title: ch.clauseTitle || propCC.clause?.title || '',
        category: propCC.clause?.clause_type ?? null,
        confidence: propCC.clause?.confidence_score ?? null,
        wordLevelDiff: wld,
        originalText: ch.originalText,
        proposedText: ch.newText,
        editsCount: countEditGroups(wld),
        proposedContractClauseId: propCC.id,
        replacesContractClauseId: liveCC?.id ?? null,
        removalContractClauseId: null,
      });
    } else if (ch.changeType === 'ADDED') {
      const propCC = propByClauseId.get(ch.clauseId);
      if (!propCC) continue;
      changed.push({
        id: propCC.id,
        kind: 'add',
        sectionNumber: ch.clauseNumber,
        title: ch.clauseTitle || propCC.clause?.title || '',
        category: propCC.clause?.clause_type ?? null,
        confidence: propCC.clause?.confidence_score ?? null,
        wordLevelDiff: null,
        originalText: null,
        proposedText: ch.newText,
        editsCount: 0,
        proposedContractClauseId: propCC.id,
        replacesContractClauseId: null,
        removalContractClauseId: null,
      });
    } else if (ch.changeType === 'REMOVED') {
      const liveCC = liveByClauseId.get(ch.clauseId);
      if (!liveCC) continue;
      changed.push({
        id: liveCC.id,
        kind: 'remove',
        sectionNumber: ch.clauseNumber,
        title: ch.clauseTitle || liveCC.clause?.title || '',
        category: liveCC.clause?.clause_type ?? null,
        confidence: liveCC.clause?.confidence_score ?? null,
        wordLevelDiff: null,
        originalText: ch.originalText,
        proposedText: null,
        editsCount: 0,
        proposedContractClauseId: null,
        replacesContractClauseId: null,
        removalContractClauseId: liveCC.id,
      });
    } else {
      // UNCHANGED
      const propCC = propByClauseId.get(ch.clauseId);
      unchanged.push({
        id: propCC?.id ?? ch.clauseId,
        sectionNumber: ch.clauseNumber,
        title: ch.clauseTitle || propCC?.clause?.title || '',
        category: propCC?.clause?.clause_type ?? null,
        body: ch.newText ?? ch.originalText ?? '',
      });
    }
  }

  // Preserve the backend's "changed first" ordering; within changed keep
  // ADDED/REMOVED/MODIFIED order the backend already sorted by.
  const counts = {
    modified: changed.filter((c) => c.kind === 'modify').length,
    added: changed.filter((c) => c.kind === 'add').length,
    removed: changed.filter((c) => c.kind === 'remove').length,
    unchanged: unchanged.length,
  };

  return {
    changed,
    unchanged,
    totalClauses: changed.length + unchanged.length,
    counts,
    allProposedClauseIds: proposed.map((cc) => cc.id),
  };
}

// ── Build the apply DTO from the host's accumulated decisions ─────────────────
/**
 * Translate the host's per-clause decisions into the backend ApplyProposedVersionDto.
 * Unchanged proposed clauses (identical duplicates the host never acted on) are
 * auto-`reject`ed so the version is fully consumed — the live clause is untouched
 * by a reject, so this is a clean discard of the duplicate, NOT a contract change.
 * The host-facing counts shown in the UI come from `statuses`, never from this.
 */
export function buildApplyDto(
  items: ReviewItem[],
  statuses: Record<string, ReviewStatus>,
  mergedText: Record<string, string>,
  allProposedClauseIds: string[],
  changeSummary?: string,
): ApplyProposedVersionDto {
  const decisions: ApplyProposedVersionDto['decisions'] = [];
  const removals: NonNullable<ApplyProposedVersionDto['removals']> = [];
  const decidedProposed = new Set<string>();

  for (const item of items) {
    const st = statuses[item.id] ?? 'pending';

    if (item.kind === 'remove') {
      if (st === 'accepted' && item.removalContractClauseId) {
        removals.push({ contract_clause_id: item.removalContractClauseId, action: 'accept' });
      }
      // rejected removal = keep the clause = no-op (omit)
      continue;
    }

    if (!item.proposedContractClauseId) continue;
    decidedProposed.add(item.proposedContractClauseId);

    if (st === 'accepted') {
      decisions.push({
        proposed_contract_clause_id: item.proposedContractClauseId,
        action: 'accept',
        ...(item.replacesContractClauseId
          ? { replaces_contract_clause_id: item.replacesContractClauseId }
          : {}),
      });
    } else if (st === 'merged') {
      decisions.push({
        proposed_contract_clause_id: item.proposedContractClauseId,
        action: 'edit',
        ...(item.replacesContractClauseId
          ? { replaces_contract_clause_id: item.replacesContractClauseId }
          : {}),
        edited_content: mergedText[item.id] ?? item.proposedText ?? '',
      });
    } else {
      // pending or rejected → reject (discard the proposed clause; original kept)
      decisions.push({
        proposed_contract_clause_id: item.proposedContractClauseId,
        action: 'reject',
      });
    }
  }

  // Consume the leftover (unchanged) proposed duplicates.
  for (const pid of allProposedClauseIds) {
    if (!decidedProposed.has(pid)) {
      decisions.push({ proposed_contract_clause_id: pid, action: 'reject' });
    }
  }

  return {
    decisions,
    ...(removals.length ? { removals } : {}),
    ...(changeSummary ? { change_summary: changeSummary } : {}),
  };
}

/** Host-facing decision tallies over the CHANGED set (what the summary shows). */
export function tallyDecisions(
  items: ReviewItem[],
  statuses: Record<string, ReviewStatus>,
): { accepted: number; merged: number; rejected: number; pending: number; applyCount: number } {
  let accepted = 0,
    merged = 0,
    rejected = 0,
    pending = 0;
  for (const item of items) {
    const st = statuses[item.id] ?? 'pending';
    if (st === 'accepted') accepted++;
    else if (st === 'merged') merged++;
    else if (st === 'rejected') rejected++;
    else pending++;
  }
  return { accepted, merged, rejected, pending, applyCount: accepted + merged };
}
