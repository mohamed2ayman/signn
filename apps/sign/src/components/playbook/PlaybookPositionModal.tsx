import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import ModalShell from '@/components/obligations/ModalShell';
import { clauseTypeLabel } from '@/components/review/ClauseReviewCard';
import playbookService, {
  CLAUSE_TYPE_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  VALUE_CONFIG_LIMITS,
  type PlaybookPosition,
  type PlaybookRuleType,
} from '@/services/api/playbookService';
import {
  RULE_TYPES,
  STANDARD_CLAUSE_TYPES,
  buildValueConfig,
  draftFromPosition,
  validateValueDraft,
  EMPTY_VALUE_DRAFT,
  type ValueDraft,
} from './playbookModel';

/** Sentinel for the "Other (custom)…" option — never a real clause_type. */
export const CUSTOM_CLAUSE_TYPE_SENTINEL = '__custom__';

/** RTL-safe content style for org-authored text (house pattern). */
const bidiPlain = { unicodeBidi: 'plaintext' as const };

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none';
const labelClass = 'mb-1 block text-xs font-medium text-gray-700';

interface Props {
  /** Absent = create mode. Present = edit mode. */
  position?: PlaybookPosition | null;
  onClose: () => void;
}

/**
 * 7.22 Slice 3 — add / edit one standard position.
 *
 * SCOPE IS NOT EDITABLE HERE. A position created from the Settings manager is
 * ORG-scoped (the backend's default when `scope` is omitted); narrower
 * PROJECT / CONTRACT overrides are authored from the contract's Compliance tab.
 * On EDIT the scope fields are deliberately NOT sent, so a narrower position
 * keeps its scope — the backend re-validates scope coherence on the MERGED row
 * and would 400 a half-patch such as `{ scope: 'ORG' }` with project_id still set.
 *
 * `rule_type` and `value_config` are ALWAYS sent together, because the service
 * re-validates the merged pair: patching `rule_type` alone against a stored
 * config of another shape is a 400 that writes nothing.
 */
export default function PlaybookPositionModal({ position, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEdit = !!position;

  // A stored clause_type is "standard" when it is one of the 17 AND not flagged
  // custom; anything else preselects the custom option with the name filled in.
  const storedIsStandard =
    !!position &&
    !position.is_custom_clause_type &&
    STANDARD_CLAUSE_TYPES.includes(position.clause_type.trim().toLowerCase());

  const [clauseTypeChoice, setClauseTypeChoice] = useState<string>(() => {
    if (!position) return '';
    return storedIsStandard
      ? position.clause_type.trim().toLowerCase()
      : CUSTOM_CLAUSE_TYPE_SENTINEL;
  });
  const [customName, setCustomName] = useState<string>(() =>
    position && !storedIsStandard ? position.clause_type : '',
  );
  const [ruleType, setRuleType] = useState<PlaybookRuleType>(
    position?.rule_type ?? 'RANGE',
  );
  const [draft, setDraft] = useState<ValueDraft>(() =>
    position ? draftFromPosition(position) : EMPTY_VALUE_DRAFT,
  );
  const [note, setNote] = useState(position?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  // Synchronous double-submit guard: flips BEFORE mutate() so two same-tick
  // clicks (a real double-click, before React commits `disabled`) send exactly
  // one request; released in onSettled so a deliberate retry still works.
  const inFlight = useRef(false);

  const isCustom = clauseTypeChoice === CUSTOM_CLAUSE_TYPE_SENTINEL;
  const set = (patch: Partial<ValueDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const standardOptions = useMemo(
    () =>
      STANDARD_CLAUSE_TYPES.map((key) => ({
        key,
        label: clauseTypeLabel(key, t),
      })),
    [t],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const clauseType = isCustom ? customName.trim() : clauseTypeChoice;
      const valueConfig = buildValueConfig(ruleType, draft);
      const trimmedNote = note.trim();

      if (isEdit && position) {
        // scope / project_id / contract_id are intentionally omitted — see the
        // component doc comment. `note: null` clears a previously-set note.
        return playbookService.update(position.id, {
          clause_type: clauseType,
          is_custom_clause_type: isCustom,
          rule_type: ruleType,
          value_config: valueConfig,
          note: trimmedNote || null,
        });
      }
      return playbookService.create({
        clause_type: clauseType,
        is_custom_clause_type: isCustom,
        rule_type: ruleType,
        value_config: valueConfig,
        note: trimmedNote || undefined,
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? t('playbook.toast.updated') : t('playbook.toast.created'));
      qc.invalidateQueries({ queryKey: ['playbook-positions'] });
      onClose();
    },
    onError: (err: unknown) => {
      // Keep the modal OPEN so the operator can correct and retry.
      setError(apiErrorMessage(err, t));
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const submit = () => {
    if (inFlight.current) return;

    if (!clauseTypeChoice) {
      setError(t('playbook.errors.clauseTypeRequired'));
      return;
    }
    if (isCustom) {
      const name = customName.trim();
      if (!name) {
        setError(t('playbook.errors.customNameRequired'));
        return;
      }
      if (name.length > CLAUSE_TYPE_MAX_LENGTH) {
        setError(t('playbook.errors.customNameTooLong', { max: CLAUSE_TYPE_MAX_LENGTH }));
        return;
      }
    }
    const valueError = validateValueDraft(ruleType, draft);
    if (valueError) {
      setError(t(valueError, { max: valueLimitFor(ruleType) }));
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
      title={isEdit ? t('playbook.modal.editTitle') : t('playbook.modal.addTitle')}
      subtitle={t('playbook.modal.subtitle')}
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
        {/* Clause type */}
        <div>
          <label className={labelClass} htmlFor="pb-clause-type">
            {t('playbook.modal.clauseTypeLabel')}
          </label>
          <select
            id="pb-clause-type"
            value={clauseTypeChoice}
            onChange={(e) => setClauseTypeChoice(e.target.value)}
            className={inputClass}
          >
            <option value="">{t('playbook.modal.clauseTypePlaceholder')}</option>
            {standardOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
            {/* Always LAST — 7.22 requires "any custom clause type the org wants". */}
            <option value={CUSTOM_CLAUSE_TYPE_SENTINEL}>
              {t('playbook.modal.clauseTypeCustom')}
            </option>
          </select>
        </div>

        {isCustom && (
          <div>
            <label className={labelClass} htmlFor="pb-custom-name">
              {t('playbook.modal.customNameLabel')}
            </label>
            <input
              id="pb-custom-name"
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              maxLength={CLAUSE_TYPE_MAX_LENGTH}
              dir="auto"
              style={bidiPlain}
              placeholder={t('playbook.modal.customNamePlaceholder')}
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-gray-400">
              {t('playbook.modal.customNameHint')}
            </p>
          </div>
        )}

        {/* Rule type */}
        <div>
          <label className={labelClass} htmlFor="pb-rule-type">
            {t('playbook.modal.ruleTypeLabel')}
          </label>
          <select
            id="pb-rule-type"
            value={ruleType}
            onChange={(e) => {
              setRuleType(e.target.value as PlaybookRuleType);
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
          <p className="mt-1 text-[11px] text-gray-400">
            {t(`playbook.ruleTypeHint.${ruleType}`)}
          </p>
        </div>

        {/* Value — shape follows rule type */}
        <ValueFields ruleType={ruleType} draft={draft} set={set} />

        {/* Note */}
        <div>
          <label className={labelClass} htmlFor="pb-note">
            {t('playbook.modal.noteLabel')}
          </label>
          <textarea
            id="pb-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={NOTE_MAX_LENGTH}
            dir="auto"
            style={bidiPlain}
            placeholder={t('playbook.modal.notePlaceholder')}
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

// ─── Per-rule-type value inputs ───────────────────────────────────────────────

export function ValueFields({
  ruleType,
  draft,
  set,
}: {
  ruleType: PlaybookRuleType;
  draft: ValueDraft;
  set: (patch: Partial<ValueDraft>) => void;
}) {
  const { t } = useTranslation();

  if (ruleType === 'REQUIRED') {
    return (
      <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5">
        <p className="text-xs text-emerald-800">{t('playbook.value.requiredHint')}</p>
      </div>
    );
  }

  if (ruleType === 'RANGE') {
    return (
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass} htmlFor="pb-min">
            {t('playbook.modal.minLabel')}
          </label>
          <input
            id="pb-min"
            type="number"
            value={draft.min}
            onChange={(e) => set({ min: e.target.value })}
            className={inputClass}
            dir="ltr"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="pb-max">
            {t('playbook.modal.maxLabel')}
          </label>
          <input
            id="pb-max"
            type="number"
            value={draft.max}
            onChange={(e) => set({ max: e.target.value })}
            className={inputClass}
            dir="ltr"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="pb-unit">
            {t('playbook.modal.unitLabel')}
          </label>
          <input
            id="pb-unit"
            type="text"
            value={draft.unit}
            onChange={(e) => set({ unit: e.target.value })}
            maxLength={VALUE_CONFIG_LIMITS.UNIT_MAX_LENGTH}
            placeholder={t('playbook.modal.unitPlaceholderDays')}
            className={inputClass}
            dir="auto"
            style={bidiPlain}
          />
        </div>
      </div>
    );
  }

  if (ruleType === 'THRESHOLD') {
    return (
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass} htmlFor="pb-direction">
            {t('playbook.modal.directionLabel')}
          </label>
          <select
            id="pb-direction"
            value={draft.direction}
            onChange={(e) =>
              set({ direction: e.target.value as ValueDraft['direction'] })
            }
            className={inputClass}
          >
            <option value="AT_MOST">{t('playbook.direction.AT_MOST')}</option>
            <option value="AT_LEAST">{t('playbook.direction.AT_LEAST')}</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="pb-threshold-value">
            {t('playbook.modal.valueLabel')}
          </label>
          <input
            id="pb-threshold-value"
            type="number"
            value={draft.thresholdValue}
            onChange={(e) => set({ thresholdValue: e.target.value })}
            className={inputClass}
            dir="ltr"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="pb-threshold-unit">
            {t('playbook.modal.unitLabel')}
          </label>
          <input
            id="pb-threshold-unit"
            type="text"
            value={draft.unit}
            onChange={(e) => set({ unit: e.target.value })}
            maxLength={VALUE_CONFIG_LIMITS.UNIT_MAX_LENGTH}
            placeholder={t('playbook.modal.unitPlaceholderPercent')}
            className={inputClass}
            dir="auto"
            style={bidiPlain}
          />
        </div>
      </div>
    );
  }

  if (ruleType === 'ENUM') {
    return (
      <div>
        <label className={labelClass} htmlFor="pb-allowed">
          {t('playbook.modal.allowedLabel')}
        </label>
        <textarea
          id="pb-allowed"
          value={draft.allowed}
          onChange={(e) => set({ allowed: e.target.value })}
          rows={4}
          dir="auto"
          style={bidiPlain}
          placeholder={t('playbook.modal.allowedPlaceholder')}
          className={inputClass}
        />
        <p className="mt-1 text-[11px] text-gray-400">
          {t('playbook.modal.allowedHint', {
            max: VALUE_CONFIG_LIMITS.ENUM_MAX_ENTRIES,
          })}
        </p>
      </div>
    );
  }

  // TEXT
  return (
    <div>
      <label className={labelClass} htmlFor="pb-text">
        {t('playbook.modal.textLabel')}
      </label>
      <textarea
        id="pb-text"
        value={draft.text}
        onChange={(e) => set({ text: e.target.value })}
        rows={4}
        maxLength={VALUE_CONFIG_LIMITS.TEXT_MAX_LENGTH}
        dir="auto"
        style={bidiPlain}
        placeholder={t('playbook.modal.textPlaceholder')}
        className={inputClass}
      />
    </div>
  );
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** The per-rule-type limit used in the "too long / too many" messages. */
function valueLimitFor(ruleType: PlaybookRuleType): number {
  if (ruleType === 'TEXT') return VALUE_CONFIG_LIMITS.TEXT_MAX_LENGTH;
  if (ruleType === 'ENUM') return VALUE_CONFIG_LIMITS.ENUM_MAX_ENTRIES;
  return VALUE_CONFIG_LIMITS.UNIT_MAX_LENGTH;
}

/**
 * Map an API failure to copy. Keys on the STATUS, never on the backend's
 * message text. The 400 body's `message` is a string[] from the ValidationPipe
 * or a single string from the service — surfaced only as a detail line, since
 * it is developer-facing English and untranslated.
 */
export function apiErrorMessage(err: unknown, t: (k: string) => string): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } } };
  const status = e?.response?.status;
  if (status === 403) return t('playbook.errors.forbidden');
  if (status === 404) return t('playbook.errors.notFound');
  if (status === 400) {
    const raw = e?.response?.data?.message;
    const detail = Array.isArray(raw) ? raw.join('; ') : typeof raw === 'string' ? raw : '';
    return detail ? `${t('playbook.errors.invalid')} ${detail}` : t('playbook.errors.invalid');
  }
  return t('playbook.errors.generic');
}
