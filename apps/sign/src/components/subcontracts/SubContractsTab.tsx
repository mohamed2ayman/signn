import { useEffect, useState } from 'react';
import { subContractService } from '@/services/api/subContractService';
import type { SubContract } from '@/types';

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: 'bg-gray-100', text: 'text-gray-700' },
  PENDING_APPROVAL: { bg: 'bg-amber-100', text: 'text-amber-700' },
  APPROVED: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  ACTIVE: { bg: 'bg-blue-100', text: 'text-blue-700' },
  COMPLETED: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  TERMINATED: { bg: 'bg-red-100', text: 'text-red-700' },
  CHANGES_REQUESTED: { bg: 'bg-orange-100', text: 'text-orange-700' },
  SENT_TO_CONTRACTOR: { bg: 'bg-purple-100', text: 'text-purple-700' },
  CONTRACTOR_REVIEWING: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  PENDING_FINAL_APPROVAL: { bg: 'bg-amber-100', text: 'text-amber-700' },
  PENDING_TENDERING: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
};

interface Props {
  contractId: string;
  contractName: string;
}

export default function SubContractsTab({ contractId, contractName }: Props) {
  const [subcontracts, setSubcontracts] = useState<SubContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedSub, setSelectedSub] = useState<SubContract | null>(null);
  const [shareResult, setShareResult] = useState<{ shareUrl: string; token: string } | null>(null);
  const [form, setForm] = useState({
    title: '',
    scope_description: '',
    subcontractor_name: '',
    subcontractor_email: '',
    subcontractor_company: '',
    subcontractor_contact_phone: '',
    contract_value: '',
    start_date: '',
    end_date: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadSubcontracts(); }, [contractId]);

  const loadSubcontracts = async () => {
    try {
      const data = await subContractService.getByMainContract(contractId);
      setSubcontracts(data);
    } catch { setSubcontracts([]); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await subContractService.create({
        main_contract_id: contractId,
        title: form.title,
        scope_description: form.scope_description,
        subcontractor_name: form.subcontractor_name,
        subcontractor_email: form.subcontractor_email,
        subcontractor_company: form.subcontractor_company || undefined,
        subcontractor_contact_phone: form.subcontractor_contact_phone || undefined,
        contract_value: form.contract_value ? parseFloat(form.contract_value) : undefined,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
      });
      setShowForm(false);
      setForm({ title: '', scope_description: '', subcontractor_name: '', subcontractor_email: '', subcontractor_company: '', subcontractor_contact_phone: '', contract_value: '', start_date: '', end_date: '' });
      loadSubcontracts();
    } catch {}
    finally { setSubmitting(false); }
  };

  const handleViewDetail = async (id: string) => {
    try {
      const detail = await subContractService.getById(id);
      setSelectedSub(detail);
      setShareResult(null);
    } catch {}
  };

  const handleShare = async (id: string) => {
    try {
      const result = await subContractService.share(id);
      setShareResult(result);
    } catch {}
  };

  if (loading) return <div className="py-10 text-center text-gray-400">Loading sub-contracts…</div>;

  // Detail view
  if (selectedSub) {
    const s = selectedSub;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <button onClick={() => setSelectedSub(null)} className="text-blue-600 hover:underline">← Back</button>
          <span>·</span>
          <span>Main Contract → {contractName} → Sub-Contracts → {s.title}</span>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-500">{s.subcontract_number}</span>
                <StatusBadge status={s.status} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mt-1">{s.title}</h3>
            </div>
            <button onClick={() => handleShare(s.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
              Share
            </button>
          </div>

          {shareResult && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm">
              <p className="text-emerald-700 font-medium">Share link generated:</p>
              <code className="text-xs text-emerald-600 break-all">{shareResult.shareUrl}</code>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><span className="text-gray-500">Subcontractor:</span> <span className="font-medium">{s.subcontractor_name}</span></div>
            <div><span className="text-gray-500">Email:</span> <span className="font-medium">{s.subcontractor_email}</span></div>
            {s.subcontractor_company && <div><span className="text-gray-500">Company:</span> <span className="font-medium">{s.subcontractor_company}</span></div>}
            {s.subcontractor_contact_phone && <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{s.subcontractor_contact_phone}</span></div>}
            {s.contract_value != null && <div><span className="text-gray-500">Value:</span> <span className="font-medium">${Number(s.contract_value).toLocaleString()}</span></div>}
            {s.start_date && <div><span className="text-gray-500">Start:</span> <span className="font-medium">{s.start_date}</span></div>}
            {s.end_date && <div><span className="text-gray-500">End:</span> <span className="font-medium">{s.end_date}</span></div>}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-1">Scope Description</h4>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{s.scope_description}</p>
          </div>

          {s.status_logs && s.status_logs.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Timeline</h4>
              <div className="space-y-2">
                {s.status_logs.map(log => (
                  <div key={log.id} className="flex items-center gap-3 text-xs text-gray-600">
                    <span className="text-gray-400 w-32">{new Date(log.changed_at).toLocaleString()}</span>
                    <span>{log.previous_status || '—'} → {log.new_status}</span>
                    {log.note && <span className="text-gray-400">— {log.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Sub-Contracts ({subcontracts.length})</h3>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Create Sub-Contract
        </button>
      </div>

      {subcontracts.length === 0 && !showForm && (
        <div className="py-10 text-center">
          <svg className="mx-auto h-10 w-10 text-gray-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="mt-3 text-sm text-gray-500">No sub-contracts created yet</p>
        </div>
      )}

      <div className="space-y-2">
        {subcontracts.map(sub => (
          <button
            key={sub.id}
            onClick={() => handleViewDetail(sub.id)}
            className="w-full text-left rounded-lg border border-gray-200 bg-white p-4 transition hover:border-blue-200 hover:bg-blue-50/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-gray-400">{sub.subcontract_number}</span>
                  <StatusBadge status={sub.status} />
                </div>
                <h4 className="text-sm font-semibold text-gray-900 truncate">{sub.title}</h4>
                <p className="text-xs text-gray-500 mt-0.5">{sub.subcontractor_name}{sub.subcontractor_company ? ` · ${sub.subcontractor_company}` : ''}</p>
              </div>
              <div className="text-right shrink-0">
                {sub.contract_value != null && (
                  <div className="text-sm font-semibold text-gray-900">${Number(sub.contract_value).toLocaleString()}</div>
                )}
                {sub.start_date && sub.end_date && (
                  <div className="text-xs text-gray-500">{sub.start_date} – {sub.end_date}</div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl border border-gray-200">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Create Sub-Contract</h2>
                <p className="text-xs text-gray-500 mt-0.5">New Sub-Contract under: {contractName}</p>
              </div>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Scope Description</label>
                <textarea value={form.scope_description} onChange={e => setForm(f => ({ ...f, scope_description: e.target.value }))} required rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subcontractor Name</label>
                  <input value={form.subcontractor_name} onChange={e => setForm(f => ({ ...f, subcontractor_name: e.target.value }))} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subcontractor Email</label>
                  <input type="email" value={form.subcontractor_email} onChange={e => setForm(f => ({ ...f, subcontractor_email: e.target.value }))} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                  <input value={form.subcontractor_company} onChange={e => setForm(f => ({ ...f, subcontractor_company: e.target.value }))} placeholder="Optional" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input value={form.subcontractor_contact_phone} onChange={e => setForm(f => ({ ...f, subcontractor_contact_phone: e.target.value }))} placeholder="Optional" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contract Value</label>
                <input type="number" step="0.01" value={form.contract_value} onChange={e => setForm(f => ({ ...f, contract_value: e.target.value }))} placeholder="Optional" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{submitting ? 'Creating…' : 'Create Sub-Contract'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.DRAFT;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.bg} ${s.text}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
