import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { PartyRole } from '@/types';
import { partyService } from '@/services/api/partyService';

/**
 * Multi-tier T0c-2 — the contract-party ROLE picker.
 *
 * Reads the party_roles registry via GET /party-roles?applies_to=contract
 * (rows where applies_to IN ('contract','both')) and renders the label in the
 * active locale (label_en/ar/fr) — NEVER hardcoded role strings. Mirrors the
 * RelationshipTypeSelector locale idiom + React Query reference-data caching.
 *
 * A native <select> (not the card grid) matches the mock's compact per-party
 * "Role" dropdown. The empty value renders the localized placeholder so an
 * unset role is visible (and drives the ROLE_REQUIRED validation state).
 */
interface Props {
  value: string; // registry code, or '' when unset
  onChange: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
}

export default function PartyRoleSelect({
  value,
  onChange,
  disabled,
  invalid,
  id,
}: Props) {
  const { t, i18n } = useTranslation();

  const rolesQ = useQuery({
    queryKey: ['party-roles', 'contract'],
    queryFn: () => partyService.getRoles('contract'),
    staleTime: 1000 * 60 * 60, // reference data — refetch at most hourly
  });

  const labelFor = (r: PartyRole) => {
    if (i18n.language === 'ar') return r.label_ar;
    if (i18n.language === 'fr') return r.label_fr;
    return r.label_en;
  };

  const roles = [...(rolesQ.data ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  return (
    <select
      id={id}
      value={value}
      disabled={disabled || rolesQ.isLoading}
      onChange={(e) => onChange(e.target.value)}
      dir="auto"
      aria-invalid={invalid ? true : undefined}
      className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 transition focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-gray-50 ${
        invalid
          ? 'border-red-300 focus:border-red-400'
          : 'border-gray-200 focus:border-primary'
      }`}
    >
      <option value="">
        {rolesQ.isError
          ? t('partiesEditor.role.loadError')
          : t('partiesEditor.role.placeholder')}
      </option>
      {roles.map((r) => (
        <option key={r.code} value={r.code}>
          {labelFor(r)}
        </option>
      ))}
    </select>
  );
}
