import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ModalShell from '@/components/obligations/ModalShell';

export type ErpAdminAction = 'suspend' | 'unsuspend' | 'force-check' | 'delete';

const ACTION_KEY: Record<ErpAdminAction, string> = {
  suspend: 'suspend',
  unsuspend: 'unsuspend',
  'force-check': 'forceCheck',
  delete: 'delete',
};

/**
 * Phase 7.28 v1.1 Part B — confirm + required-reason modal for every operator
 * action on the ERP Health dashboard. Reuses the Part 2a ModalShell.
 *
 * The backend rejects an empty reason, so the primary button is disabled until a
 * reason is entered. DELETE is destructive: it additionally requires an explicit
 * confirmation checkbox (the "second confirm") — never one-click.
 */
export default function ErpAdminActionModal({
  isOpen,
  onClose,
  action,
  connectionName,
  isPending,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  action: ErpAdminAction;
  connectionName: string;
  isPending: boolean;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);

  const key = ACTION_KEY[action];
  const isDelete = action === 'delete';
  const canSubmit =
    reason.trim().length > 0 && !isPending && (!isDelete || confirmChecked);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={t(`erp.admin.action.${key}.title`)}
      subtitle={connectionName}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canSubmit}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed ${
              isDelete ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-600'
            }`}
          >
            {isPending ? t('erp.saving') : t(`erp.admin.action.${key}.confirm`)}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {isDelete && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {t('erp.admin.modal.deleteWarning')}
          </div>
        )}

        <label className="block text-sm font-medium text-gray-700">
          {t('erp.admin.modal.reasonLabel')}
          <span className="text-danger ltr:ml-1 rtl:mr-1">*</span>
        </label>
        <textarea
          aria-label={t('erp.admin.modal.reasonLabel')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          dir="auto"
          placeholder={t('erp.admin.modal.reasonPlaceholder')}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />

        {isDelete && (
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500/30"
            />
            {t('erp.admin.modal.deleteConfirmCheckbox')}
          </label>
        )}
      </div>
    </ModalShell>
  );
}
