import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import complianceService, {
  type ContractObligation,
  type ObligationStatus,
} from '@/services/api/complianceService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

/**
 * /app/projects/:id/obligations — project-wide obligations dashboard.
 *
 * Aggregates every obligation from every contract in the project, with
 * filters, summary stats, and a project-scope timeline view.
 */
export default function ProjectObligationsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<{
    party?: string;
    type?: string;
    status?: ObligationStatus;
  }>({});

  const obligations = useQuery({
    queryKey: ['project-obligations', projectId, filter],
    queryFn: () =>
      complianceService.listProjectObligations(projectId!, filter),
    enabled: !!projectId,
  });

  const stats = useMemo(() => {
    const items = obligations.data ?? [];
    const week = Date.now() + 7 * 86_400_000;
    return {
      total: items.length,
      critical: items.filter((o) => o.is_critical).length,
      thisWeek: items.filter(
        (o) => o.due_date && +new Date(o.due_date) <= week,
      ).length,
      overdue: items.filter((o) => o.status === 'OVERDUE').length,
      met: items.filter((o) => o.status === 'MET' || o.status === 'COMPLETED')
        .length,
    };
  }, [obligations.data]);

  const grouped = useMemo(() => {
    const items = obligations.data ?? [];
    const map = new Map<string, ContractObligation[]>();
    for (const o of items) {
      if (!o.due_date) continue;
      const month = format(new Date(o.due_date), 'MMM yyyy');
      const list = map.get(month) ?? [];
      list.push(o);
      map.set(month, list);
    }
    return [...map.entries()].sort(
      ([a], [b]) => +new Date(a) - +new Date(b),
    );
  }, [obligations.data]);

  if (obligations.isLoading) return <LoadingSpinner />;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8">
        <button
          onClick={() => navigate(-1)}
          className="mb-2 text-xs text-gray-500 hover:text-gray-700"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Project Obligations</h1>
        <p className="mt-1 text-sm text-gray-600">
          Every obligation across every contract in this project.
        </p>
      </header>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard label="Total" value={stats.total} />
        <SummaryCard label="Critical" value={stats.critical} tone="red" />
        <SummaryCard label="Due this week" value={stats.thisWeek} tone="amber" />
        <SummaryCard label="Overdue" value={stats.overdue} tone="red" />
        <SummaryCard label="Met" value={stats.met} tone="green" />
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <select
          value={filter.party ?? ''}
          onChange={(e) =>
            setFilter({ ...filter, party: e.target.value || undefined })
          }
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All parties</option>
          <option value="CONTRACTOR">Contractor</option>
          <option value="EMPLOYER">Employer</option>
          <option value="ENGINEER">Engineer</option>
          <option value="BOTH">Both</option>
        </select>
        <select
          value={filter.type ?? ''}
          onChange={(e) =>
            setFilter({ ...filter, type: e.target.value || undefined })
          }
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All types</option>
          <option value="NOTICE_PERIOD">Notice period</option>
          <option value="PAYMENT">Payment</option>
          <option value="PERFORMANCE_BOND">Performance bond</option>
          <option value="INSURANCE">Insurance</option>
          <option value="MILESTONE">Milestone</option>
          <option value="DEFECTS_LIABILITY">Defects liability</option>
          <option value="DISPUTE_RESOLUTION">Dispute resolution</option>
          <option value="REPORTING">Reporting</option>
        </select>
        <select
          value={filter.status ?? ''}
          onChange={(e) =>
            setFilter({
              ...filter,
              status: (e.target.value as ObligationStatus) || undefined,
            })
          }
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="MET">Met</option>
          <option value="OVERDUE">Overdue</option>
          <option value="WAIVED">Waived</option>
        </select>
      </div>

      {/* Timeline view */}
      {grouped.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500 shadow-sm">
          No obligations match the filter.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([month, items]) => (
            <section
              key={month}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <h2 className="mb-3 text-sm font-bold uppercase text-gray-500">
                {month}
              </h2>
              <ul className="space-y-2">
                {items.map((o) => (
                  <ObligationRow key={o.id} obligation={o} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'red' | 'amber' | 'green';
}) {
  const color =
    tone === 'red'
      ? 'text-red-600'
      : tone === 'amber'
      ? 'text-amber-600'
      : tone === 'green'
      ? 'text-green-600'
      : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-[10px] font-semibold uppercase text-gray-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function ObligationRow({ obligation }: { obligation: ContractObligation }) {
  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
        obligation.status === 'OVERDUE'
          ? 'border-red-200 bg-red-50'
          : obligation.is_critical
          ? 'border-amber-200 bg-amber-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="min-w-0 flex-1">
        {/* CLAUDE.md hard rule: obligation.description may contain Arabic.
            Phase 7.1 Step 2 — add dir="auto" + unicodeBidi: plaintext
            so RTL text renders correctly. Pre-existing violation fixed. */}
        <p
          className="truncate text-sm font-medium text-gray-900"
          dir="auto"
          style={{ unicodeBidi: 'plaintext' }}
        >
          {obligation.is_critical && (
            <span className="mr-1 text-red-600">⚠</span>
          )}
          {obligation.description}
        </p>
        <p
          className="text-[11px] text-gray-500"
          dir="auto"
          style={{ unicodeBidi: 'plaintext' }}
        >
          {obligation.contract?.name ? `${obligation.contract.name} · ` : ''}
          {obligation.responsible_party ?? '—'} ·{' '}
          {obligation.due_date
            ? format(new Date(obligation.due_date), 'PP')
            : 'No due date'}
        </p>
      </div>
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          obligation.status === 'OVERDUE'
            ? 'bg-red-100 text-red-700'
            : obligation.status === 'MET' || obligation.status === 'COMPLETED'
            ? 'bg-green-100 text-green-700'
            : 'bg-gray-100 text-gray-600'
        }`}
      >
        {obligation.status === 'COMPLETED' ? 'MET' : obligation.status}
      </span>
    </li>
  );
}
