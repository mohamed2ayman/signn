import { useState, useEffect } from 'react';
import { supportService } from '@/services/api/supportService';
import type { SupportTicket, SupportTicketReply } from '@/types';

const CATEGORIES = [
  { value: 'billing', label: 'Billing' },
  { value: 'technical', label: 'Technical' },
  { value: 'account', label: 'Account' },
  { value: 'feature_request', label: 'Feature Request' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'text-green-600 bg-green-50' },
  { value: 'medium', label: 'Medium', color: 'text-amber-600 bg-amber-50' },
  { value: 'high', label: 'High', color: 'text-red-600 bg-red-50' },
];

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'text-blue-600 bg-blue-50',
  IN_PROGRESS: 'text-amber-600 bg-amber-50',
  WAITING_ON_USER: 'text-purple-600 bg-purple-50',
  RESOLVED: 'text-green-600 bg-green-50',
  CLOSED: 'text-gray-500 bg-gray-100',
};

export default function SupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<(SupportTicket & { replies?: SupportTicketReply[] }) | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ category: 'technical', priority: 'medium', subject: '', description: '' });

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    try {
      const data = await supportService.getMyTickets();
      setTickets(data);
    } catch { /* */ }
    setLoading(false);
  };

  const openTicket = async (ticket: SupportTicket) => {
    try {
      const data = await supportService.getTicketById(ticket.id);
      setSelectedTicket(data);
    } catch { /* */ }
  };

  const handleCreate = async () => {
    if (!form.subject.trim() || !form.description.trim()) return;
    setCreating(true);
    try {
      await supportService.createTicket(form);
      setShowCreateModal(false);
      setForm({ category: 'technical', priority: 'medium', subject: '', description: '' });
      await loadTickets();
    } catch { /* */ }
    setCreating(false);
  };

  const handleReply = async () => {
    if (!replyText.trim() || !selectedTicket) return;
    try {
      await supportService.addReply(selectedTicket.id, replyText);
      setReplyText('');
      openTicket(selectedTicket);
    } catch { /* */ }
  };

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // ── Detail View ──
  if (selectedTicket) {
    return (
      <div className="space-y-6">
        <button onClick={() => setSelectedTicket(null)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-navy-900 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          Back to tickets
        </button>

        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-card p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-navy-900">{selectedTicket.subject}</h2>
              <p className="text-sm text-gray-500 mt-1">#{selectedTicket.id.slice(0, 8).toUpperCase()} · {getTimeAgo(selectedTicket.created_at)}</p>
            </div>
            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${STATUS_COLORS[selectedTicket.status] || 'text-gray-500 bg-gray-100'}`}>
              {selectedTicket.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">{selectedTicket.description}</p>
        </div>

        {/* Replies */}
        <div className="space-y-3">
          {(selectedTicket.replies || []).filter(r => !r.is_internal_note).map((reply) => (
            <div key={reply.id} className="bg-white rounded-xl border border-gray-200/60 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  {(reply.user?.first_name || 'S')[0]}
                </div>
                <span className="text-sm font-medium text-navy-900">{reply.user ? `${reply.user.first_name} ${reply.user.last_name}` : 'Support'}</span>
                <span className="text-xs text-gray-400">{getTimeAgo(reply.created_at)}</span>
              </div>
              <p className="text-sm text-gray-600 pl-9">{reply.content}</p>
            </div>
          ))}
        </div>

        {/* Reply composer */}
        {selectedTicket.status !== 'CLOSED' && (
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-card p-4">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write a reply..."
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            />
            <div className="flex justify-end mt-3">
              <button onClick={handleReply} disabled={!replyText.trim()} className="px-5 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-600 disabled:opacity-40 transition-colors">
                Send Reply
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Ticket List ──
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Support</h1>
          <p className="text-sm text-gray-500 mt-1">Get help from our team</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-600 transition-colors shadow-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          New Ticket
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-card p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" /></svg>
          <h3 className="text-lg font-semibold text-navy-900 mb-2">No tickets yet</h3>
          <p className="text-sm text-gray-500">Create a ticket when you need help.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              onClick={() => openTicket(ticket)}
              className="w-full bg-white rounded-xl border border-gray-200/60 shadow-card hover:shadow-card-hover p-4 flex items-center gap-4 text-left transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-navy-900 truncate">{ticket.subject}</h3>
                  <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${STATUS_COLORS[ticket.status] || ''}`}>
                    {ticket.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1 truncate">{ticket.description}</p>
              </div>
              <span className="text-xs text-gray-400 shrink-0">{getTimeAgo(ticket.created_at)}</span>
              <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
            </button>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-navy-900/40 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-elevated w-full max-w-lg p-6 m-4">
            <h2 className="text-lg font-bold text-navy-900 mb-4">New Support Ticket</h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary">
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary">
                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Subject</label>
                <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Brief description of your issue" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Provide details about your issue..." rows={4} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none" />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-navy-900 transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={creating || !form.subject.trim()} className="px-5 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-600 disabled:opacity-40 transition-colors">
                {creating ? 'Creating...' : 'Create Ticket'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
