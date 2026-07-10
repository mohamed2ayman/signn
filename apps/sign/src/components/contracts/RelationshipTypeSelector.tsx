import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { contractService, type RelationshipType } from '@/services/api/contractService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

/**
 * Multi-tier T0a.2 — the relationship-type PICKER for the create-contract flow.
 *
 * Renders the contract_relationship_types registry (fetched from
 * GET /contract-relationship-types?include_inactive=true) grouped by
 * `domain_group`. Active types are selectable cards; inactive ("coming soon")
 * types render greyed/disabled. Type NAMES come from the registry
 * (`label_en/ar/fr`, picked by the active locale); one-line DESCRIPTIONS live
 * as frontend i18n (`relationshipType.desc.<CODE>`) since the registry carries
 * no description column.
 *
 * This is the RELATIONSHIP dimension (the contract's position in the delivery
 * chain / legal relationship) — SEPARATE from the standard FORM chosen via
 * <ContractTypeSelector>. The two are distinct fields and are never merged.
 *
 * Selection is controlled: the parent owns `value` (a registry code) and is
 * notified via `onChange`. The picker does NOT auto-advance the modal — it only
 * sets the field.
 */
interface Props {
  value: string | null;
  onChange: (code: string) => void;
}

// Canonical group order (delivery chain → appointment → property rights →
// party agreement). We still derive the render order from the registry's
// sort_order below; this array is the tiebreak/fallback for grouping.
const GROUP_ORDER = ['delivery_chain', 'appointment', 'property_rights', 'party_agreement'];

export default function RelationshipTypeSelector({ value, onChange }: Props) {
  const { t, i18n } = useTranslation();

  const relTypesQ = useQuery({
    queryKey: ['relationship-types'],
    queryFn: () => contractService.getRelationshipTypes(true),
    staleTime: 1000 * 60 * 60, // reference data — refetch at most hourly
  });

  const labelFor = (rt: RelationshipType) => {
    if (i18n.language === 'ar') return rt.label_ar;
    if (i18n.language === 'fr') return rt.label_fr;
    return rt.label_en;
  };

  // Group the sorted rows by domain_group, preserving the registry's
  // sort_order-driven encounter order for both groups and cards.
  const groups = useMemo(() => {
    const rows = [...(relTypesQ.data ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const byGroup = new Map<string, RelationshipType[]>();
    for (const row of rows) {
      const bucket = byGroup.get(row.domain_group);
      if (bucket) bucket.push(row);
      else byGroup.set(row.domain_group, [row]);
    }
    const seen = Array.from(byGroup.keys());
    const ordered = [
      ...GROUP_ORDER.filter((g) => byGroup.has(g)),
      ...seen.filter((g) => !GROUP_ORDER.includes(g)),
    ];
    return ordered.map((group) => ({ group, items: byGroup.get(group)! }));
  }, [relTypesQ.data]);

  if (relTypesQ.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-gray-200 py-10">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (relTypesQ.isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-center">
        <p className="text-sm text-red-700">{t('relationshipType.loadError')}</p>
        <button
          type="button"
          onClick={() => relTypesQ.refetch()}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
        >
          {t('relationshipType.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(({ group, items }) => (
        <div key={group}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t(`relationshipType.group.${group}`)}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {items.map((rt) => {
              const selected = value === rt.code;
              const label = labelFor(rt);
              const desc = t(`relationshipType.desc.${rt.code}`);

              if (!rt.is_active) {
                // "Coming soon" — greyed, non-selectable.
                return (
                  <div
                    key={rt.code}
                    aria-disabled="true"
                    className="relative flex cursor-not-allowed flex-col gap-1 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3.5 text-start opacity-70"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-500" dir="auto">
                        {label}
                      </p>
                      <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        {t('relationshipType.comingSoon')}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-gray-400" dir="auto">
                      {desc}
                    </p>
                  </div>
                );
              }

              return (
                <button
                  key={rt.code}
                  type="button"
                  onClick={() => onChange(rt.code)}
                  aria-pressed={selected}
                  className={`relative flex flex-col gap-1 rounded-xl border p-3.5 text-start transition-all ${
                    selected
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                      : 'border-gray-200 hover:border-primary/50 hover:bg-gray-50 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900" dir="auto">
                      {label}
                    </p>
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        selected ? 'border-primary bg-primary text-white' : 'border-gray-300 bg-white'
                      }`}
                    >
                      {selected && (
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-gray-500" dir="auto">
                    {desc}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
