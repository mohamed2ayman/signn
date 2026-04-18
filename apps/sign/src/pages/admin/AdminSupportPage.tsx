import { useState, useEffect } from 'react';
import { supportService } from '@/services/api/supportService';
import type { SupportTicket, SupportTicketReply } from '@/types';

const STATUS_OPTIONS = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'];
const STATUS_COLORS: Record<string, string> = {
  OPEN: 'text-blue-600 bg-blue-50',
  IN_PROGRESS: 'text-amber-600 bg-amber-50',
  WAITING_ON_USER: 'text-purple-600 bg-purple-50',
  RESOLVED: 'text-green-600 bg-green-50',
  CLOSED: 'text-gray-500 bg-gray-100',
};
const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-green-600',
  medium: 'text-amber-600',
  high: 'text-red-600',
  urgent: 'text-red-700 font-bold',
};

// ─────────────────────────────────────────────────────────────────────
// Support tier derivation — platform SLA policy
//
//   Dedicated (2h)  — Enterprise Managed / Enterprise Custom plans
//   Priority  (8h)  — any other Enterprise plan
//   Standard  (48h) — Starter, Pro, Individual, no active subscription
//
// The tier is resolved from the ACTIVE subscription plan name of the
// ticket owner's organization (server-joined as `planName`). Users
// without an organization or without an active plan fall through to
// the Standard tier.
// ─────────────────────────────────────────────────────────────────────
type TierKey = 'dedicated' | 'priority' | 'standard';
interface TierInfo {
  key: TierKey;
  label: string;
  sla: string;
  rank: number; // lower = higher tier, used for "Sort by tier"
  badgeClass: string;
}

const getTierInfo = (planName: string | null | undefined): TierInfo => {
  const name = (planName || '').toLowerCase();
  if (name.includes('enterprise') && (name.includes('managed') || name.includes('custom'))) {
    return {
      key: 'dedicated',
      label: 'Dedicated',
      sla: '2h SLA',
      rank: 0,
      badgeClass: 'text-blue-700 bg-blue-50 border border-blue-200',
    };
  }
  if (name.includes('enterprise')) {
    return {
      key: 'priority',
      label: 'Priority',
      sla: '8h SLA',
      rank: 1,
      badgeClass: 'text-amber-700 bg-amber-50 border border-amber-200',
    };
  }
  return {
    key: 'standard',
    label: 'Standard',
    sla: '48h SLA',
    rank: 2,
    badgeClass: 'text-gray-600 bg-gray-100 border border-gray-200',
  };
};

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<(SupportTicket & { replies?: SupportTicketReply[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [replyText, setReplyText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sortByTier, setSortByTier] = useState(false);

  useEffect(() => { loadTickets(); }, [filterStatus, filterPriority]);

  const loadTickets = async () => {
    setLoading(true);
    try {
      const data = await supportService.getAdminTickets({
        status: filterStatus || undefined,
        priority: filterPriority || undefined,
      });
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

  const handleStatusChange = async (ticketId: string, status: string) => {
    try {
      await supportService.updateStatus(ticketId, status);
      if (selectedTicket) openTicket(selectedTicket);
      loadTickets();
    } catch { /* */ }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !selectedTicket) return;
    try {
      await supportService.addReply(selectedTicket.id, replyText, isInternal);
      setReplyText('');
      setIsInternal(false);
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

  // ── Ticket Detail ──
  if (selectedTicket) {
    return (
      <div className="space-y-6">
        <button onClick={() => setSelectedTicket(null)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-navy-900 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          Back to all tickets
        </button>

        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-card p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-navy-900">{selectedTicket.subject}</h2>
              <p className="text-sm text-gray-500 mt-1">
                #{selectedTicket.id.slice(0, 8).toUpperCase()} · by {selectedTicket.user ? `${selectedTicket.user.first_name} ${selectedTicket.user.last_name}` : 'Unknown'}
                {selectedTicket.organization ? ` · ${selectedTicket.organization.name}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedTicket.status}
                onChange={(e) => handleStatusChange(selectedTicket.id, e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-primary/20"
              >
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 mb-4">
            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${STATUS_COLORS[selectedTicket.status] || ''}`}>{selectedTicket.status.replace(/_/g, ' ')}</span>
            <span className={`text-xs font-medium ${PRIORITY_COLORS[selectedTicket.priority] || ''}`}>{selectedTicket.priority} priority</span>
            <span className="text-xs text-gray-400">{selectedTicket.category}</span>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">{selectedTicket.description}</p>
        </div>

        {/* Replies */}
        <div className="space-y-3">
          {(selectedTicket.replies || []).map((reply) => (
            <div key={reply.id} className={`rounded-xl border p-4 ${reply.is_internal_note ? 'bg-amber-50/50 border-amber-200/60' : 'bg-white border-gray-200/60'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  {(reply.user?.first_name || 'S')[0]}
                </div>
                <span className="text-sm font-medium text-navy-900">{reply.user ? `${reply.user.first_name} ${reply.user.last_name}` : 'System'}</span>
                {reply.is_internal_note && <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">INTERNAL</span>}
                <span className="text-xs text-gray-400">{getTimeAgo(reply.created_at)}</span>
              </div>
              <p className="text-sm text-gray-600 pl-9">{reply.content}</p>
            </div>
          ))}
        </div>

        {/* Reply composer */}
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-card p-4">
          <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Write a reply..." rows={3} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none" />
          <div className="flex items-center justify-between mt-3">
            <label className="flex items-center gap-2 text-sm text-gray-500">
              <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} className="rounded border-gray-300 text-amber-500 focus:ring-amber-500" />
              Internal note (not visible to user)
            </label>
            <button onClick={handleReply} disabled={!replyText.trim()} className="px-5 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-600 disabled:opacity-40 transition-colors">Send</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Ticket List ──
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Support Tickets</h1>
        <p className="text-sm text-gray-500 mt-1">Manage all support requests</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20">
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20">
          <option value="">All Priorities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <button
          type="button"
          onClick={() => setSortByTier((s) => !s)}
          className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
            sortByTier
              ? 'bg-primary text-white border-primary hover:bg-primary-600'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
          title="Order tickets Dedicated → Priority → Standard"
        >
          {sortByTier ? '✓ Sorted by tier' : 'Sort by tier'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-card p-12 text-center">
          <p className="text-gray-500">No tickets found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Subject</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Support Tier</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(sortByTier
                ? [...tickets].sort(
                    (a, b) => getTierInfo(a.planName).rank - getTierInfo(b.planName).rank,
                  )
                : tickets
              ).map((ticket) => {
                const tier = getTierInfo(ticket.planName);
                return (
                  <tr key={ticket.id} onClick={() => openTicket(ticket)} className="hover:bg-gray-50/50 cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-navy-900 truncate max-w-xs">{ticket.subject}</p>
                      <p className="text-xs text-gray-400">{ticket.category}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {ticket.user ? `${ticket.user.first_name} ${ticket.user.last_name}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${tier.badgeClass}`}>
                          {tier.label}
                        </span>
                        <span className="text-[11px] text-gray-400">{tier.sla}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${STATUS_COLORS[ticket.status] || ''}`}>{ticket.status.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${PRIORITY_COLORS[ticket.priority] || ''}`}>{ticket.priority}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{getTimeAgo(ticket.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
