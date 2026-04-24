import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Eye,
  Lock,
  Unlock,
  X,
  ChevronLeft,
  ChevronRight,
  Building2,
  AlertTriangle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { adminService } from '@/services/api/adminService';
import type {
  AdminOrganization,
  AdminOrganizationDetail,
  OrganizationFilters,
  OrgStatusFilter,
} from '@/services/api/adminService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;
const QUERY_KEY_LIST = ['admin', 'organizations'] as const;
const QUERY_KEY_DETAIL = ['admin', 'organizations', 'detail'] as const;

const FEATURE_FLAG_KEYS: { key: string; label: string; description: string }[] = [
  { key: 'ai_document_processing', label: 'AI Document Processing', description: 'Automated extraction and analysis of uploaded contracts' },
  { key: 'risk_analysis',           label: 'Risk Analysis',           description: 'Automated contract risk scoring and flags' },
  { key: 'claims_management',       label: 'Claims Management',       description: 'Track and manage project claims' },
  { key: 'notice_management',       label: 'Notice Management',       description: 'Track and manage contractual notices' },
  { key: 'sub_contracts',           label: 'Sub-Contracts',           description: 'Sub-contract tracking and management' },
  { key: 'obligations_tracking',    label: 'Obligations Tracking',    description: 'Track contract obligations with reminders' },
  { key: 'version_history',         label: 'Version History',         description: 'Full contract version history and diffs' },
  { key: 'approval_workflow',       label: 'Approval Workflow',       description: 'Multi-step contract approval chains' },
  { key: 'e_signature',             label: 'E-Signature',             description: 'DocuSign and native e-signature' },
  { key: 'contract_sharing',        label: 'Contract Sharing',        description: 'Share contracts with external parties' },
  { key: 'knowledge_base_access',   label: 'Knowledge Base Access',   description: 'Access to the KB and citations' },
  { key: 'ai_chat',                 label: 'AI Chat',                 description: 'In-app AI contract assistant' },
  { key: 'advanced_analytics',      label: 'Advanced Analytics',      description: 'Premium analytics and dashboards' },
  { key: 'custom_clauses',          label: 'Custom Clauses',          description: 'Organization-managed clause library' },
  { key: 'multi_project',           label: 'Multi-Project',           description: 'Run multiple concurrent projects' },
  { key: 'contractor_portal',       label: 'Contractor Portal',       description: 'Contractor-facing portal access' },
];

// Cycle pill colors by plan name hash
const PLAN_PILL_COLORS = [
  { bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-200'    },
  { bg: 'bg-purple-50',  text: 'text-purple-700',  ring: 'ring-purple-200'  },
  { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  { bg: 'bg-amber-50',   text: 'text-amber-800',   ring: 'ring-amber-200'   },
  { bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-200'    },
  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  ring: 'ring-indigo-200'  },
];

function planColor(name: string | null | undefined) {
  if (!name) return PLAN_PILL_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PLAN_PILL_COLORS[h % PLAN_PILL_COLORS.length];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return formatDistanceToNow(d, { addSuffix: true });
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AdminOrganizationsPage() {
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [industry, setIndustry] = useState('');
  const [planId, setPlanId] = useState('');
  const [status, setStatus] = useState<OrgStatusFilter | ''>('');

  const [detailId, setDetailId] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AdminOrganization | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendBusy, setSuspendBusy] = useState(false);

  const filters: OrganizationFilters = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: search.trim() || undefined,
      country: country.trim() || undefined,
      industry: industry.trim() || undefined,
      planId: planId || undefined,
      status: status || undefined,
    }),
    [page, search, country, industry, planId, status],
  );

  const listQuery = useQuery({
    queryKey: [...QUERY_KEY_LIST, filters],
    queryFn: () => adminService.getOrganizations(filters),
    retry: 1,
  });

  // Fetch plans for filter dropdown (reuse existing endpoint)
  const plansQuery = useQuery({
    queryKey: ['admin', 'subscription-plans', 'all'],
    queryFn: adminService.getPlans,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  const organizations = listQuery.data?.data ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = listQuery.data?.totalPages ?? 1;

  // Derive unique country and industry options from current page
  const countryOptions = useMemo(() => {
    const s = new Set<string>();
    organizations.forEach((o) => o.country && s.add(o.country));
    return Array.from(s).sort();
  }, [organizations]);

  const industryOptions = useMemo(() => {
    const s = new Set<string>();
    organizations.forEach((o) => o.industry && s.add(o.industry));
    return Array.from(s).sort();
  }, [organizations]);

  const clearFilters = () => {
    setCountry('');
    setIndustry('');
    setPlanId('');
    setStatus('');
    setSearch('');
    setPage(1);
  };

  const invalidateList = () =>
    qc.invalidateQueries({ queryKey: QUERY_KEY_LIST });

  const invalidateDetail = (id: string) =>
    qc.invalidateQueries({ queryKey: [...QUERY_KEY_DETAIL, id] });

  const handleUnsuspend = async (org: AdminOrganization) => {
    if (!confirm(`Remove suspension for ${org.name}?`)) return;
    try {
      await adminService.unsuspendOrganization(org.id);
      toast.success(`${org.name} unsuspended`);
      invalidateList();
      if (detailId === org.id) invalidateDetail(org.id);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to unsuspend');
    }
  };

  const submitSuspend = async () => {
    if (!suspendTarget) return;
    const reason = suspendReason.trim();
    if (!reason) {
      toast.error('Reason is required');
      return;
    }
    setSuspendBusy(true);
    try {
      await adminService.suspendOrganization(suspendTarget.id, reason);
      toast.success(`${suspendTarget.name} suspended`);
      invalidateList();
      if (detailId === suspendTarget.id) invalidateDetail(suspendTarget.id);
      setSuspendTarget(null);
      setSuspendReason('');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to suspend');
    } finally {
      setSuspendBusy(false);
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Organization Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            View and manage all customer organizations on the platform.
          </p>
        </div>
        <div className="text-right text-sm text-gray-500">
          {listQuery.isLoading ? (
            <span>Loading…</span>
          ) : (
            <span>
              <span className="font-semibold text-gray-900">{total}</span>{' '}
              {total === 1 ? 'organization' : 'organizations'}
            </span>
          )}
        </div>
      </div>

      {/* Search + Filters */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by organization name or CRN…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Country</label>
              <select
                value={country}
                onChange={(e) => { setCountry(e.target.value); setPage(1); }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All countries</option>
                {countryOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Industry</label>
              <select
                value={industry}
                onChange={(e) => { setIndustry(e.target.value); setPage(1); }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All industries</option>
                {industryOptions.map((ind) => (
                  <option key={ind} value={ind}>{ind}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Plan</label>
              <select
                value={planId}
                onChange={(e) => { setPlanId(e.target.value); setPage(1); }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All plans</option>
                {(plansQuery.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value as OrgStatusFilter | ''); setPage(1); }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Clear filters
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner />
          </div>
        ) : listQuery.isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="mb-2 h-8 w-8 text-red-500" />
            <p className="text-sm text-gray-700">Failed to load organizations.</p>
            <button
              onClick={() => listQuery.refetch()}
              className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        ) : organizations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="mb-2 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-700">No organizations match your filters.</p>
            <button
              onClick={clearFilters}
              className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Industry</th>
                  <th className="px-4 py-3">Country</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3 text-right">Users</th>
                  <th className="px-4 py-3 text-right">Projects</th>
                  <th className="px-4 py-3 text-right">Contracts</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white text-sm text-gray-700">
                {organizations.map((org) => (
                  <OrgRow
                    key={org.id}
                    org={org}
                    onView={() => setDetailId(org.id)}
                    onSuspend={() => {
                      setSuspendTarget(org);
                      setSuspendReason('');
                    }}
                    onUnsuspend={() => handleUnsuspend(org)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!listQuery.isLoading && organizations.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
            <div className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40 enabled:hover:bg-gray-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40 enabled:hover:bg-gray-50"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {detailId && (
        <OrganizationDetailDrawer
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            invalidateList();
            invalidateDetail(detailId);
          }}
          onRequestSuspend={(org) => {
            setSuspendTarget({
              id: org.id,
              name: org.name,
              industry: org.industry,
              country: org.country,
              crn: org.crn,
              logo_url: org.logo_url,
              created_at: org.created_at,
              activeUserCount: org.currentUsage.users.used,
              projectCount: org.currentUsage.projects.used,
              contractCount: 0,
              currentPlan: org.currentPlan
                ? { id: org.currentPlan.id, name: org.currentPlan.name, status: org.currentPlan.status, expiresAt: org.currentPlan.expiresAt }
                : null,
              isSuspended: org.isSuspended,
              suspensionReason: org.suspensionReason,
            });
            setSuspendReason('');
          }}
        />
      )}

      {/* Suspend modal */}
      {suspendTarget && (
        <SuspendConfirmModal
          org={suspendTarget}
          reason={suspendReason}
          onChange={setSuspendReason}
          busy={suspendBusy}
          onCancel={() => { setSuspendTarget(null); setSuspendReason(''); }}
          onConfirm={submitSuspend}
        />
      )}
    </div>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────────────

interface OrgRowProps {
  org: AdminOrganization;
  onView: () => void;
  onSuspend: () => void;
  onUnsuspend: () => void;
}

function OrgRow({ org, onView, onSuspend, onUnsuspend }: OrgRowProps) {
  const plan = org.currentPlan;
  const pc = planColor(plan?.name);

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {org.logo_url ? (
            <img src={org.logo_url} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-gray-200" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
              {initials(org.name) || '?'}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate font-medium text-gray-900">{org.name}</div>
            <div className="truncate text-xs text-gray-500">CRN: {org.crn || '—'}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-gray-700">{org.industry || '—'}</td>
      <td className="px-4 py-3 text-gray-700">{org.country || '—'}</td>
      <td className="px-4 py-3">
        {plan ? (
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${pc.bg} ${pc.text} ${pc.ring}`}>
            {plan.name}
          </span>
        ) : (
          <span className="text-xs text-gray-400">No plan</span>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <UsersCell users={org.activeUserCount} plan={org.currentPlan?.name} />
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{org.projectCount}</td>
      <td className="px-4 py-3 text-right tabular-nums">{org.contractCount}</td>
      <td className="px-4 py-3">
        {org.isSuspended ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            Suspended
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Active
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-gray-600">{fmtDate(org.created_at)}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onView}
            title="View details"
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </button>
          {org.isSuspended ? (
            <button
              onClick={onUnsuspend}
              title="Remove suspension"
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
            >
              <Unlock className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={onSuspend}
              title="Suspend organization"
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
            >
              <Lock className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function UsersCell({ users, plan: _plan }: { users: number; plan: string | null | undefined }) {
  // Without plan max from list endpoint, show plain count; amber highlight is shown in detail drawer.
  return <span>{users}</span>;
}

// ─── Suspend Confirm Modal ────────────────────────────────────────────────────

interface SuspendConfirmModalProps {
  org: AdminOrganization;
  reason: string;
  onChange: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function SuspendConfirmModal({ org, reason, onChange, busy, onCancel, onConfirm }: SuspendConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h3 className="text-base font-semibold text-gray-900">Suspend organization</h3>
          <button onClick={onCancel} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              Suspending <span className="font-semibold">{org.name}</span> will disable all user logins
              and block their access to the platform until reinstated.
            </div>
          </div>
          <label className="block text-sm font-medium text-gray-700">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            autoFocus
            rows={4}
            value={reason}
            onChange={(e) => onChange(e.target.value)}
            placeholder="E.g., Non-payment, ToS violation, customer request…"
            className="w-full rounded-md border border-gray-300 p-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
          <p className="text-xs text-gray-500">This reason will be recorded in the audit log.</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || !reason.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Lock className="h-3.5 w-3.5" />
            {busy ? 'Suspending…' : 'Suspend'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Drawer ─────────────────────────────────────────────────────────────

interface DrawerProps {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onRequestSuspend: (org: AdminOrganizationDetail) => void;
}

function OrganizationDetailDrawer({ id, onClose, onChanged, onRequestSuspend }: DrawerProps) {
  const qc = useQueryClient();

  const detailQuery = useQuery({
    queryKey: [...QUERY_KEY_DETAIL, id],
    queryFn: () => adminService.getOrganizationById(id),
    retry: 1,
  });

  const [flagsBusy, setFlagsBusy] = useState(false);
  const [localFlags, setLocalFlags] = useState<Record<string, boolean> | null>(null);

  const org = detailQuery.data;

  const flags: Record<string, boolean> =
    localFlags ?? (org?.featureFlagOverrides ?? {});

  const hasFlagChanges = useMemo(() => {
    if (!localFlags || !org) return false;
    const orig = org.featureFlagOverrides ?? {};
    const keys = new Set([...Object.keys(localFlags), ...Object.keys(orig)]);
    for (const k of keys) {
      const a = !!localFlags[k];
      const b = !!orig[k];
      if (a !== b) return true;
    }
    return false;
  }, [localFlags, org]);

  const toggleFlag = (key: string) => {
    const base = org?.featureFlagOverrides ?? {};
    const cur = localFlags ?? { ...base };
    const next = { ...cur, [key]: !cur[key] };
    setLocalFlags(next);
  };

  const saveFlags = async () => {
    if (!org || !localFlags) return;
    setFlagsBusy(true);
    try {
      await adminService.updateFeatureFlags(org.id, localFlags);
      toast.success('Feature flags saved');
      await qc.invalidateQueries({ queryKey: [...QUERY_KEY_DETAIL, org.id] });
      setLocalFlags(null);
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to save');
    } finally {
      setFlagsBusy(false);
    }
  };

  const cancelFlagEdits = () => setLocalFlags(null);

  const handleUnsuspend = async () => {
    if (!org) return;
    if (!confirm(`Remove suspension for ${org.name}?`)) return;
    try {
      await adminService.unsuspendOrganization(org.id);
      toast.success('Suspension removed');
      await qc.invalidateQueries({ queryKey: [...QUERY_KEY_DETAIL, org.id] });
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to unsuspend');
    }
  };

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="absolute right-0 top-0 h-full w-[480px] max-w-full overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {detailQuery.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : detailQuery.isError || !org ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-red-500" />
            <p className="text-sm text-gray-700">Failed to load organization.</p>
            <button
              onClick={() => detailQuery.refetch()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              Retry
            </button>
            <button onClick={onClose} className="mt-2 text-sm text-gray-500 underline">Close</button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between border-b border-gray-200 p-5">
              <div className="flex items-center gap-3">
                {org.logo_url ? (
                  <img src={org.logo_url} alt="" className="h-12 w-12 rounded-full object-cover ring-1 ring-gray-200" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-semibold text-white">
                    {initials(org.name) || '?'}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-gray-900">{org.name}</h2>
                    {org.isSuspended ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200">
                        Suspended
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-gray-500">
                    CRN: {org.crn || '—'} · {org.industry || '—'} · {org.country || '—'}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-400">Joined {fmtDate(org.created_at)}</div>
                </div>
              </div>
              <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Suspension banner */}
            {org.isSuspended && (
              <div className="border-b border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium">This organization is suspended</div>
                    {org.suspensionReason && (
                      <div className="mt-0.5 text-xs">Reason: {org.suspensionReason}</div>
                    )}
                    {org.suspendedAt && (
                      <div className="mt-0.5 text-xs">Since: {fmtDate(org.suspendedAt)}</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-6 p-5">
              {/* Current Plan */}
              <Section title="Current Plan">
                {org.currentPlan ? (
                  <div className="rounded-md border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-900">{org.currentPlan.name}</div>
                        <div className="text-xs text-gray-500">
                          {org.currentPlan.currency} {org.currentPlan.price.toFixed(2)}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                        {org.currentPlan.status}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div>Start: {fmtDate(org.currentPlan.startDate)}</div>
                      <div>Expires: {fmtDate(org.currentPlan.expiresAt)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-500">
                    No active subscription.
                  </div>
                )}
              </Section>

              {/* Usage vs Limits */}
              <Section title="Usage vs Limits">
                <div className="space-y-3">
                  <UsageBar label="Users"    used={org.currentUsage.users.used}    max={org.currentUsage.users.max} />
                  <UsageBar label="Projects" used={org.currentUsage.projects.used} max={org.currentUsage.projects.max} />
                </div>
              </Section>

              {/* Subscription History */}
              <Section title="Subscription History">
                {org.subscriptionHistory.length === 0 ? (
                  <p className="text-xs text-gray-500">No prior subscriptions.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                    {org.subscriptionHistory.map((h) => (
                      <li key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium text-gray-900">{h.planName || '—'}</div>
                          <div className="text-xs text-gray-500">
                            {fmtDate(h.startDate)} → {h.endDate ? fmtDate(h.endDate) : 'Present'}
                          </div>
                        </div>
                        <span className="text-xs text-gray-600">{h.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* Team Members */}
              <Section title={`Team Members (${org.users.length})`}>
                {org.users.length === 0 ? (
                  <p className="text-xs text-gray-500">No users.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                    {org.users.slice(0, 10).map((u) => (
                      <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-gray-900">{u.name || u.email}</div>
                          <div className="truncate text-xs text-gray-500">{u.email}</div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs text-gray-600">{u.role}</span>
                          <span className={`text-xs ${u.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {u.is_active ? 'Active' : 'Inactive'}
                            {u.last_login_at ? ` · ${fmtRelative(u.last_login_at)}` : ''}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {org.users.length > 10 && (
                  <p className="mt-2 text-xs text-gray-500">Showing 10 of {org.users.length} users.</p>
                )}
              </Section>

              {/* Feature Flag Overrides */}
              <Section
                title="Feature Flag Overrides"
                action={
                  hasFlagChanges ? (
                    <div className="flex gap-2">
                      <button
                        onClick={cancelFlagEdits}
                        disabled={flagsBusy}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveFlags}
                        disabled={flagsBusy}
                        className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {flagsBusy ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  ) : null
                }
              >
                <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                  {FEATURE_FLAG_KEYS.map((f) => {
                    const on = !!flags[f.key];
                    return (
                      <li key={f.key} className="flex items-start justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900">{f.label}</div>
                          <div className="text-xs text-gray-500">{f.description}</div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          onClick={() => toggleFlag(f.key)}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                            on ? 'bg-blue-600' : 'bg-gray-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              on ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Section>

              {/* Recent Activity */}
              <Section title="Recent Activity">
                {org.recentAuditLogs.length === 0 ? (
                  <p className="text-xs text-gray-500">No recent audit log entries.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                    {org.recentAuditLogs.map((a) => (
                      <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-gray-900">{a.action}</div>
                          <div className="truncate text-xs text-gray-500">
                            {a.entityType || 'system'}{a.user ? ` · ${a.user}` : ''}
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {fmtRelative(a.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* Danger Zone */}
              <Section title="Danger Zone">
                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  {org.isSuspended ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-red-800">
                        Lift the suspension to restore access for all users of this organization.
                      </div>
                      <button
                        onClick={handleUnsuspend}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        <Unlock className="h-3.5 w-3.5" />
                        Remove suspension
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-red-800">
                        Suspending will block all user access to the platform until reinstated.
                      </div>
                      <button
                        onClick={() => onRequestSuspend(org)}
                        className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Suspend organization
                      </button>
                    </div>
                  )}
                </div>
              </Section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Primitives ────────────────────────────────────────────────────────────────

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number }) {
  const hasLimit = max > 0;
  const pct = hasLimit ? Math.min(100, Math.round((used / max) * 100)) : 0;
  let barColor = 'bg-emerald-500';
  let labelTint = 'text-gray-700';
  if (hasLimit) {
    if (pct >= 80) { barColor = 'bg-red-500'; labelTint = 'text-red-700'; }
    else if (pct >= 60) { barColor = 'bg-amber-500'; labelTint = 'text-amber-700'; }
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-gray-700">{label}</span>
        <span className={`tabular-nums ${labelTint}`}>
          {used} / {hasLimit ? max : '∞'}{hasLimit ? ` · ${pct}%` : ''}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        {hasLimit ? (
          <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full bg-gray-300" style={{ width: '10%' }} />
        )}
      </div>
    </div>
  );
}
