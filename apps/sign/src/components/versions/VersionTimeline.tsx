import { useEffect, useMemo, useState } from 'react';
import { ContractVersion, ContractVersionEventType } from '@/types';
import { contractService } from '@/services/api/contractService';
import {
  FilePlus,
  Edit3,
  ShieldCheck,
  Send,
  CheckCircle2,
  AlertTriangle,
  Share2,
  Inbox,
  ClipboardCheck,
  Undo2,
  ArrowRight,
  Award,
  Flag,
  RefreshCw,
  ShieldAlert,
  Stamp,
  PlusSquare,
  History,
} from 'lucide-react';

interface Props {
  contractId: string;
  onCompare: (versionAId: string, versionBId: string) => void;
  onViewSnapshot: (version: ContractVersion) => void;
}

const EVENT_META: Record<
  ContractVersionEventType,
  { icon: typeof FilePlus; color: string; label: string }
> = {
  [ContractVersionEventType.CREATED]: { icon: FilePlus, color: 'bg-blue-500', label: 'Created' },
  [ContractVersionEventType.EDITED]: { icon: Edit3, color: 'bg-slate-500', label: 'Edited' },
  [ContractVersionEventType.RISK_ANALYZED]: { icon: ShieldCheck, color: 'bg-purple-500', label: 'Risk Analyzed' },
  [ContractVersionEventType.SUBMITTED_FOR_APPROVAL]: { icon: Send, color: 'bg-amber-500', label: 'Submitted for Approval' },
  [ContractVersionEventType.APPROVED]: { icon: CheckCircle2, color: 'bg-emerald-500', label: 'Approved' },
  [ContractVersionEventType.CHANGES_REQUESTED]: { icon: AlertTriangle, color: 'bg-orange-500', label: 'Changes Requested' },
  [ContractVersionEventType.SHARED_WITH_COUNTERPARTY]: { icon: Share2, color: 'bg-indigo-500', label: 'Shared' },
  [ContractVersionEventType.COUNTERPARTY_RESPONSE_RECEIVED]: { icon: Inbox, color: 'bg-cyan-600', label: 'Response Received' },
  [ContractVersionEventType.SUBMITTED_FOR_REVIEW]: { icon: ClipboardCheck, color: 'bg-amber-600', label: 'Submitted for Review' },
  [ContractVersionEventType.REVIEWED_AND_RETURNED]: { icon: Undo2, color: 'bg-sky-500', label: 'Reviewed & Returned' },
  [ContractVersionEventType.SUBMITTED_TO_COUNTERPARTY]: { icon: ArrowRight, color: 'bg-indigo-600', label: 'Submitted to Counterparty' },
  [ContractVersionEventType.CERTIFIED_BY_COUNTERPARTY]: { icon: Award, color: 'bg-emerald-600', label: 'Certified' },
  [ContractVersionEventType.FORWARDED_TO_COUNTERPARTY]: { icon: Flag, color: 'bg-teal-600', label: 'Forwarded' },
  [ContractVersionEventType.NEGOTIATION_ROUND]: { icon: RefreshCw, color: 'bg-violet-500', label: 'Negotiation Round' },
  [ContractVersionEventType.ESCALATED]: { icon: ShieldAlert, color: 'bg-red-500', label: 'Escalated' },
  [ContractVersionEventType.EXECUTED]: { icon: Stamp, color: 'bg-emerald-700', label: 'Executed' },
  [ContractVersionEventType.AMENDMENT_ADDED]: { icon: PlusSquare, color: 'bg-blue-600', label: 'Amendment' },
};

export function VersionTimeline({ contractId, onCompare, onViewSnapshot }: Props) {
  const [versions, setVersions] = useState<ContractVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [milestonesOnly, setMilestonesOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    contractService
      .getVersions(contractId)
      .then((data) => {
        if (mounted) setVersions(data);
      })
      .catch(() => mounted && setVersions([]))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [contractId]);

  const visible = useMemo(
    () => (milestonesOnly ? versions.filter((v) => v.is_milestone) : versions),
    [versions, milestonesOnly],
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const canCompare = selected.length === 2;

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading version history…</div>;
  }

  if (!versions.length) {
    return (
      <div className="p-8 text-center text-slate-500">
        <History className="w-12 h-12 mx-auto mb-3 text-slate-300" />
        No version history yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-4 sticky top-0 bg-white z-10 py-2 border-b border-slate-200">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={milestonesOnly}
            onChange={(e) => setMilestonesOnly(e.target.checked)}
            className="rounded"
          />
          Show milestones only
        </label>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {selected.length}/2 selected for comparison
          </span>
          <button
            disabled={!canCompare}
            onClick={() => canCompare && onCompare(selected[0], selected[1])}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white disabled:bg-slate-300 hover:bg-blue-700"
          >
            Compare Selected
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative pl-10">
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />
        <div className="space-y-6">
          {visible.map((v) => {
            const meta =
              (v.event_type && EVENT_META[v.event_type]) ||
              EVENT_META[ContractVersionEventType.EDITED];
            const Icon = meta.icon;
            const isSelected = selected.includes(v.id);
            return (
              <div key={v.id} className="relative">
                <div
                  className={`absolute -left-10 top-1 w-8 h-8 rounded-full flex items-center justify-center text-white shadow ${meta.color}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div
                  className={`bg-white border rounded-lg p-4 transition ${
                    isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">
                          {v.version_label || `V${v.version_number}`}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {meta.label}
                        </span>
                        {v.is_milestone && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            Milestone
                          </span>
                        )}
                        {v.contract_status_at_version && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                            {v.contract_status_at_version}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-700 mt-1">
                        {v.event_description || v.change_summary || '—'}
                      </p>
                      <div className="text-xs text-slate-500 mt-2 flex items-center gap-3 flex-wrap">
                        <span>{new Date(v.created_at).toLocaleString()}</span>
                        {v.triggered_by_role && <span>by {v.triggered_by_role}</span>}
                        {v.counterparty_role && (
                          <span className="inline-flex items-center gap-1">
                            <ArrowRight className="w-3 h-3" />
                            {v.counterparty_role}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 items-end">
                      <label className="inline-flex items-center gap-1 text-xs text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(v.id)}
                        />
                        Compare
                      </label>
                      <button
                        onClick={() => onViewSnapshot(v)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        View this version
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default VersionTimeline;
