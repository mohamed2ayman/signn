import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import complianceService, {
  type ComplianceCheck,
  type ComplianceFinding,
  type ComplianceFindingLayer,
  type ComplianceFindingSeverity,
  type ContractObligation,
} from '@/services/api/complianceService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import AIDisclaimer from '@/components/common/AIDisclaimer';

interface Props {
  contractId: string;
  contractName: string;
  userEmail: string;
}

/**
 * Compliance tab for ContractDetailPage.
 *
 * Shows the most recent compliance check, its findings split by layer,
 * a Run-New-Check button, and the 3 "Email Report" buttons.
 */
export default function ComplianceTab({ contractId, contractName, userEmail }: Props) {
  const qc = useQueryClient();
  const [activeLayer, setActiveLayer] =
    useState<ComplianceFindingLayer>('STANDARD');
  const [confirmReport, setConfirmReport] = useState<
    'summary' | 'conflict' | 'obligations' | null
  >(null);
  const [toast, setToast] = useState<string | null>(null);

  const checks = useQuery({
    queryKey: ['compliance-checks', contractId],
    queryFn: () => complianceService.listChecks(contractId),
  });

  const latestCheckId = checks.data?.[0]?.id ?? null;

  const detail = useQuery({
    queryKey: ['compliance-check', latestCheckId],
    queryFn: () => complianceService.getCheck(contractId, latestCheckId!),
    enabled: !!latestCheckId,
    refetchInterval: (q) => {
      const data = q.state.data as ComplianceCheck | undefined;
      if (!data) return false;
      if (data.overall_status === 'FAILED') return false;
      const stillRunning =
        data.overall_status === 'PENDING' ||
        data.obligation_extraction_status === 'PENDING' ||
        data.obligation_extraction_status === 'RUNNING';
      return stillRunning ? 4000 : false;
    },
  });

  const obligations = useQuery({
    queryKey: ['contract-obligations', contractId],
    queryFn: () => complianceService.listContractObligations(contractId),
  });

  const runCheck = useMutation({
    mutationFn: () => complianceService.runCheck(contractId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-checks', contractId] });
    },
  });

  const emailReport = useMutation({
    mutationFn: (type: 'summary' | 'conflict' | 'obligations') =>
      complianceService.emailReport(contractId, latestCheckId!, type),
    onSuccess: (res) => {
      setToast(
        `Your report is being generated and will be sent to ${res.email} within a few minutes.`,
      );
      setConfirmReport(null);
    },
    onError: () => {
      setToast('Could not queue the report. Please try again.');
      setConfirmReport(null);
    },
  });

  const updateFinding = useMutation({
    mutationFn: (input: { findingId: string; status: any }) =>
      complianceService.updateFinding(
        contractId,
        latestCheckId!,
        input.findingId,
        input.status,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-check', latestCheckId] });
    },
  });

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  if (checks.isLoading) return <LoadingSpinner />;

  const check = detail.data;
  const findings = check?.findings ?? [];
  const summary = check?.findings_summary ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {!check ? (
          <div className="text-center">
            <h2 className="text-lg font-semibold text-gray-900">
              Compliance Monitoring
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Run a multi-layer compliance check against the contract's standard
              form, the project's jurisdiction, and your organisation playbook.
            </p>
            <button
              onClick={() => runCheck.mutate()}
              disabled={runCheck.isPending}
              className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {runCheck.isPending ? 'Starting…' : 'Run Compliance Check'}
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Compliance Check
                  </h2>
                  <StatusBadge status={check.overall_status} />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Checked against{' '}
                  <strong>{check.contract_type ?? '—'}</strong>
                  {check.jurisdiction ? ` + ${check.jurisdiction} law` : ''} ·
                  Based on {check.knowledge_assets_used?.length ?? 0} knowledge
                  sources · Last checked{' '}
                  {formatDistanceToNow(new Date(check.created_at), {
                    addSuffix: true,
                  })}
                </p>
              </div>
              <button
                onClick={() => runCheck.mutate()}
                disabled={runCheck.isPending}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 disabled:opacity-60"
              >
                {runCheck.isPending ? 'Starting…' : 'Run New Check'}
              </button>
            </div>

            {/* Progress (when running) */}
            {check.overall_status !== 'FAILED' &&
              (check.overall_status === 'PENDING' ||
                check.obligation_extraction_status === 'RUNNING' ||
                check.obligation_extraction_status === 'PENDING') && (
              <ProgressBar check={check} />
            )}

            {/* Summary */}
            {summary && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Total" value={summary.total ?? findings.length} />
                <Stat
                  label="Critical"
                  value={summary.by_severity?.CRITICAL ?? 0}
                  tone="red"
                />
                <Stat
                  label="High"
                  value={summary.by_severity?.HIGH ?? 0}
                  tone="amber"
                />
                <Stat
                  label="Medium"
                  value={summary.by_severity?.MEDIUM ?? 0}
                />
                <Stat
                  label="Knowledge sources"
                  value={check.knowledge_assets_used?.length ?? 0}
                />
              </div>
            )}

            {/* Email report buttons */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setConfirmReport('summary')}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                ✉ Email Compliance Report
              </button>
              <button
                onClick={() => setConfirmReport('conflict')}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                ✉ Email Conflict Report
              </button>
              <button
                onClick={() => setConfirmReport('obligations')}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                ✉ Email Obligations Report
              </button>
            </div>
          </>
        )}
      </section>

      {/* Findings */}
      {check && findings.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex border-b border-gray-200">
            {(
              [
                'STANDARD',
                'JURISDICTION',
                'PLAYBOOK',
                'CONFLICT',
              ] as ComplianceFindingLayer[]
            ).map((l) => {
              const count = findings.filter((f) => f.layer === l).length;
              return (
                <button
                  key={l}
                  onClick={() => setActiveLayer(l)}
                  className={`flex-1 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                    activeLayer === l
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {layerLabel(l)}{' '}
                  {count > 0 && (
                    <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px]">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <FindingsTable
            findings={findings.filter((f) => f.layer === activeLayer)}
            onUpdate={(id, status) =>
              updateFinding.mutate({ findingId: id, status })
            }
          />
        </section>
      )}

      {/* Obligations */}
      {check && obligations.data && obligations.data.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Obligations ({obligations.data.length})
            </h2>
            <a
              href={complianceService.icalExportUrl(contractId)}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              📅 Export iCal
            </a>
          </div>
          <ObligationsByParty
            obligations={obligations.data}
            onMarkMet={async (id) => {
              await complianceService.updateObligation(contractId, id, {
                status: 'MET',
              });
              qc.invalidateQueries({
                queryKey: ['contract-obligations', contractId],
              });
            }}
          />
        </section>
      )}

      {/* Confirm dialog */}
      {confirmReport && (
        <ConfirmDialog
          email={userEmail}
          contractName={contractName}
          onConfirm={() => emailReport.mutate(confirmReport)}
          onCancel={() => setConfirmReport(null)}
          isPending={emailReport.isPending}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      <AIDisclaimer />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────

function StatusBadge({ status }: { status: ComplianceCheck['overall_status'] }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    COMPLIANT: { bg: 'bg-green-100', text: 'text-green-700', label: 'COMPLIANT' },
    PARTIALLY_COMPLIANT: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'PARTIALLY COMPLIANT' },
    NON_COMPLIANT: { bg: 'bg-red-100', text: 'text-red-700', label: 'NON-COMPLIANT' },
    PENDING: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'CHECKING…' },
    FAILED: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'FAILED' },
  };
  const c = map[status] ?? map.PENDING;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'red' | 'amber' }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-gray-900';
  return (
    <div className="rounded-md bg-gray-50 p-3">
      <div className="text-[10px] font-semibold uppercase text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function ProgressBar({ check }: { check: ComplianceCheck }) {
  const stages = [
    { label: 'FIDIC standard compliance', done: check.overall_status !== 'PENDING' },
    { label: 'Jurisdiction law overlay', done: check.overall_status !== 'PENDING' },
    { label: 'Organisation playbook', done: check.overall_status !== 'PENDING' },
    {
      label: 'Extracting obligations',
      done: check.obligation_extraction_status === 'COMPLETED',
    },
  ];
  return (
    <div className="mt-4 space-y-2">
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-2 text-xs">
          {s.done ? (
            <span className="text-green-600">✓</span>
          ) : (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
          )}
          <span className={s.done ? 'text-gray-500' : 'text-gray-900'}>
            {s.label}…
          </span>
        </div>
      ))}
    </div>
  );
}

function FindingsTable({
  findings,
  onUpdate,
}: {
  findings: ComplianceFinding[];
  onUpdate: (id: string, status: any) => void;
}) {
  if (findings.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        No findings in this layer — looks good.
      </div>
    );
  }
  // Pin CRITICAL findings at the top
  const sorted = [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return (
    <table className="min-w-full divide-y divide-gray-200 text-sm">
      <thead className="bg-gray-50">
        <tr className="text-left text-[11px] uppercase text-gray-500">
          <th className="px-4 py-2">Clause</th>
          <th className="px-4 py-2">Requirement</th>
          <th className="px-4 py-2">Severity</th>
          <th className="px-4 py-2">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sorted.map((f) => (
          <tr key={f.id}>
            <td className="px-4 py-3 align-top text-xs font-mono text-gray-500">
              {f.clause_ref ?? '—'}
            </td>
            <td className="px-4 py-3 align-top">
              <p className="text-sm text-gray-900">{f.requirement}</p>
              {f.recommendation && (
                <p className="mt-1 text-xs italic text-indigo-700">
                  → {f.recommendation}
                </p>
              )}
              {f.knowledge_asset_ref && (
                <p className="mt-1 text-[10px] text-gray-400">
                  Source: {f.knowledge_asset_ref}
                </p>
              )}
            </td>
            <td className="px-4 py-3 align-top">
              <SeverityBadge severity={f.severity} />
            </td>
            <td className="px-4 py-3 align-top">
              <select
                value={f.status}
                onChange={(e) => onUpdate(f.id, e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-xs"
              >
                <option value="OPEN">Open</option>
                <option value="ACKNOWLEDGED">Acknowledged</option>
                <option value="RESOLVED">Resolved</option>
                <option value="WAIVED">Waived</option>
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SeverityBadge({ severity }: { severity: ComplianceFindingSeverity }) {
  const map: Record<ComplianceFindingSeverity, string> = {
    CRITICAL: 'bg-red-100 text-red-700',
    HIGH: 'bg-amber-100 text-amber-700',
    MEDIUM: 'bg-yellow-100 text-yellow-700',
    LOW: 'bg-gray-100 text-gray-600',
    INFO: 'bg-blue-50 text-blue-600',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${map[severity]}`}>
      {severity}
    </span>
  );
}

function ObligationsByParty({
  obligations,
  onMarkMet,
}: {
  obligations: ContractObligation[];
  onMarkMet: (id: string) => void;
}) {
  const groups: [string, ContractObligation[]][] = (
    ['CONTRACTOR', 'EMPLOYER', 'ENGINEER', 'BOTH', 'OTHER'] as const
  ).map((p) => [
    p,
    obligations.filter((o) =>
      p === 'OTHER'
        ? !['CONTRACTOR', 'EMPLOYER', 'ENGINEER', 'BOTH'].includes(
            o.responsible_party ?? '',
          )
        : (o.responsible_party ?? '').toUpperCase() === p,
    ),
  ]);

  return (
    <div className="space-y-4">
      {groups
        .filter(([, items]) => items.length > 0)
        .map(([party, items]) => (
          <div key={party}>
            <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
              {party === 'OTHER' ? 'Other / unspecified' : party}
            </h3>
            <ul className="space-y-1">
              {items.map((o) => (
                <li
                  key={o.id}
                  className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                    o.status === 'OVERDUE'
                      ? 'border-red-200 bg-red-50'
                      : o.is_critical
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {o.is_critical && (
                        <span className="mr-1 text-red-600">⚠</span>
                      )}
                      {o.description}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {o.clause_ref ? `${o.clause_ref} · ` : ''}
                      {o.timeframe_description ?? o.duration ?? '—'}
                      {o.due_date
                        ? ` · Due ${format(new Date(o.due_date), 'PP')}`
                        : ''}
                    </p>
                  </div>
                  <ObligationStatusPill status={o.status} />
                  {o.status !== 'MET' && o.status !== 'COMPLETED' && (
                    <button
                      onClick={() => onMarkMet(o.id)}
                      className="text-xs font-semibold text-green-700 hover:text-green-800"
                    >
                      ✓ Mark met
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

function ObligationStatusPill({ status }: { status: ContractObligation['status'] }) {
  const map: Record<string, string> = {
    PENDING: 'bg-gray-100 text-gray-600',
    IN_PROGRESS: 'bg-blue-50 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
    MET: 'bg-green-100 text-green-700',
    OVERDUE: 'bg-red-100 text-red-700',
    WAIVED: 'bg-gray-100 text-gray-500',
  };
  const label = status === 'COMPLETED' ? 'MET' : status;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${map[status] ?? ''}`}>
      {label}
    </span>
  );
}

function ConfirmDialog({
  email,
  contractName,
  onConfirm,
  onCancel,
  isPending,
}: {
  email: string;
  contractName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">
          Email this report?
        </h3>
        <p className="mt-2 text-sm text-gray-600">
          This report for <strong>{contractName}</strong> will be sent to{' '}
          <strong>{email}</strong>. Reports are sent by email for confidentiality
          purposes — they cannot be downloaded directly from the browser.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {isPending ? 'Queueing…' : 'Confirm — Send to my email'}
          </button>
        </div>
      </div>
    </div>
  );
}

function severityRank(s: ComplianceFindingSeverity): number {
  return { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 }[s];
}
function layerLabel(l: ComplianceFindingLayer): string {
  return {
    STANDARD: 'Standard',
    JURISDICTION: 'Jurisdiction',
    PLAYBOOK: 'Playbook',
    CONFLICT: 'Conflict',
  }[l];
}
