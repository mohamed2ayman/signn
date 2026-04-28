import { useState } from 'react';

interface Props {
  onStart: (topic: string) => Promise<void> | void;
  onCancel: () => void;
}

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
    <div className="flex flex-1 flex-col p-4">
      <p className="text-sm text-gray-600">
        Connect with our operations team. We'll reply as soon as someone is
        free — average wait is a few minutes.
      </p>
      <label className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
        What can we help with?
      </label>
      <textarea
        autoFocus
        className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
        rows={4}
        maxLength={500}
        placeholder="Describe your issue…"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || topic.trim().length < 3}
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600 disabled:opacity-50"
        >
          {submitting ? 'Starting…' : 'Start chat'}
        </button>
      </div>
    </div>
  );
}
