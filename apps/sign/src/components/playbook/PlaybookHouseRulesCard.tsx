import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useQuery } from '@tanstack/react-query';
import type { RootState } from '@/store';
import { UserRole } from '@/types';
import playbookService from '@/services/api/playbookService';
import { coverageOfStandardTypes } from './playbookModel';

/**
 * 7.22 Slice 3 — the "YOUR HOUSE RULES" card on the Knowledge Base page.
 *
 * The Knowledge Base holds what the INDUSTRY says (laws, standards, policies);
 * the playbook holds what THIS ORG says. The card is the bridge between them.
 *
 * OWNER_ADMIN-ONLY, AND THE GATE IS ALSO WHY THE QUERY IS `enabled`-GATED:
 * `GET /playbook/positions` is `@Roles(OWNER_ADMIN)` exact-match, so for every
 * other role it would 403. Rendering nothing AND never firing the request keeps
 * the KB page free of a guaranteed-failing call on every visit for most users
 * (the Sidebar shared-with-me badge precedent).
 *
 * Self-contained on purpose: KnowledgeAssetsPage is legacy useState/useEffect
 * and carries no i18n, so this component owns its own fetch and its own
 * translations rather than threading either through the page.
 */
export default function PlaybookHouseRulesCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useSelector((state: RootState) => state.auth.user);

  // Compare against the ENUM, never a string literal — `user.role` is typed
  // `UserRole`, so a string comparison is a TS2367 "no overlap" error.
  const isOwnerAdmin = user?.role === UserRole.OWNER_ADMIN;

  const query = useQuery({
    queryKey: ['playbook-positions'],
    queryFn: () => playbookService.list(),
    enabled: isOwnerAdmin,
  });

  if (!isOwnerAdmin) return null;

  const coverage = coverageOfStandardTypes(query.data ?? []);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.03] px-5 py-4 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            {t('playbook.kbCard.eyebrow')}
          </p>
          <h2 className="mt-0.5 text-base font-bold text-gray-900">
            {t('playbook.kbCard.title')}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {query.isLoading
              ? t('playbook.kbCard.loading')
              : query.isError
                ? t('playbook.kbCard.error')
                : t('playbook.kbCard.coverage', {
                    covered: coverage.covered,
                    total: coverage.total,
                  })}
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/app/settings/playbook')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-white px-3.5 py-2 text-sm font-semibold text-primary transition hover:bg-primary/5"
        >
          {t('playbook.kbCard.manage')}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
