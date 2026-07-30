import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { UserRole } from '@/types';
import ModalShell from '@/components/obligations/ModalShell';
import { clauseTypeLabel } from '@/components/review/ClauseReviewCard';
import playbookService, {
  NOTE_MAX_LENGTH,
  type PlaybookPosition,
  type PlaybookRuleType,
  type PlaybookScope,
} from '@/services/api/playbookService';
import { ValueFields, apiErrorMessage } from './PlaybookPositionModal';
import {
  EMPTY_VALUE_DRAFT,
  RULE_TYPES,
  RULE_TYPE_BADGE,
  STANDARD_CLAUSE_TYPES,
  buildValueConfig,
  draftFromPosition,
  normalizeClauseTypeKey,
  positionClauseTypeLabel,
  renderPositionValue,
  validateValueDraft,
  type ValueDraft,
} from './playbookModel';

const bidiPlain = { unicodeBidi: 'plaintext' as const };
const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none';
const labelClass = 'mb-1 block text-xs font-medium text-gray-700';

/** Shared query key with the manager page, so an override refreshes both. */
export const PLAYBOOK_QUERY_KEY = ['playbook-positions'] as const;

/**
 * Positions this contract narrows to — a CONTRACT-scoped row bound to this
 * contract, or a PROJECT-scoped row bound to its project.
 */
export function overridesForContract(
  positions: readonly PlaybookPosition[],
  contractId: string,
  projectId: string | null,
): PlaybookPosition[] {
  return positions.filter(
    (p) =>
      (p.scope === 'CONTRACT' && p.contract_id === contractId) ||
      (p.scope === 'PROJECT' && !!projectId && p.project_id === projectId),
  );
}

/**
 * The position that currently governs a clause type for this contract, folded
 * by the SAME precedence the backend resolver uses (CONTRACT > PROJECT > ORG,
 * keyed on the normalized clause type, inactive rows excluded).
 *
 * This is a client-side MIRROR for display only — the backend resolver remains
 * the authority over what the AI is actually told.
 */
export function effectivePositionFor(
  positions: readonly PlaybookPosition[],
  clauseTypeKey: string,
  contractId: string,
  projectId: string | null,
): PlaybookPosition | null {
  const rank = (s: PlaybookScope) =>
    s === 'CONTRACT' ? 3 : s === 'PROJECT' ? 2 : 1;

  const candidates = positions.filter((p) => {
    if (!p.is_active) return false;
    if (normalizeClauseTypeKey(p.clause_type) !== clauseTypeKey) return false;
    if (p.scope === 'ORG') return true;
    if (p.scope === 'PROJECT') return !!projectId && p.project_id === projectId;
    return p.contract_id === contractId;
  });

  if (candidates.length === 0) return null;
  return candidates.reduce((best, row) =>
    rank(row.scope) > rank(best.scope) ? row : best,
  );
}

// ═══ Banner ═══════════════════════════════════════════════════════════════════

/**
 * 7.22 Slice 3 — "Using: Org playbook · Overrides for this contract (N)".
 *
 * Rendered above the PLAYBOOK findings so the reviewer knows WHICH playbook
 * produced them before reading a single deviation.
 */
export function PlaybookOverrideBanner({
  contractId,
  projectId,
}: {
  contractId: string;
  projectId: string | null;
}) {
  const { t } = useTranslation();
  const user = useSelector((state: RootState) => state.auth.user);
  const isOwnerAdmin = user?.role === UserRole.OWNER_ADMIN;

  const query = useQuery({
    queryKey: PLAYBOOK_QUERY_KEY,
    queryFn: () => playbookService.list(),
    enabled: isOwnerAdmin,
  });

  const overrides = overridesForContract(query.data ?? [], contractId, projectId);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-100 bg-gray-50/70 px-4 py-2.5 text-xs">
      <span className="font-semibold text-gray-700">
        {t('playbook.override.banner.using')}
      </span>
      <span className="text-gray-500">·</span>
      {isOwnerAdmin ? (
        <span className="text-gray-600">
          {t('playbook.override.banner.overrides', { count: overrides.length })}
        </span>
      ) : (
        // Non-OWNER_ADMIN cannot read /playbook/positions (403), so no count is
        // claimed rather than a misleading zero.
        <span className="text-gray-400">
          {t('playbook.override.banner.noPermission')}
        </span>
      )}
    </div>
  );
}

// ═══ "Adjust standard" trigger ════════════════════════════════════════════════

export function AdjustStandardButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  const user = useSelector((state: RootState) => state.auth.user);
  const isOwnerAdmin = user?.role === UserRole.OWNER_ADMIN;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isOwnerAdmin}
      // Mirrors the API's @Roles(OWNER_ADMIN) exact-match guard — disabled with
      // a reason rather than a button that can only ever 403.
      title={
        isOwnerAdmin
          ? undefined
          : t('playbook.override.noPermissionTitle')
      }
      className="whitespace-nowrap rounded-md border border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {t('playbook.override.adjust')}
    </button>
  );
}

// ═══ Override modal ═══════════════════════════════════════════════════════════

/**
 * 7.22 Slice 3 — author a narrower playbook position from a compliance finding.
 *
 * WHY THE OPERATOR PICKS THE CLAUSE TYPE: a compliance finding carries NO link
 * back to the playbook row that provoked it. `compliance_findings` has no
 * metadata column, and Slice 2 feeds the playbook to the AI as PROMPT TEXT
 * only — no ids round-trip. Guessing the subject from `clause_ref` /
 * `requirement` text would be a fragile invented link, so the subject is
 * chosen explicitly and the org standard for it is then shown read-only.
 *
 * SCOPE, exactly as the backend's coherence rule requires:
 *   CONTRACT → contract_id required (project_id may be denormalized in)
 *   PROJECT  → project_id required, contract_id MUST be absent
 */
export function PlaybookOverrideModal({
  contractId,
  projectId,
  finding,
  onClose,
}: {
  contractId: string;
  projectId: string | null;
  /** The deviation that prompted this, shown for context only. */
  finding: { requirement: string; clause_ref: string | null } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const positionsQuery = useQuery({
    queryKey: PLAYBOOK_QUERY_KEY,
    queryFn: () => playbookService.list(),
  });
  const positions = positionsQuery.data ?? [];

  const [clauseTypeKey, setClauseTypeKey] = useState('');
  const [scope, setScope] = useState<'CONTRACT' | 'PROJECT'>('CONTRACT');
  const [ruleType, setRuleType] = useState<PlaybookRuleType>('RANGE');
  const [draft, setDraft] = useState<ValueDraft>(EMPTY_VALUE_DRAFT);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touchedShape, setTouchedShape] = useState(false);

  const inFlight = useRef(false);

  // Every clause type the operator may target: the 17 standard keys plus any
  // custom subject the org already tracks.
  const options = useMemo(() => {
    const custom = positions
      .filter((p) => !STANDARD_CLAUSE_TYPES.includes(normalizeClauseTypeKey(p.clause_type)))
      .map((p) => ({
        key: normalizeClauseTypeKey(p.clause_type),
        label: p.clause_type.trim(),
        custom: true,
      }));
    const seen = new Set<string>();
    const dedupedCustom = custom.filter((o) =>
      seen.has(o.key) ? false : (seen.add(o.key), true),
    );
    return [
      ...STANDARD_CLAUSE_TYPES.map((key) => ({
        key,
        label: clauseTypeLabel(key, t),
        custom: false,
      })),
      ...dedupedCustom,
    ];
  }, [positions, t]);

  const effective = clauseTypeKey
    ? effectivePositionFor(positions, clauseTypeKey, contractId, projectId)
    : null;

  /** Adopt the org standard's shape as the starting point for the override. */
  const pickClauseType = (key: string) => {
    setClauseTypeKey(key);
    setError(null);
    if (touchedShape) return;
    const current = key
      ? effectivePositionFor(positions, key, contractId, projectId)
      : null;
    if (current) {
      setRuleType(current.rule_type);
      setDraft(draftFromPosition(current));
    }
  };

  const selectedOption = options.find((o) => o.key === clauseTypeKey);

  const mutation = useMutation({
    mutationFn: async () => {
      const isContract = scope === 'CONTRACT';
      return playbookService.create({
        scope: scope as PlaybookScope,
        // CONTRACT: contract_id required, project_id optional (denormalized).
        // PROJECT:  project_id required, contract_id MUST NOT be sent.
        ...(isContract
          ? { contract_id: contractId, ...(projectId ? { project_id: projectId } : {}) }
          : { project_id: projectId as string }),
        clause_type: selectedOption?.custom ? selectedOption.label : clauseTypeKey,
        is_custom_clause_type: !!selectedOption?.custom,
        rule_type: ruleType,
        value_config: buildValueConfig(ruleType, draft),
        note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success(t('playbook.override.toast.saved'));
      qc.invalidateQueries({ queryKey: PLAYBOOK_QUERY_KEY });
      onClose();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err, t)),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const submit = () => {
    if (inFlight.current) return;
    if (!clauseTypeKey) {
      setError(t('playbook.errors.clauseTypeRequired'));
      return;
    }
    if (scope === 'PROJECT' && !projectId) {
      setError(t('playbook.override.errors.noProject'));
      return;
    }
    const valueError = validateValueDraft(ruleType, draft);
    if (valueError) {
      setError(t(valueError));
      return;
    }
    if (note.length > NOTE_MAX_LENGTH) {
      setError(t('playbook.errors.noteTooLong', { max: NOTE_MAX_LENGTH }));
      return;
    }
    setError(null);
    inFlight.current = true;
    mutation.mutate();
  };

  return (
    <ModalShell
      isOpen
      onClose={mutation.isPending ? () => {} : onClose}
      title={t('playbook.override.title')}
      subtitle={t('playbook.override.subtitle')}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('playbook.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={mutation.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {mutation.isPending ? t('playbook.saving') : t('playbook.save')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* The deviation that prompted this — context only */}
        {finding && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              {t('playbook.override.deviation')}
              {finding.clause_ref ? ` · ${finding.clause_ref}` : ''}
            </p>
            <p
              className="mt-1 text-xs text-gray-700"
              dir="auto"
              style={bidiPlain}
            >
              {finding.requirement}
            </p>
          </div>
        )}

        {/* Subject */}
        <div>
          <label className={labelClass} htmlFor="pb-ov-clause-type">
            {t('playbook.override.subjectLabel')}
          </label>
          <select
            id="pb-ov-clause-type"
            value={clauseTypeKey}
            onChange={(e) => pickClauseType(e.target.value)}
            className={inputClass}
          >
            <option value="">{t('playbook.override.subjectPlaceholder')}</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* The org standard, read-only */}
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            {t('playbook.override.orgStandard')}
          </p>
          {!clauseTypeKey ? (
            <p className="mt-1 text-xs text-gray-400">
              {t('playbook.override.chooseSubjectFirst')}
            </p>
          ) : effective ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-900" dir="auto" style={bidiPlain}>
                {positionClauseTypeLabel(effective, t)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RULE_TYPE_BADGE[effective.rule_type] ?? 'bg-gray-100 text-gray-600'}`}
              >
                {t(`playbook.ruleType.${effective.rule_type}`)}
              </span>
              <span className="text-xs text-gray-700" dir="auto" style={bidiPlain}>
                {renderPositionValue(effective, t)}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                {t(`playbook.scope.${effective.scope}`)}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              {t('playbook.override.noOrgStandard')}
            </p>
          )}
        </div>

        {/* The override */}
        <div className="rounded-lg border border-primary/20 bg-primary/[0.03] px-3 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
            {t('playbook.override.overrideValue')}
          </p>

          <div className="mb-3">
            <label className={labelClass} htmlFor="pb-ov-rule-type">
              {t('playbook.modal.ruleTypeLabel')}
            </label>
            <select
              id="pb-ov-rule-type"
              value={ruleType}
              onChange={(e) => {
                setRuleType(e.target.value as PlaybookRuleType);
                setTouchedShape(true);
                setError(null);
              }}
              className={inputClass}
            >
              {RULE_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {t(`playbook.ruleType.${rt}`)}
                </option>
              ))}
            </select>
          </div>

          <ValueFields
            ruleType={ruleType}
            draft={draft}
            set={(patch) => {
              setTouchedShape(true);
              setDraft((d) => ({ ...d, ...patch }));
            }}
          />
        </div>

        {/* Scope */}
        <fieldset>
          <legend className={labelClass}>{t('playbook.override.scopeLabel')}</legend>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs hover:bg-gray-50">
              <input
                type="radio"
                name="pb-override-scope"
                value="CONTRACT"
                checked={scope === 'CONTRACT'}
                onChange={() => setScope('CONTRACT')}
                className="mt-0.5"
              />
              <span>
                <span className="block font-semibold text-gray-900">
                  {t('playbook.override.scopeContract')}
                </span>
                <span className="block text-gray-500">
                  {t('playbook.override.scopeContractHint')}
                </span>
              </span>
            </label>
            <label
              className={`flex flex-1 items-start gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs ${
                projectId ? 'cursor-pointer hover:bg-gray-50' : 'cursor-not-allowed opacity-50'
              }`}
            >
              <input
                type="radio"
                name="pb-override-scope"
                value="PROJECT"
                checked={scope === 'PROJECT'}
                disabled={!projectId}
                onChange={() => setScope('PROJECT')}
                className="mt-0.5"
              />
              <span>
                <span className="block font-semibold text-gray-900">
                  {t('playbook.override.scopeProject')}
                </span>
                <span className="block text-gray-500">
                  {t('playbook.override.scopeProjectHint')}
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {/* Note */}
        <div>
          <label className={labelClass} htmlFor="pb-ov-note">
            {t('playbook.modal.noteLabel')}
          </label>
          <textarea
            id="pb-ov-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={NOTE_MAX_LENGTH}
            dir="auto"
            style={bidiPlain}
            placeholder={t('playbook.override.notePlaceholder')}
            className={inputClass}
          />
        </div>

        {error && (
          <p role="alert" className="text-xs font-medium text-red-600">
            {error}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
