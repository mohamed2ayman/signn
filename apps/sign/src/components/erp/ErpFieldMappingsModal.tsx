import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import ModalShell from '@/components/obligations/ModalShell';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  erpService,
  type ErpConnection,
  type FieldMappingInput,
} from '@/services/api/erpService';
import { ERP_TARGET_FIELDS, ERP_REQUIRED_TARGET_FIELDS } from './erpConstants';

interface Row {
  source_field: string;
  target_field: string;
}

/**
 * Phase 7.28 Part 2a — configure a connection's field mappings.
 *
 * Each row maps an ERP-native field name (free text) onto a SIGN neutral target
 * field (select). Full replacement via PUT /erp/connections/:id/mappings. The
 * cost_code / amount / currency targets are required for import to produce rows.
 */
export default function ErpFieldMappingsModal({
  isOpen,
  onClose,
  connection,
}: {
  isOpen: boolean;
  onClose: () => void;
  connection: ErpConnection;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);

  const mappingsQuery = useQuery({
    queryKey: ['erp-mappings', connection.id],
    queryFn: () => erpService.getMappings(connection.id),
    enabled: isOpen,
  });

  // Hydrate the editor from the loaded mappings once.
  useEffect(() => {
    if (mappingsQuery.data) {
      setRows(
        mappingsQuery.data.map((m) => ({
          source_field: m.source_field,
          target_field: m.target_field,
        })),
      );
    }
  }, [mappingsQuery.data]);

  const mutation = useMutation({
    mutationFn: (mappings: FieldMappingInput[]) =>
      erpService.setMappings(connection.id, mappings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erp-mappings', connection.id] });
      toast.success(t('erp.mappings.saved'));
      onClose();
    },
    onError: () => toast.error(t('erp.mappings.saveError')),
  });

  const handleSave = () => {
    const clean = rows
      .map((r) => ({
        source_field: r.source_field.trim(),
        target_field: r.target_field,
      }))
      .filter((r) => r.source_field && r.target_field);
    mutation.mutate(clean);
  };

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const mappedTargets = new Set(rows.map((r) => r.target_field).filter(Boolean));
  const missingRequired = ERP_REQUIRED_TARGET_FIELDS.filter(
    (f) => !mappedTargets.has(f),
  );

  const selectClass =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={t('erp.mappings.title')}
      subtitle={connection.name}
      size="lg"
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
            onClick={handleSave}
            disabled={mutation.isPending || mappingsQuery.isLoading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {mutation.isPending ? t('erp.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-gray-600">{t('erp.mappings.help')}</p>

      {mappingsQuery.isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : mappingsQuery.isError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {t('erp.mappings.loadError')}
        </p>
      ) : (
        <>
          {missingRequired.length > 0 && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t('erp.mappings.missingRequired', {
                fields: missingRequired
                  .map((f) => t(`erp.targetField.${f}`))
                  .join(', '),
              })}
            </p>
          )}

          <div className="space-y-2">
            {rows.length === 0 && (
              <p className="text-sm text-gray-500">{t('erp.mappings.empty')}</p>
            )}
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  aria-label={t('erp.mappings.sourceField')}
                  placeholder={t('erp.mappings.sourcePlaceholder')}
                  value={row.source_field}
                  onChange={(e) => updateRow(i, { source_field: e.target.value })}
                  dir="auto"
                  className="w-1/2 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="flex-shrink-0 text-gray-400">→</span>
                <select
                  aria-label={t('erp.mappings.targetField')}
                  value={row.target_field}
                  onChange={(e) => updateRow(i, { target_field: e.target.value })}
                  className={`w-1/2 ${selectClass}`}
                >
                  <option value="">{t('erp.mappings.selectTarget')}</option>
                  {ERP_TARGET_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {t(`erp.targetField.${f}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                  aria-label={t('erp.remove')}
                  className="flex-shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setRows((rs) => [...rs, { source_field: '', target_field: '' }])
            }
            className="mt-3 text-sm font-medium text-primary hover:underline"
          >
            {t('erp.mappings.addRow')}
          </button>
        </>
      )}
    </ModalShell>
  );
}
