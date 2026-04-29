import { useState } from 'react';

interface Props {
  onStart: (topic: string) => Promise<void> | void;
  onCancel: () => void;
}

const QUICK_TOPICS = [
  'Contract question',
  'Technical issue',
  'Billing inquiry',
];

/**
 * Initial form shown when the user clicks the floating bubble for the
 * first time and has no active chat. They write a topic and submit; the
 * chat is created in WAITING status and the chat window takes over.
 */
export default function LiveChatStartForm({ onStart, onCancel }: Props) {
  const [topic, setTopic] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const t = topic.trim();
    if (t.length < 3) return;
    setSubmitting(true);
    try {
      await onStart(t);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col bg-white">
      <div className="flex flex-1 flex-col overflow-y-auto p-4">
        {/* Welcome card */}
        <div className="rounded-2xl border border-primary-100 bg-primary-50/60 p-4">
          <div className="text-sm font-semibold text-gray-900">
            👋 Hi there! How can we help you today?
          </div>
          <p className="mt-1 text-xs text-gray-600">
            Pick a topic or describe your issue — an agent will be with you in
            a few minutes.
          </p>
        </div>

        {/* Quick-pick chips */}
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Quick topics
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_TOPICS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTopic(t)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  topic === t
                    ? 'border-primary bg-primary text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-primary/40 hover:bg-primary-50'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <label className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          What can we help with?
        </label>
        <textarea
          autoFocus
          className="input mt-2 resize-none rounded-xl"
          rows={4}
          maxLength={500}
          placeholder="Describe your issue…"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />

        {/* Disabled paperclip — attachments only available after chat starts */}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-400">
          <button
            type="button"
            disabled
            title="You can attach files once the chat starts"
            className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-md border border-gray-200 bg-gray-50"
            aria-label="Attachments available after chat starts"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <span>Attachments available after the chat starts</span>
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || topic.trim().length < 3}
            className="btn-primary px-4 py-2 text-xs"
          >
            {submitting ? 'Starting…' : 'Start chat'}
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-gray-400">
        Powered by SIGN
      </div>
    </div>
  );
}
