import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import ModalShell from '@/components/obligations/ModalShell';
import FormInput from '@/components/common/FormInput';
import {
  erpService,
  type ErpConnection,
  type CreateConnectionInput,
  type UpdateConnectionInput,
} from '@/services/api/erpService';
import { ERP_VENDOR_OPTIONS } from './erpConstants';

interface CredRow {
  key: string;
  value: string;
}

/**
 * Phase 7.28 Part 2a — create / edit an ERP connection.
 *
 * CREDENTIALS ARE WRITE-ONLY. The API never returns stored credentials, only
 * `has_credentials`. On edit we show "configured / not configured" and a
 * "Replace credentials" toggle; we NEVER prefill or display a value (not even a
 * masked stand-in). Omitting `credentials` from the PATCH leaves them untouched.
 */
export default function ErpConnectionFormModal({
  isOpen,
  onClose,
  connection,
}: {
  isOpen: boolean;
  onClose: () => void;
  connection?: ErpConnection | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isEdit = !!connection;

  const [name, setName] = useState(connection?.name ?? '');
  const [vendor, setVendor] = useState(connection?.vendor ?? ERP_VENDOR_OPTIONS[0].value);
  const [baseUrl, setBaseUrl] = useState(connection?.base_url ?? '');
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  // On edit, credentials start hidden (write-only) — only revealed on replace.
  const [replaceCreds, setReplaceCreds] = useState(!isEdit);
  const [creds, setCreds] = useState<CredRow[]>([{ key: '', value: '' }]);
  const [error, setError] = useState<string | null>(null);

  const selectedVendor = useMemo(
    () => ERP_VENDOR_OPTIONS.find((v) => v.value === vendor),
    [vendor],
  );

  const buildCredentials = (): Record<string, string> | undefined => {
    const obj: Record<string, string> = {};
    for (const row of creds) {
      const k = row.key.trim();
      if (k && row.value !== '') obj[k] = row.value;
    }
    return Object.keys(obj).length > 0 ? obj : undefined;
  };

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit && connection) {
        const payload: UpdateConnectionInput = {
          name: name.trim(),
          base_url: baseUrl.trim() ? baseUrl.trim() : null,
          enabled,
        };
        // Only send credentials when the user explicitly chose to replace them.
        if (replaceCreds) {
          const built = buildCredentials();
          if (built) payload.credentials = built;
        }
        return erpService.updateConnection(connection.id, payload);
      }
      const payload: CreateConnectionInput = {
        vendor,
        name: name.trim(),
        ...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
        ...(buildCredentials() ? { credentials: buildCredentials() } : {}),
        enabled,
      };
      return erpService.createConnection(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erp-connections'] });
      toast.success(isEdit ? t('erp.toast.updated') : t('erp.toast.created'));
      onClose();
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? t('erp.toast.saveError');
      setError(typeof msg === 'string' ? msg : t('erp.toast.saveError'));
    },
  });

  const handleSubmit = () => {
    setError(null);
    if (!name.trim()) {
      setError(t('erp.form.nameRequired'));
      return;
    }
    mutation.mutate();
  };

  const updateCred = (i: number, patch: Partial<CredRow>) =>
    setCreds((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const selectClass =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-text transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? t('erp.form.editTitle') : t('erp.form.createTitle')}
      subtitle={isEdit ? connection?.name : undefined}
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
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {mutation.isPending ? t('erp.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <div className="space-y-1">
        <FormInput
          label="erp.form.name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        {/* Vendor — fixed once created (backend rejects vendor change). */}
        <div className="mb-4">
          <label htmlFor="erp-vendor" className="mb-1.5 block text-sm font-medium text-text">
            {t('erp.form.vendor')}
            <span className="text-danger ltr:ml-1 rtl:mr-1">*</span>
          </label>
          <select
            id="erp-vendor"
            value={vendor}
            disabled={isEdit}
            onChange={(e) => setVendor(e.target.value)}
            className={selectClass}
          >
            {ERP_VENDOR_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>
                {t(v.labelKey)}
              </option>
            ))}
          </select>
          {selectedVendor?.skeleton && (
            <p className="mt-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t('erp.form.skeletonWarning')}
            </p>
          )}
        </div>

        <FormInput
          label="erp.form.baseUrl"
          name="base_url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="erp.form.baseUrlPlaceholder"
        />

        {/* Credentials — WRITE-ONLY. Never display a stored value. */}
        <div className="mb-4 rounded-lg border border-gray-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-text">
              {t('erp.form.credentials')}
            </span>
            {isEdit && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  connection?.has_credentials
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {connection?.has_credentials
                  ? t('erp.form.credentialsConfigured')
                  : t('erp.form.credentialsNotConfigured')}
              </span>
            )}
          </div>

          {isEdit && !replaceCreds && (
            <button
              type="button"
              onClick={() => setReplaceCreds(true)}
              className="text-sm font-medium text-primary hover:underline"
            >
              {t('erp.form.replaceCredentials')}
            </button>
          )}

          {replaceCreds && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">{t('erp.form.credentialsHint')}</p>
              {creds.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    aria-label={t('erp.form.credentialKey')}
                    placeholder={t('erp.form.credentialKey')}
                    value={row.key}
                    onChange={(e) => updateCred(i, { key: e.target.value })}
                    className="w-1/2 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <input
                    type="password"
                    aria-label={t('erp.form.credentialValue')}
                    placeholder={t('erp.form.credentialValue')}
                    value={row.value}
                    autoComplete="new-password"
                    onChange={(e) => updateCred(i, { value: e.target.value })}
                    className="w-1/2 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setCreds((rows) => rows.filter((_, idx) => idx !== i))
                    }
                    aria-label={t('erp.remove')}
                    className="flex-shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setCreds((rows) => [...rows, { key: '', value: '' }])}
                className="text-sm font-medium text-primary hover:underline"
              >
                {t('erp.form.addCredentialField')}
              </button>
            </div>
          )}
        </div>

        <label className="mb-2 flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
          />
          {t('erp.form.enabled')}
        </label>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" dir="auto">
            {error}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
