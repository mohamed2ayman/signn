import { useEffect, useState } from 'react';
import { noticeService } from '@/services/api/noticeService';
import type { Notice } from '@/types';

const NOTICE_TYPE_GROUPS: { label: string; types: { value: string; label: string }[] }[] = [
  { label: 'Delay & Time', types: [
    { value: 'NOTICE_OF_DELAY', label: 'Notice of Delay' },
    { value: 'NOTICE_OF_EXTENSION_OF_TIME', label: 'Extension of Time' },
    { value: 'NOTICE_OF_COMPLETION', label: 'Completion' },
    { value: 'NOTICE_OF_PRACTICAL_COMPLETION', label: 'Practical Completion' },
    { value: 'NOTICE_OF_SECTIONAL_COMPLETION', label: 'Sectional Completion' },
  ]},
  { label: 'Variations & Changes', types: [
    { value: 'NOTICE_OF_VARIATION', label: 'Variation' },
    { value: 'NOTICE_OF_CHANGE_IN_CONDITIONS', label: 'Change in Conditions' },
    { value: 'NOTICE_OF_ACCELERATION', label: 'Acceleration' },
    { value: 'NOTICE_OF_SCOPE_CHANGE', label: 'Scope Change' },
  ]},
  { label: 'Quality & Defects', types: [
    { value: 'NOTICE_TO_CORRECT', label: 'Notice to Correct' },
    { value: 'NOTICE_OF_DEFECTS', label: 'Defects' },
    { value: 'NOTICE_OF_NON_CONFORMANCE', label: 'Non-Conformance' },
    { value: 'NOTICE_OF_REJECTION', label: 'Rejection' },
  ]},
  { label: 'Payment & Financial', types: [
    { value: 'NOTICE_OF_PAYMENT', label: 'Payment' },
    { value: 'PAY_LESS_NOTICE', label: 'Pay Less Notice' },
    { value: 'NOTICE_OF_WITHHOLDING', label: 'Withholding' },
    { value: 'NOTICE_OF_LOSS_AND_EXPENSE', label: 'Loss and Expense' },
    { value: 'NOTICE_OF_PRICE_ADJUSTMENT', label: 'Price Adjustment' },
  ]},
  { label: 'Claims & Disputes', types: [
    { value: 'INTENT_TO_CLAIM', label: 'Intent to Claim' },
    { value: 'NOTICE_OF_DISPUTE', label: 'Dispute' },
    { value: 'NOTICE_OF_ADJUDICATION', label: 'Adjudication' },
    { value: 'NOTICE_OF_ARBITRATION', label: 'Arbitration' },
  ]},
  { label: 'Early Warnings', types: [
    { value: 'EARLY_WARNING_NOTICE', label: 'Early Warning' },
    { value: 'RISK_REDUCTION_NOTICE', label: 'Risk Reduction' },
  ]},
  { label: 'Suspension & Termination', types: [
    { value: 'NOTICE_OF_SUSPENSION', label: 'Suspension' },
    { value: 'NOTICE_OF_TERMINATION', label: 'Termination' },
    { value: 'NOTICE_OF_TERMINATION_FOR_CONVENIENCE', label: 'Termination for Convenience' },
    { value: 'NOTICE_OF_TERMINATION_FOR_CAUSE', label: 'Termination for Cause' },
    { value: 'NOTICE_TO_SHOW_CAUSE', label: 'Show Cause' },
  ]},
  { label: 'Force Majeure & Exceptional Events', types: [
    { value: 'NOTICE_OF_FORCE_MAJEURE', label: 'Force Majeure' },
    { value: 'NOTICE_OF_EXCEPTIONAL_EVENT', label: 'Exceptional Event' },
  ]},
  { label: 'Insurance & Indemnity', types: [
    { value: 'NOTICE_OF_INSURANCE_CLAIM', label: 'Insurance Claim' },
    { value: 'NOTICE_OF_INDEMNITY_CLAIM', label: 'Indemnity Claim' },
  ]},
  { label: 'Access & Site', types: [
    { value: 'NOTICE_OF_ACCESS', label: 'Access' },
    { value: 'NOTICE_OF_POSSESSION', label: 'Possession' },
    { value: 'NOTICE_OF_OBSTRUCTION', label: 'Obstruction' },
  ]},
  { label: 'General', types: [
    { value: 'GENERAL_NOTICE', label: 'General Notice' },
  ]},
];

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: 'bg-gray-100', text: 'text-gray-700' },
  SUBMITTED: { bg: 'bg-blue-100', text: 'text-blue-700' },
  DELIVERED: { bg: 'bg-sky-100', text: 'text-sky-700' },
  ACKNOWLEDGED: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  RESPONDED: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  OVERDUE: { bg: 'bg-red-100', text: 'text-red-700' },
  CLOSED: { bg: 'bg-gray-200', text: 'text-gray-600' },
  WITHDRAWN: { bg: 'bg-gray-100', text: 'text-gray-500' },
};

function getNoticeTypeLabel(type: string): string {
  for (const g of NOTICE_TYPE_GROUPS) {
    for (const t of g.types) {
      if (t.value === type) return t.label;
    }
  }
  return type.replace(/_/g, ' ');
}

function isOverdue(notice: Notice): boolean {
  if (!notice.response_required || !notice.response_deadline) return false;
  if (['RESPONDED', 'CLOSED', 'WITHDRAWN', 'OVERDUE'].includes(notice.status)) return false;
  return new Date(notice.response_deadline) < new Date();
}

function daysUntilDeadline(deadline: string): number {
  const diff = new Date(deadline).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

interface Props {
  contractId: string;
}

export default function NoticesTab({ contractId }: Props) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState<Notice | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    notice_type: 'GENERAL_NOTICE',
    event_date: '',
    response_required: false,
    response_deadline: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadNotices(); }, [contractId]);

  const loadNotices = async () => {
    try {
      const data = await noticeService.getByContract(contractId);
      setNotices(data);
    } catch { setNotices([]); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await noticeService.create({
        contract_id: contractId,
        title: form.title,
        description: form.description,
        notice_type: form.notice_type,
        event_date: form.event_date,
        response_required: form.response_required,
        response_deadline: form.response_required ? form.response_deadline || undefined : undefined,
      });
      setShowForm(false);
      setForm({ title: '', description: '', notice_type: 'GENERAL_NOTICE', event_date: '', response_required: false, response_deadline: '' });
      loadNotices();
    } catch {}
    finally { setSubmitting(false); }
  };

  const handleViewDetail = async (id: string) => {
    try {
      const detail = await noticeService.getById(id);
      setSelectedNotice(detail);
    } catch {}
  };

  const handleWithdraw = async (id: string) => {
    try {
      await noticeService.withdraw(id);
      setSelectedNotice(null);
      loadNotices();
    } catch {}
  };

  const handleAcknowledge = async (id: string) => {
    try {
      await noticeService.acknowledge(id);
      handleViewDetail(id);
      loadNotices();
    } catch {}
  };

  if (loading) return <div className="py-10 text-center text-gray-400">Loading notices…</div>;

  // Detail view
  if (selectedNotice) {
    const n = selectedNotice;
    const overdue = isOverdue(n) || n.status === 'OVERDUE';
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedNotice(null)} className="text-sm text-blue-600 hover:underline">← Back to notices</button>
        {overdue && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
            Response deadline has passed — this notice is overdue
          </div>
        )}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-500">{n.notice_reference}</span>
                <StatusBadge status={n.status} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mt-1">{n.title}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{getNoticeTypeLabel(n.notice_type)}</p>
            </div>
            <div className="flex gap-2">
              {n.status === 'SUBMITTED' && (
                <button onClick={() => handleAcknowledge(n.id)} className="px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700">Acknowledge</button>
              )}
              {!['CLOSED', 'WITHDRAWN'].includes(n.status) && (
                <button onClick={() => handleWithdraw(n.id)} className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50">Withdraw</button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-500">Event Date:</span> <span className="font-medium">{n.event_date}</span></div>
            <div><span className="text-gray-500">Response Required:</span> <span className="font-medium">{n.response_required ? 'Yes' : 'No'}</span></div>
            {n.response_deadline && <div><span className="text-gray-500">Deadline:</span> <span className={`font-medium ${overdue ? 'text-red-600' : ''}`}>{n.response_deadline}</span></div>}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-1">Description</h4>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{n.description}</p>
          </div>

          {n.documents && n.documents.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Documents</h4>
              <div className="space-y-1">
                {n.documents.map(d => (
                  <div key={d.id} className="flex items-center gap-2 text-sm text-blue-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                    <span>{d.file_name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {n.responses && n.responses.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Responses</h4>
              <div className="space-y-3">
                {n.responses.map(r => (
                  <div key={r.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                      <span className="font-medium text-gray-700">{r.responder?.first_name} {r.responder?.last_name}</span>
                      <span>·</span>
                      <span>{r.response_type.replace(/_/g, ' ')}</span>
                      <span>·</span>
                      <span>{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-sm text-gray-700">{r.response_content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {n.status_logs && n.status_logs.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Timeline</h4>
              <div className="space-y-2">
                {n.status_logs.map(log => (
                  <div key={log.id} className="flex items-center gap-3 text-xs text-gray-600">
                    <span className="text-gray-400 w-32">{new Date(log.changed_at).toLocaleString()}</span>
                    <span>{log.previous_status} → {log.new_status}</span>
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
        <h3 className="text-sm font-semibold text-gray-700">Notices ({notices.length})</h3>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Submit New Notice
        </button>
      </div>

      {notices.length === 0 && !showForm && (
        <div className="py-10 text-center">
          <svg className="mx-auto h-10 w-10 text-gray-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <p className="mt-3 text-sm text-gray-500">No notices submitted yet</p>
        </div>
      )}

      <div className="space-y-2">
        {notices.map(notice => {
          const overdue = isOverdue(notice) || notice.status === 'OVERDUE';
          const days = notice.response_deadline ? daysUntilDeadline(notice.response_deadline) : null;
          return (
            <button
              key={notice.id}
              onClick={() => handleViewDetail(notice.id)}
              className={`w-full text-left rounded-lg border p-4 transition hover:border-blue-200 hover:bg-blue-50/30 ${notice.status === 'WITHDRAWN' ? 'opacity-60' : ''} ${overdue ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-white'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-mono text-gray-400">{notice.notice_reference}</span>
                    <StatusBadge status={notice.status} />
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{getNoticeTypeLabel(notice.notice_type)}</span>
                    {overdue && <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">OVERDUE</span>}
                  </div>
                  <h4 className="text-sm font-semibold text-gray-900 truncate">{notice.title}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">Event: {notice.event_date}</p>
                </div>
                <div className="text-right shrink-0">
                  {notice.response_deadline && (
                    <div className={`text-xs ${overdue ? 'text-red-600 font-semibold' : days != null && days <= 3 ? 'text-amber-600' : 'text-gray-500'}`}>
                      {overdue ? 'Overdue' : days != null ? `${days}d left` : ''}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl border border-gray-200">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Submit New Notice</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notice Type</label>
                <select value={form.notice_type} onChange={e => setForm(f => ({ ...f, notice_type: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  {NOTICE_TYPE_GROUPS.map(g => (
                    <optgroup key={g.label} label={g.label}>
                      {g.types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </optgroup>
                  ))}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Event Date</label>
                <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.response_required} onChange={e => setForm(f => ({ ...f, response_required: e.target.checked }))} className="rounded" />
                  Response Required
                </label>
              </div>
              {form.response_required && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Response Deadline</label>
                  <input type="date" value={form.response_deadline} onChange={e => setForm(f => ({ ...f, response_deadline: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit Notice'}</button>
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
