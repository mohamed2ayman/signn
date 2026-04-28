import { useState } from 'react';
import { supportChatService } from '@/services/api/supportChatService';

interface Props {
  chatId: string;
  onClose: () => void;
  onClosed: () => void;
}

type Reason = 'resolved' | 'transferred_to_ticket' | 'user_left';

const OPTIONS: { value: Reason; label: string; help: string }[] = [
  {
    value: 'resolved',
    label: 'Resolved',
    help: 'The user got the help they needed.',
  },
  {
    value: 'transferred_to_ticket',
    label: 'Transferred to ticket',
    help: 'Needs longer follow-up — convert to a ticket next.',
  },
  {
    value: 'user_left',
    label: 'User left',
    help: 'User disconnected or stopped responding.',
  },
];

export default function CloseChatModal({ chatId, onClose, onClosed }: Props) {
  const [reason, setReason] = useState<Reason>('resolved');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await supportChatService.ops.close(chatId, reason);
      onClosed();
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Could not close chat');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[420px] rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">End chat</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2">
          {OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-sm ${
                reason === opt.value
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="close-reason"
                value={opt.value}
                checked={reason === opt.value}
                onChange={() => setReason(opt.value)}
                className="mt-0.5"
              />
              <div>
                <div className="font-medium text-gray-900">{opt.label}</div>
                <div className="text-xs text-gray-500">{opt.help}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Ending…' : 'End chat'}
          </button>
        </div>
      </div>
    </div>
  );
}
