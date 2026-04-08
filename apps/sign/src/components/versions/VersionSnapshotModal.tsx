import { X, History } from 'lucide-react';
import { ContractVersion } from '@/types';

interface Props {
  version: ContractVersion;
  onClose: () => void;
}

export function VersionSnapshotModal({ version, onClose }: Props) {
  const snapshot = version.snapshot as any;
  const clauses: any[] = Array.isArray(snapshot?.clauses) ? snapshot.clauses : [];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Snapshot: {version.version_label || `V${version.version_number}`}
            </h2>
            <p className="text-sm text-slate-500">
              {new Date(version.created_at).toLocaleString()}
              {version.triggered_by_role && ` · ${version.triggered_by_role}`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-slate-100 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-sm text-amber-800">
          <History className="w-4 h-4" />
          You are viewing a historical, read-only snapshot of this contract.
        </div>

        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          <div className="text-sm text-slate-600">
            <div>
              <strong>Name:</strong> {snapshot?.name}
            </div>
            <div>
              <strong>Status at this version:</strong>{' '}
              {version.contract_status_at_version || snapshot?.status}
            </div>
            {version.event_description && (
              <div>
                <strong>Event:</strong> {version.event_description}
              </div>
            )}
          </div>

          <div className="space-y-3">
            {clauses.length === 0 && (
              <div className="text-center text-slate-400 py-6">No clauses in this snapshot.</div>
            )}
            {clauses.map((c, i) => (
              <div key={i} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                <div className="flex items-center gap-2 mb-2">
                  {c.section_number && (
                    <span className="text-xs text-slate-500">§ {c.section_number}</span>
                  )}
                  <span className="font-semibold text-slate-900">{c.clause_title}</span>
                </div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap">{c.clause_content}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default VersionSnapshotModal;
