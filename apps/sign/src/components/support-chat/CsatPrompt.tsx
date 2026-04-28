import { useState } from 'react';

interface Props {
  onSubmit: (rating: number, comment?: string) => Promise<void> | void;
  onDismiss: () => void;
}

/**
 * 1–5 star rating modal shown inside the chat window after the chat is closed.
 * Compact: lives inside the existing chat panel, no full-page modal.
 */
export default function CsatPrompt({ onSubmit, onDismiss }: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!rating) return;
    setSubmitting(true);
    try {
      await onSubmit(rating, comment.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-gray-200 bg-gray-50 p-4">
      <p className="text-sm font-medium text-gray-800">
        How was your support experience?
      </p>
      <div className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`text-2xl transition-colors ${
              rating !== null && n <= rating
                ? 'text-yellow-400'
                : 'text-gray-300 hover:text-yellow-300'
            }`}
            onClick={() => setRating(n)}
            aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        className="mt-2 w-full rounded border border-gray-300 p-2 text-sm"
        rows={2}
        placeholder="Optional comment…"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!rating || submitting}
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600 disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
