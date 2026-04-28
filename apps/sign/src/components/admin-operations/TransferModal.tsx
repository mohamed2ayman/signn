import { useEffect, useState } from 'react';
import {
  supportChatService,
  type OnlineOps,
} from '@/services/api/supportChatService';

interface Props {
  chatId: string;
  currentOpsId: string;
  onClose: () => void;
  onTransferred: () => void;
}

/**
 * Modal for handing off an active chat to another ops member.
 *
 * Lists ONLINE/AWAY ops in the same org (server-filtered). The current ops
 * is excluded from the list to avoid no-op self-transfers (the backend also
 * rejects this with a 400, so this is purely UX).
 */
export default function TransferModal({
  chatId,
  currentOpsId,
  onClose,
  onTransferred,
}: Props) {
  const [candidates, setCandidates] = useState<OnlineOps[]>([]);
  const [toOpsId, setToOpsId] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supportChatService.ops
      .onlineOps()
      .then((rows) => {
        if (cancelled) return;
        setCandidates(rows.filter((r) => r.id !== currentOpsId));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [currentOpsId]);

  const handleSubmit = async () => {
    if (!toOpsId) return;
    setSubmitting(true);
    try {
      await supportChatService.ops.transfer(chatId, toOpsId, reason || undefined);
      onTransferred();
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Transfer failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[420px] rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Transfer chat</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-gray-500">Loading…</div>
        ) : candidates.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            No other ops members are currently ONLINE or AWAY.
          </div>
        ) : (
          <>
            <label className="mb-2 block text-xs font-medium text-gray-700">
              Transfer to
            </label>
            <select
              value={toOpsId}
              onChange={(e) => setToOpsId(e.target.value)}
              className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">Select an ops member…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name} · {c.status}
                </option>
              ))}
            </select>

            <label className="mb-2 block text-xs font-medium text-gray-700">
              Reason (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Why is this being transferred?"
              className="mb-4 w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!toOpsId || submitting}
                className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
              >
                {submitting ? 'Transferring…' : 'Transfer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
