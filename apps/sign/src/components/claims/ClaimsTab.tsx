import { useEffect, useState } from 'react';
import { claimService } from '@/services/api/claimService';
import type { Claim } from '@/types';

const CLAIM_TYPE_LABELS: Record<string, string> = {
  COST: 'Cost',
  TIME_EXTENSION: 'Time Extension',
  VARIATION: 'Variation',
  DISRUPTION: 'Disruption',
  GENERAL_DISPUTE: 'General Dispute',
};

const RESPONSE_TYPE_LABELS: Record<string, string> = {
  ACCEPTED: 'Accepted',
  PARTIAL_ACCEPTANCE: 'Partial Acceptance',
  COUNTER_OFFER: 'Counter Offer',
  REJECTED: 'Rejected',
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: 'bg-gray-100', text: 'text-gray-700' },
  SUBMITTED: { bg: 'bg-blue-100', text: 'text-blue-700' },
  ACKNOWLEDGED: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  UNDER_ASSESSMENT: { bg: 'bg-amber-100', text: 'text-amber-700' },
  RESPONDED: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  UNDER_NEGOTIATION: { bg: 'bg-purple-100', text: 'text-purple-700' },
  SETTLED: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  REJECTED: { bg: 'bg-red-100', text: 'text-red-700' },
  ESCALATED: { bg: 'bg-orange-100', text: 'text-orange-700' },
};

interface Props {
  contractId: string;
}

export default function ClaimsTab({ contractId }: Props) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [showResponseForm, setShowResponseForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    claim_type: 'COST' as string,
    event_date: '',
    claimed_amount: '',
    claimed_time_extension_days: '',
  });
  const [responseForm, setResponseForm] = useState({
    response_type: 'ACCEPTED' as string,
    response_content: '',
    counter_amount: '',
    counter_time_days: '',
    justification: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadClaims();
  }, [contractId]);

  const loadClaims = async () => {
    try {
      const data = await claimService.getByContract(contractId);
      setClaims(data);
    } catch { setClaims([]); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await claimService.create({
        contract_id: contractId,
        title: form.title,
        description: form.description,
        claim_type: form.claim_type,
        event_date: form.event_date,
        claimed_amount: form.claimed_amount ? parseFloat(form.claimed_amount) : undefined,
        claimed_time_extension_days: form.claimed_time_extension_days ? parseInt(form.claimed_time_extension_days) : undefined,
      });
      setShowForm(false);
      setForm({ title: '', description: '', claim_type: 'COST', event_date: '', claimed_amount: '', claimed_time_extension_days: '' });
      loadClaims();
    } catch {}
    finally { setSubmitting(false); }
  };

  const handleViewDetail = async (id: string) => {
    try {
      const detail = await claimService.getById(id);
      setSelectedClaim(detail);
      setShowResponseForm(false);
    } catch {}
  };

  const handleAcknowledge = async (id: string) => {
    try {
      await claimService.acknowledge(id);
      handleViewDetail(id);
      loadClaims();
    } catch {}
  };

  const handleRespond = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClaim) return;
    setSubmitting(true);
    try {
      await claimService.respond(selectedClaim.id, {
        response_type: responseForm.response_type,
        response_content: responseForm.response_content,
        counter_amount: responseForm.counter_amount ? parseFloat(responseForm.counter_amount) : undefined,
        counter_time_days: responseForm.counter_time_days ? parseInt(responseForm.counter_time_days) : undefined,
        justification: responseForm.justification || undefined,
      });
      setShowResponseForm(false);
      setResponseForm({ response_type: 'ACCEPTED', response_content: '', counter_amount: '', counter_time_days: '', justification: '' });
      handleViewDetail(selectedClaim.id);
      loadClaims();
    } catch {}
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="py-10 text-center text-gray-400">Loading claims...</div>;

  // Detail view
  if (selectedClaim) {
    const c = selectedClaim;
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedClaim(null)} className="text-sm text-blue-600 hover:underline">&larr; Back to claims</button>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-500">{c.claim_reference}</span>
                <StatusBadge status={c.status} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mt-1">{c.title}</h3>
            </div>
            <div className="flex gap-2">
              {c.status === 'SUBMITTED' && (
                <button onClick={() => handleAcknowledge(c.id)} className="px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700">Acknowledge</button>
              )}
              {!['SETTLED', 'REJECTED'].includes(c.status) && (
                <button onClick={() => setShowResponseForm(true)} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700">Respond</button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-500">Type:</span> <span className="font-medium">{CLAIM_TYPE_LABELS[c.claim_type] || c.claim_type}</span></div>
            <div><span className="text-gray-500">Event Date:</span> <span className="font-medium">{c.event_date}</span></div>
            {c.claimed_amount != null && <div><span className="text-gray-500">Amount:</span> <span className="font-medium">${Number(c.claimed_amount).toLocaleString()}</span></div>}
            {c.claimed_time_extension_days != null && <div><span className="text-gray-500">Days:</span> <span className="font-medium">{c.claimed_time_extension_days} days</span></div>}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-1">Description</h4>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{c.description}</p>
          </div>

          {/* Documents */}
          {c.documents && c.documents.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Documents</h4>
              <div className="space-y-1">
                {c.documents.map(d => (
                  <div key={d.id} className="flex items-center gap-2 text-sm text-blue-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                    <span>{d.file_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Response form */}
          {showResponseForm && (
            <div className="border border-blue-200 rounded-lg p-4 bg-blue-50/50">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Submit Response</h4>
              <form onSubmit={handleRespond} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Response Type</label>
                  <select value={responseForm.response_type} onChange={e => setResponseForm(f => ({ ...f, response_type: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    {Object.entries(RESPONSE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Response Content</label>
                  <textarea value={responseForm.response_content} onChange={e => setResponseForm(f => ({ ...f, response_content: e.target.value }))} required rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                {(responseForm.response_type === 'COUNTER_OFFER' || responseForm.response_type === 'PARTIAL_ACCEPTANCE') && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Counter Amount</label>
                      <input type="number" step="0.01" value={responseForm.counter_amount} onChange={e => setResponseForm(f => ({ ...f, counter_amount: e.target.value }))} placeholder="Optional" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Counter Days</label>
                      <input type="number" value={responseForm.counter_time_days} onChange={e => setResponseForm(f => ({ ...f, counter_time_days: e.target.value }))} placeholder="Optional" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Justification</label>
                  <textarea value={responseForm.justification} onChange={e => setResponseForm(f => ({ ...f, justification: e.target.value }))} rows={2} placeholder="Optional" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowResponseForm(false)} className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={submitting} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{submitting ? 'Submitting...' : 'Submit Response'}</button>
                </div>
              </form>
            </div>
          )}

          {/* Responses */}
          {c.responses && c.responses.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Responses</h4>
              <div className="space-y-3">
                {c.responses.map(r => (
                  <div key={r.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                      <span className="font-medium text-gray-700">{r.responder?.first_name} {r.responder?.last_name}</span>
                      <span>&middot;</span>
                      <span>{RESPONSE_TYPE_LABELS[r.response_type] || r.response_type.replace(/_/g, ' ')}</span>
                      <span>&middot;</span>
                      <span>{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-sm text-gray-700">{r.response_content}</p>
                    {r.counter_amount != null && <p className="text-xs text-gray-500 mt-1">Counter: ${Number(r.counter_amount).toLocaleString()}</p>}
                    {r.counter_time_days != null && <p className="text-xs text-gray-500">Counter Days: {r.counter_time_days}</p>}
                    {r.justification && <p className="text-xs text-gray-500 mt-1">Justification: {r.justification}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status timeline */}
          {c.status_logs && c.status_logs.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Timeline</h4>
              <div className="space-y-2">
                {c.status_logs.map(log => (
                  <div key={log.id} className="flex items-center gap-3 text-xs text-gray-600">
                    <span className="text-gray-400 w-32">{new Date(log.changed_at).toLocaleString()}</span>
                    <span>{log.previous_status} &rarr; {log.new_status}</span>
                    {log.note && <span className="text-gray-400">&mdash; {log.note}</span>}
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
        <h3 className="text-sm font-semibold text-gray-700">Claims ({claims.length})</h3>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Submit New Claim
        </button>
      </div>

      {/* Claims list */}
      {claims.length === 0 && !showForm && (
        <div className="py-10 text-center">
          <svg className="mx-auto h-10 w-10 text-gray-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="mt-3 text-sm text-gray-500">No claims submitted yet</p>
        </div>
      )}

      <div className="space-y-2">
        {claims.map(claim => (
          <button
            key={claim.id}
            onClick={() => handleViewDetail(claim.id)}
            className="w-full text-left rounded-lg border p-4 transition hover:border-blue-200 hover:bg-blue-50/30 border-gray-200 bg-white"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-gray-400">{claim.claim_reference}</span>
                  <StatusBadge status={claim.status} />
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{CLAIM_TYPE_LABELS[claim.claim_type] || claim.claim_type}</span>
                </div>
                <h4 className="text-sm font-semibold text-gray-900 truncate">{claim.title}</h4>
                <p className="text-xs text-gray-500 mt-0.5">Event: {claim.event_date}</p>
              </div>
              <div className="text-right shrink-0">
                {claim.claimed_amount != null && (
                  <div className="text-sm font-semibold text-gray-900">${Number(claim.claimed_amount).toLocaleString()}</div>
                )}
                {claim.claimed_time_extension_days != null && (
                  <div className="text-xs text-gray-500">{claim.claimed_time_extension_days} days</div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Submit New Claim</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Claim Type</label>
                <select value={form.claim_type} onChange={e => setForm(f => ({ ...f, claim_type: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {Object.entries(CLAIM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Event Date</label>
                  <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Claimed Amount</label>
                  <input type="number" step="0.01" value={form.claimed_amount} onChange={e => setForm(f => ({ ...f, claimed_amount: e.target.value }))} placeholder="Optional" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Time Extension (days)</label>
                <input type="number" value={form.claimed_time_extension_days} onChange={e => setForm(f => ({ ...f, claimed_time_extension_days: e.target.value }))} placeholder="Optional" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{submitting ? 'Submitting...' : 'Submit Claim'}</button>
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
