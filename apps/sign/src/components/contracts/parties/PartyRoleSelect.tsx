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
 *
 * ── Party Foundation Slice 1b — GROUPED rendering ────────────────────────
 * Roles render inside <optgroup> per `category`. Two different orderings are
 * in play and both come from the registry, never from a hardcoded list:
 *   - GROUPS are ordered by the LOWEST sort_order within each group.
 *   - ROLES WITHIN a group are ordered by sort_order.
 *   - category NULL/'' renders UNGROUPED and LAST (today only OTHER, the
 *     deliberately-uncategorised catch-all — see migration 1776000000001).
 *
 * Because `sort_order` is non-contiguous per category (CONTRACTOR_SIDE spans
 * 20-23, 60, 61, 70; CONSULTANTS spans 30, 31, 40, 50, 80-82), grouping
 * VISIBLY reorders the flat list — SUBCONTRACTOR moves up beside CONTRACTOR,
 * ENGINEER up beside the consultants. That is intended, not a regression.
 *
 * Option LABELS come from the registry (label_en/ar/fr) — data. Group HEADERS
 * come from i18n (`partyRole.group.<CATEGORY>`) — chrome. Keep that split:
 * adding a role must stay a data change, never a code change.
 *
 * ── Two exports, deliberately ────────────────────────────────────────────
 * `PartyRoleSelect` (default) SELF-FETCHES via React Query and is what any
 * page already inside a QueryClientProvider-consuming tree should use.
 * `PartyRoleSelectView` (named) is the same UI with the roles INJECTED and no
 * React Query dependency — for hosts that own their own fetch. ContractDetailPage
 * is one: it fetches with the plain useState/useEffect pattern used throughout
 * that file, and pulling `useQuery` into its tree would be a new data-fetching
 * pattern there. Both share the grouping helpers below, so the ordering rules
 * can never drift between them.
 */

/** Locale-correct registry label. Data, never i18n. */
export function partyRoleLabel(role: PartyRole, language: string): string {
  if (language === 'ar') return role.label_ar;
  if (language === 'fr') return role.label_fr;
  return role.label_en;
}

/**
 * Fold a role list into ordered groups + the ungrouped tail.
 *
 * Sorts by sort_order ascending first, so a category's FIRST appearance is its
 * lowest sort_order — push-on-first-sight then yields groups ordered by lowest
 * member, with each group's roles already in sort_order. One pass, no second
 * sort. `category` of '' is treated as NULL: a blank is not a group.
 */
export function groupPartyRoles(roles: PartyRole[]): {
  groups: { category: string; roles: PartyRole[] }[];
  ungrouped: PartyRole[];
} {
  // Defense in depth: the API serves active-only by default, but an inactive
  // role must NEVER be selectable — that is the whole point of the is_active
  // gate the registry uses to stage new vocabulary. Filtering here means the
  // guarantee holds even if a caller ever passes an unfiltered list.
  // (Deliberately UNLIKE RelationshipTypeSelector, which fetches inactive rows
  // on purpose to render them greyed as "coming soon".)
  const sorted = [...roles]
    .filter((r) => r.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
  const groups: { category: string; roles: PartyRole[] }[] = [];
  const ungrouped: PartyRole[] = [];
  for (const r of sorted) {
    if (!r.category) {
      ungrouped.push(r);
      continue;
    }
    const existing = groups.find((g) => g.category === r.category);
    if (existing) existing.roles.push(r);
    else groups.push({ category: r.category, roles: [r] });
  }
  return { groups, ungrouped };
}

interface ViewProps {
  roles: PartyRole[];
  value: string; // registry code, or '' when unset
  onChange: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  isLoading?: boolean;
  isError?: boolean;
}

/** Pure presentational picker — no data fetching, no React Query. */
export function PartyRoleSelectView({
  roles,
  value,
  onChange,
  disabled,
  invalid,
  id,
  isLoading,
  isError,
}: ViewProps) {
  const { t, i18n } = useTranslation();
  const { groups, ungrouped } = groupPartyRoles(roles);

  // A category Ops adds later has no i18n key yet (the registry is varchar,
  // not an enum — new groups are a data change). Fall back to the raw code
  // rather than leaking a dotted key path into the UI.
  const groupLabel = (category: string) =>
    t(`partyRole.group.${category}`, { defaultValue: category });

  return (
    <select
      id={id}
      value={value}
      disabled={disabled || isLoading}
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
        {isError
          ? t('partiesEditor.role.loadError')
          : t('partiesEditor.role.placeholder')}
      </option>
      {groups.map((g) => (
        <optgroup key={g.category} label={groupLabel(g.category)}>
          {g.roles.map((r) => (
            <option key={r.code} value={r.code}>
              {partyRoleLabel(r, i18n.language)}
            </option>
          ))}
        </optgroup>
      ))}
      {/* Uncategorised roles sit outside every group, after them all. */}
      {ungrouped.map((r) => (
        <option key={r.code} value={r.code}>
          {partyRoleLabel(r, i18n.language)}
        </option>
      ))}
    </select>
  );
}

interface Props {
  value: string; // registry code, or '' when unset
  onChange: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
}

export default function PartyRoleSelect(props: Props) {
  const rolesQ = useQuery({
    queryKey: ['party-roles', 'contract'],
    queryFn: () => partyService.getRoles('contract'),
    staleTime: 1000 * 60 * 60, // reference data — refetch at most hourly
  });

  return (
    <PartyRoleSelectView
      {...props}
      roles={rolesQ.data ?? []}
      isLoading={rolesQ.isLoading}
      isError={rolesQ.isError}
    />
  );
}
