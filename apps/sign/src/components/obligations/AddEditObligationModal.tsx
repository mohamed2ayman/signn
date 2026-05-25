import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { obligationService } from '@/services/api/obligationService';
import complianceService from '@/services/api/complianceService';
import type {
  ContractObligation,
  ObligationType,
} from '@/services/api/complianceService';
import ModalShell from './ModalShell';
import { OBLIGATION_TYPES } from './statusUtils';

interface AddEditObligationModalProps {
  isOpen: boolean;
  onClose: () => void;
  contractId: string;
  /** If provided, modal opens in EDIT mode. Otherwise CREATE mode. */
  obligation?: ContractObligation | null;
  onSuccess?: () => void;
}

const FREQUENCY_VALUES = [
  { v: 'one-time', k: 'oneTime' },
  { v: 'monthly', k: 'monthly' },
  { v: 'quarterly', k: 'quarterly' },
  { v: 'annually', k: 'annually' },
] as const;

const AMOUNT_TYPES: ObligationType[] = ['PAYMENT', 'PERFORMANCE_BOND', 'INSURANCE'];
const ALL_TIERS = [30, 14, 7, 1] as const;

interface FormState {
  description: string;
  type: ObligationType;
  clause_ref: string;
  due_date: string;
  frequency: string;
  responsible_party: string;
  amount: string;
  currency: string;
  reminder_schedule: number[];
  is_critical: boolean;
}

const EMPTY: FormState = {
  description: '',
  type: 'OTHER',
  clause_ref: '',
  due_date: '',
  frequency: '',
  responsible_party: '',
  amount: '',
  currency: '',
  reminder_schedule: [30, 14, 7, 1],
  is_critical: false,
};

/**
 * Add or Edit a single obligation.
 *
 * - Conditional fields: Amount + Currency only render when type is one
 *   of PAYMENT / PERFORMANCE_BOND / INSURANCE.
 * - Reminder schedule defaults to [30, 14, 7, 1] — same as the backend
 *   default per the Step 1 migration (column default).
 * - Critical toggle: documented in tooltip — critical obligations
 *   always send reminders even when the recipient has opted out of
 *   email digests.
 * - Create mode posts to the LEGACY `/obligations` endpoint
 *   (`obligationService.create`) which carries Phase-3.4-compatible
 *   semantics. Edit mode uses the canonical PATCH
 *   `/contracts/:id/obligations/:oblId` via
 *   `complianceService.updateObligation`.
 */
export default function AddEditObligationModal({
  isOpen,
  onClose,
  contractId,
  obligation,
  onSuccess,
}: AddEditObligationModalProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEdit = !!obligation;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sync form when the modal opens or switches between create/edit modes.
  useEffect(() => {
    if (!isOpen) return;
    if (obligation) {
      setForm({
        description: obligation.description ?? '',
        type: obligation.obligation_type ?? 'OTHER',
        clause_ref: obligation.clause_ref ?? '',
        due_date: obligation.due_date ? obligation.due_date.slice(0, 10) : '',
        frequency: '',
        responsible_party: obligation.responsible_party ?? '',
        amount: obligation.amount ?? '',
        currency: obligation.currency ?? '',
        reminder_schedule: [30, 14, 7, 1],
        is_critical: obligation.is_critical ?? false,
      });
    } else {
      setForm(EMPTY);
    }
    setErrors({});
  }, [isOpen, obligation]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.description.trim()) {
      e.description = t('obligation.form.errors.descriptionRequired');
    } else if (form.description.length > 20_000) {
      e.description = t('obligation.form.errors.descriptionTooLong');
    }
    if (!form.due_date) {
      e.due_date = t('obligation.form.errors.dueDateRequired');
    } else if (!isEdit) {
      // For new obligations, due date must be in the future (or today).
      const due = new Date(form.due_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (due < today) e.due_date = t('obligation.form.errors.dueDateInPast');
    }
    if (form.amount && !form.currency) {
      e.currency = t('obligation.form.errors.currencyRequired');
    }
    if (form.currency && !form.amount) {
      e.amount = t('obligation.form.errors.amountRequired');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const createMut = useMutation({
    mutationFn: () =>
      obligationService.create({
        contract_id: contractId,
        description: form.description.trim(),
        responsible_party: form.responsible_party.trim() || undefined,
        due_date: form.due_date,
        frequency: form.frequency || undefined,
      }),
    onSuccess: () => {
      toast.success(t('obligation.toast.obligationCreated'));
      qc.invalidateQueries({ queryKey: ['contract-obligations', contractId] });
      qc.invalidateQueries({ queryKey: ['portfolio-obligations'] });
      onSuccess?.();
      onClose();
    },
    onError: () => toast.error(t('obligation.toast.error')),
  });

  const editMut = useMutation({
    mutationFn: () => {
      if (!obligation) throw new Error('no obligation');
      return complianceService.updateObligation(contractId, obligation.id, {
        description: form.description.trim(),
        obligation_type: form.type,
        clause_ref: form.clause_ref.trim() || null,
        due_date: form.due_date,
        responsible_party: form.responsible_party.trim() || null,
        amount: form.amount || null,
        currency: form.currency.trim() || null,
        is_critical: form.is_critical,
      });
    },
    onSuccess: () => {
      toast.success(t('obligation.toast.obligationUpdated'));
      qc.invalidateQueries({ queryKey: ['contract-obligations', contractId] });
      qc.invalidateQueries({ queryKey: ['portfolio-obligations'] });
      qc.invalidateQueries({ queryKey: ['obligation-detail', obligation?.id] });
      onSuccess?.();
      onClose();
    },
    onError: () => toast.error(t('obligation.toast.error')),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (isEdit) editMut.mutate();
    else createMut.mutate();
  };

  const pending = createMut.isPending || editMut.isPending;
  const showAmount = AMOUNT_TYPES.includes(form.type);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={
        isEdit
          ? t('obligation.modal.edit.title')
          : t('obligation.modal.add.title')
      }
      subtitle={
        isEdit
          ? t('obligation.modal.edit.subtitle')
          : t('obligation.modal.add.subtitle')
      }
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="add-edit-obligation-form"
            disabled={pending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending
              ? t('common.loading')
              : isEdit
              ? t('common.save')
              : t('obligation.actions.add')}
          </button>
        </>
      }
    >
      <form id="add-edit-obligation-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Description — Arabic-safe via dir="auto" */}
        <Field label={t('obligation.form.description')} required error={errors.description}>
          <textarea
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            rows={3}
            dir="auto"
            style={{ unicodeBidi: 'plaintext' }}
            maxLength={20_000}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
            placeholder={t('obligation.form.descriptionPlaceholder')}
          />
        </Field>

        {/* Type + Clause Reference */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('obligation.form.type')}>
            <select
              value={form.type}
              onChange={(e) => setField('type', e.target.value as ObligationType)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
            >
              {OBLIGATION_TYPES.map((tp) => (
                <option key={tp} value={tp}>
                  {t(`obligation.type.${tp}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('obligation.form.clauseRef')}>
            <input
              type="text"
              value={form.clause_ref}
              onChange={(e) => setField('clause_ref', e.target.value)}
              maxLength={100}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
              placeholder={t('obligation.form.clauseRefPlaceholder')}
            />
          </Field>
        </div>

        {/* Due Date + Frequency */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('obligation.form.dueDate')} required error={errors.due_date}>
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setField('due_date', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </Field>
          <Field label={t('obligation.form.frequency')}>
            <select
              value={form.frequency}
              onChange={(e) => setField('frequency', e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
            >
              <option value="">—</option>
              {FREQUENCY_VALUES.map(({ v, k }) => (
                <option key={v} value={v}>
                  {t(`obligation.frequency.${k}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Responsible Party (text) */}
        <Field label={t('obligation.form.responsibleParty')}>
          <input
            type="text"
            value={form.responsible_party}
            onChange={(e) => setField('responsible_party', e.target.value)}
            maxLength={100}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
            placeholder={t('obligation.form.responsiblePartyPlaceholder')}
          />
        </Field>

        {/* Amount + Currency — only for payment/insurance/bond types */}
        {showAmount && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('obligation.form.amount')} error={errors.amount}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setField('amount', e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                placeholder="0.00"
              />
            </Field>
            <Field label={t('obligation.form.currency')} error={errors.currency}>
              <input
                type="text"
                value={form.currency}
                onChange={(e) => setField('currency', e.target.value.toUpperCase())}
                maxLength={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                placeholder="USD"
              />
            </Field>
          </div>
        )}

        {/* Reminder schedule — checkboxes */}
        <Field label={t('obligation.form.reminderSchedule')}>
          <div className="flex flex-wrap gap-3">
            {ALL_TIERS.map((days) => (
              <label key={days} className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.reminder_schedule.includes(days)}
                  onChange={(e) =>
                    setField(
                      'reminder_schedule',
                      e.target.checked
                        ? [...form.reminder_schedule, days].sort((a, b) => b - a)
                        : form.reminder_schedule.filter((d) => d !== days),
                    )
                  }
                  className="rounded border-gray-300 text-primary focus:ring-primary/20"
                />
                {t('obligation.form.daysBeforeReminder', { days })}
              </label>
            ))}
          </div>
        </Field>

        {/* Is Critical toggle */}
        <Field label={t('obligation.form.isCritical')}>
          <label className="inline-flex items-start gap-2">
            <input
              type="checkbox"
              checked={form.is_critical}
              onChange={(e) => setField('is_critical', e.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-primary focus:ring-primary/20"
            />
            <span className="text-xs text-gray-600">
              {t('obligation.form.isCriticalHint')}
            </span>
          </label>
        </Field>
      </form>
    </ModalShell>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
