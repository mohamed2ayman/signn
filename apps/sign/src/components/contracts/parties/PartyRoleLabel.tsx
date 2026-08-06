import { useTranslation } from 'react-i18next';
import type { PartyRole } from '@/types';
import { partyRoleLabel } from '@/components/contracts/parties/PartyRoleSelect';

/**
 * Party Foundation Slice 1b — READ-ONLY localized label for a party_roles code.
 *
 * The registry is the single source for labels, so a stored code is resolved
 * through it rather than mapped in the consumer.
 *
 * PURE by design: the roles are INJECTED, not fetched. The one consumer today
 * (ContractDetailPage) owns its own fetch with that file's plain
 * useState/useEffect pattern — pulling React Query into that tree would be a
 * new data-fetching pattern in a page that has none.
 *
 * Fallback: an unresolvable code (inactive, or removed from the registry)
 * renders the RAW CODE rather than a blank — a contract that stored 'OPERATOR'
 * before that role was deactivated must not silently display nothing. An
 * empty/absent `code` renders the caller's `emptyText`.
 */
interface Props {
  roles: PartyRole[];
  code?: string | null;
  emptyText?: string;
}

export default function PartyRoleLabel({ roles, code, emptyText = '—' }: Props) {
  const { i18n } = useTranslation();

  if (!code) return <>{emptyText}</>;

  const match = roles.find((r) => r.code === code);
  return <>{match ? partyRoleLabel(match, i18n.language) : code}</>;
}
