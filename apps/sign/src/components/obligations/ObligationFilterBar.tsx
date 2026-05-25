import { useTranslation } from 'react-i18next';
import type {
  ObligationStatus,
  ObligationType,
} from '@/services/api/complianceService';
import type { Project, ProjectMember } from '@/types';
import { OBLIGATION_STATUSES, OBLIGATION_TYPES } from './statusUtils';

/**
 * Filter shape used by both ObligationsTab and ObligationsPage.
 * Fields are optional — undefined = "no filter".
 */
export interface ObligationFilters {
  type?: ObligationType;
  status?: ObligationStatus;
  assignee?: string; // user_id
  from?: string; // ISO date — "due_date >= from"
  to?: string; // ISO date — "due_date <= to"
  search?: string; // matches description (portfolio only)
  project_id?: string; // portfolio only
  contract_id?: string; // portfolio only
}

interface BaseProps {
  filters: ObligationFilters;
  onChange: (next: ObligationFilters) => void;
  /** Project members shown in the Assignee select. */
  members?: ProjectMember[];
  /** Optional right-side action button (e.g. "Add Obligation"). */
  action?: React.ReactNode;
}

interface ContractScopeProps extends BaseProps {
  variant: 'contract';
}

interface PortfolioScopeProps extends BaseProps {
  variant: 'portfolio';
  projects?: Project[];
}

export type ObligationFilterBarProps = ContractScopeProps | PortfolioScopeProps;

/**
 * Filter bar — composes the same widgets in two variants:
 *
 * - `contract`: type / status / assignee / dates + optional action
 * - `portfolio`: project / contract / type / status / assignee / dates / search
 *
 * Each `<select>` is direction-agnostic; the parent layout uses
 * flex-wrap so the bar collapses gracefully on mobile (375px).
 */
export default function ObligationFilterBar(props: ObligationFilterBarProps) {
  const { t } = useTranslation();
  const { filters, onChange, members = [], action } = props;

  const set = <K extends keyof ObligationFilters>(
    key: K,
    value: ObligationFilters[K] | '',
  ) => onChange({ ...filters, [key]: value === '' ? undefined : value });

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
      {props.variant === 'portfolio' && (
        <>
          <Field label={t('project.title')}>
            <select
              value={filters.project_id ?? ''}
              onChange={(e) => set('project_id', e.target.value)}
              className="min-w-[140px] rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
            >
              <option value="">{t('common.all')}</option>
              {(props.projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <Field label={t('common.type')}>
        <select
          value={filters.type ?? ''}
          onChange={(e) => set('type', e.target.value as ObligationType | '')}
          className="min-w-[140px] rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
        >
          <option value="">{t('common.all')}</option>
          {OBLIGATION_TYPES.map((tp) => (
            <option key={tp} value={tp}>
              {t(`obligation.type.${tp}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('common.status')}>
        <select
          value={filters.status ?? ''}
          onChange={(e) =>
            set('status', e.target.value as ObligationStatus | '')
          }
          className="min-w-[120px] rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
        >
          <option value="">{t('common.all')}</option>
          {OBLIGATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`obligation.status.${s}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('obligation.ui.assignee')}>
        <select
          value={filters.assignee ?? ''}
          onChange={(e) => set('assignee', e.target.value)}
          className="min-w-[140px] rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
        >
          <option value="">{t('common.all')}</option>
          {members
            .filter((m) => !!m.user)
            .map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user?.first_name} {m.user?.last_name}
              </option>
            ))}
        </select>
      </Field>

      <Field label={t('obligation.ui.dueFrom')}>
        <input
          type="date"
          value={filters.from ?? ''}
          onChange={(e) => set('from', e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
      </Field>

      <Field label={t('obligation.ui.dueTo')}>
        <input
          type="date"
          value={filters.to ?? ''}
          onChange={(e) => set('to', e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
      </Field>

      {props.variant === 'portfolio' && (
        <Field label={t('common.search')}>
          <input
            type="search"
            value={filters.search ?? ''}
            onChange={(e) => set('search', e.target.value)}
            placeholder={t('obligation.ui.searchPlaceholder')}
            dir="auto"
            className="min-w-[180px] rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
        </Field>
      )}

      {action && <div className="ml-auto self-end">{action}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}
