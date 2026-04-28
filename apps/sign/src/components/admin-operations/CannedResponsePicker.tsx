import type { CannedResponse } from '@/services/api/supportChatService';

interface Props {
  query: string;
  responses: CannedResponse[];
  onPick: (cr: CannedResponse) => void;
}

/**
 * Slash-trigger autocomplete for canned responses. Shown when the textarea
 * starts with "/" — filters by shortcut OR title, case-insensitive.
 *
 * Empty / no-match list is hidden by the parent so this stays a pure
 * presentational component.
 */
export default function CannedResponsePicker({
  query,
  responses,
  onPick,
}: Props) {
  const q = query.toLowerCase().replace(/^\//, '').trim();
  const filtered = responses.filter(
    (r) =>
      r.shortcut.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q),
  );
  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
      {filtered.slice(0, 10).map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPick(r)}
          className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs hover:bg-gray-50"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-primary">{r.shortcut}</span>
            <span className="font-medium text-gray-900">{r.title}</span>
          </div>
          <div className="line-clamp-2 text-gray-500">{r.body}</div>
        </button>
      ))}
    </div>
  );
}
