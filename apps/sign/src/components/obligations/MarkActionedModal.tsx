import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import complianceService from '@/services/api/complianceService';
import type {
  ContractObligation,
  ObligationStatus,
} from '@/services/api/complianceService';
import ModalShell from './ModalShell';

interface MarkActionedModalProps {
  isOpen: boolean;
  onClose: () => void;
  obligation: ContractObligation | null;
  contractId: string;
  onSuccess?: () => void;
}

type ResolvedStatus = Extract<ObligationStatus, 'MET' | 'COMPLETED' | 'WAIVED'>;

/**
 * Mark an obligation as Actioned (Met / Completed / Waived).
 *
 * EVIDENCE — Phase 7.1 Step 3 scope decision:
 *   The backend's PUT /contracts/:id/obligations/:oblId/evidence endpoint
 *   accepts an already-hosted URL string. There is NO generic file-upload
 *   endpoint on the backend — every existing multer surface is
 *   entity-scoped (knowledge assets, org policies, etc.). Until a
 *   future step adds the missing upload endpoint, this modal accepts a
 *   URL the user has already hosted somewhere. The protective message
 *   (the most important part of this UX) is shown verbatim either way.
 *   See lessons.md #101 for the full rationale.
 *
 * FLOW:
 *   1. status update goes via complianceService.updateObligation
 *      (PATCH /contracts/:id/obligations/:oblId).
 *   2. evidence URL (if provided) goes via complianceService.updateEvidence
 *      (PUT /contracts/:id/obligations/:oblId/evidence). Called BEFORE
 *      the status update so an evidence-validation failure (e.g. malformed
 *      URL → 400) doesn't leave the obligation in a "MET but no evidence"
 *      state.
 */
export default function MarkActionedModal({
  isOpen,
  onClose,
  obligation,
  contractId,
  onSuccess,
}: MarkActionedModalProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [actionedDate, setActionedDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [status, setStatus] = useState<ResolvedStatus>('MET');
  const [waivedReason, setWaivedReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setActionedDate(today);
    setNotes('');
    setEvidenceUrl('');
    setStatus('MET');
    setWaivedReason('');
    setErrors({});
  }, [isOpen, today]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!actionedDate) e.actionedDate = t('obligation.form.errors.dueDateRequired');
    if (status === 'WAIVED' && !waivedReason.trim()) {
      e.waivedReason = t('obligation.modal.markActioned.waivedReasonRequired');
    }
    if (evidenceUrl.trim()) {
      try {
        new URL(evidenceUrl.trim());
      } catch {
        e.evidenceUrl = t('obligation.modal.markActioned.invalidUrl');
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!obligation) throw new Error('no obligation');
      // 1) Attach evidence URL first so a failure here doesn't leave the
      // obligation in MET-without-evidence state.
      if (evidenceUrl.trim()) {
        await complianceService.updateEvidence(
          contractId,
          obligation.id,
          evidenceUrl.trim(),
        );
      }
      // 2) Update status. Notes are appended to description for now —
      // the backend has no dedicated notes column on obligations and
      // adding one would require a Step-1-style migration, out of scope.
      const patch: Record<string, unknown> = {
        status,
        completed_at: new Date(actionedDate).toISOString(),
      };
      if (status === 'WAIVED' && waivedReason.trim()) {
        patch.description =
          `${obligation.description}\n\n— Waived: ${waivedReason.trim()}`;
      }
      if (notes.trim() && status !== 'WAIVED') {
        patch.description = `${obligation.description}\n\n— Notes: ${notes.trim()}`;
      }
      return complianceService.updateObligation(contractId, obligation.id, patch);
    },
    onSuccess: () => {
      toast.success(t('obligation.toast.obligationActioned'));
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
    mutation.mutate();
  };

  if (!obligation) return null;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={t('obligation.modal.markActioned.title')}
      subtitle={obligation.description}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="mark-actioned-form"
            disabled={mutation.isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending
              ? t('common.loading')
              : t('obligation.modal.markActioned.submitButton')}
          </button>
        </>
      }
    >
      <form id="mark-actioned-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Status select */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            {t('common.status')}
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ResolvedStatus)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          >
            <option value="MET">{t('obligation.status.MET')}</option>
            <option value="COMPLETED">{t('obligation.status.COMPLETED')}</option>
            <option value="WAIVED">{t('obligation.status.WAIVED')}</option>
          </select>
        </div>

        {/* Waived reason — only when status is WAIVED */}
        {status === 'WAIVED' && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('obligation.modal.markActioned.waivedReason')}
              <span className="text-red-500"> *</span>
            </label>
            <textarea
              value={waivedReason}
              onChange={(e) => setWaivedReason(e.target.value)}
              rows={2}
              dir="auto"
              style={{ unicodeBidi: 'plaintext' }}
              maxLength={2_000}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
            {errors.waivedReason && (
              <p className="mt-1 text-xs text-red-600">{errors.waivedReason}</p>
            )}
          </div>
        )}

        {/* Actioned date */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            {t('obligation.modal.markActioned.actionedDate')}
            <span className="text-red-500"> *</span>
          </label>
          <input
            type="date"
            value={actionedDate}
            onChange={(e) => setActionedDate(e.target.value)}
            max={today}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
          {errors.actionedDate && (
            <p className="mt-1 text-xs text-red-600">{errors.actionedDate}</p>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            {t('obligation.modal.markActioned.notes')}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            dir="auto"
            style={{ unicodeBidi: 'plaintext' }}
            maxLength={2_000}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
        </div>

        {/* ── Evidence section — protective message + URL input ──── */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-900">
            {t('obligation.modal.markActioned.evidenceHeading')}
          </h3>
          <p className="mb-3 text-xs leading-relaxed text-amber-900">
            {t('obligation.modal.markActioned.evidenceMessage')}
          </p>
          <label className="mb-1 block text-xs font-medium text-amber-900">
            {t('obligation.modal.markActioned.evidenceUrlLabel')}
          </label>
          <input
            type="url"
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-200"
          />
          {errors.evidenceUrl && (
            <p className="mt-1 text-xs text-red-600">{errors.evidenceUrl}</p>
          )}
          <p className="mt-2 text-[11px] italic text-amber-800">
            {t('obligation.modal.markActioned.fileUploadDeferred')}
          </p>
        </div>
      </form>
    </ModalShell>
  );
}
